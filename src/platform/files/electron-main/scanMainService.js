/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Starts the scan in the background worker, relays progress to the UI and keeps what the actions need to
// check (the analyzed folder, its files and its empty folders). The files arrive as columns
// (platform/files/node/fileColumns.js) and are passed on to the window as they are.
const fs = require('fs');
const path = require('path');
const { diskInfo } = require('../node/diskInfo');
const { pathAt } = require('../node/fileColumns');
const { t } = require('../../nls/common/nls');

const MAX_DEPTH_LIMIT = 50;

/** Ignore list sent by the UI: up to 200 short strings (anything else is dropped). */
function sanitizeIgnore(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => typeof p === 'string' && p.trim() && p.length <= 260).map((p) => p.trim()).slice(0, 200);
}

class ScanMainService {
  constructor(catalog) {
    this.catalog = catalog;
    this.worker = catalog.worker;
    this.currentRoot = null;          // root of the last completed scan (used to validate actions)
    this.cols = null;                 // its files, as columns
    this.emptyDirs = new Set();       // empty folders found by the last scan (the only folders that may be deleted)
    this.callId = null;               // scan in progress in the worker
    this.#reset();
  }

  // Lookup of the files of the last scan without a million-entry map: the files are grouped by folder
  // once (a counting sort of typed arrays, a few ms), then a path is found among the few files of its
  // folder. Files removed or moved by the app since then are kept on the side.
  #byFolder = null;    // { ids: Map<folder, id>, start: Uint32Array, order: Uint32Array }
  #removed = new Set();
  #added = new Map();  // path → { size, mtime } (moved or renamed by the app)

  #reset() {
    this.#byFolder = null;
    this.#removed = new Set();
    this.#added = new Map();
  }

  #index() {
    if (this.#byFolder || !this.cols) return this.#byFolder;
    const c = this.cols;
    const nf = c.folders.length;
    const start = new Uint32Array(nf + 1);
    for (let i = 0; i < c.count; i++) start[c.folderIdx[i] + 1]++;
    for (let k = 0; k < nf; k++) start[k + 1] += start[k];
    const fill = start.slice(0, nf);
    const order = new Uint32Array(c.count);
    for (let i = 0; i < c.count; i++) order[fill[c.folderIdx[i]]++] = i;
    const ids = new Map();
    c.folders.forEach((f, k) => ids.set(f, k));
    this.#byFolder = { ids, start, order };
    return this.#byFolder;
  }

  /** Index of the file in the columns, or -1. */
  #find(p) {
    const idx = this.#index();
    if (!idx || !this.currentRoot) return -1;
    const rel = path.relative(this.currentRoot, p);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return -1;
    const name = path.basename(rel);
    const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    const id = idx.ids.get(folder);
    if (id === undefined) return -1;
    const { names } = this.cols;
    for (let k = idx.start[id]; k < idx.start[id + 1]; k++) if (names[idx.order[k]] === name) return idx.order[k];
    return -1;
  }

  /** { size, mtime } of a file of the analysis (as it is now in the app), or null. */
  fileInfo(p) {
    if (typeof p !== 'string' || this.#removed.has(p)) return null;
    const moved = this.#added.get(p);
    if (moved) return moved;
    const i = this.#find(p);
    return i < 0 ? null : { size: this.cols.sizes[i], mtime: this.cols.mtimes[i] };
  }

  /** Every file of the analysis as it is now in the app (used for the content hashes). */
  *#current() {
    const c = this.cols;
    if (!c) return;
    for (let i = 0; i < c.count; i++) {
      const p = pathAt(c, this.currentRoot, path.sep, i);
      if (!this.#removed.has(p)) yield { path: p, size: c.sizes[i], mtime: c.mtimes[i] };
    }
    for (const [p, f] of this.#added) yield { path: p, size: f.size, mtime: f.mtime };
  }

  /** Files that could have a copy: size at least minSize and shared with another file. */
  hashCandidates(minSize) {
    const counts = new Map();
    const c = this.cols;
    if (c) for (let i = 0; i < c.count; i++) if (c.sizes[i] >= minSize) counts.set(c.sizes[i], (counts.get(c.sizes[i]) || 0) + 1);
    for (const f of this.#added.values()) if (f.size >= minSize) counts.set(f.size, (counts.get(f.size) || 0) + 1);
    const out = [];
    for (const f of this.#current()) if (f.size >= minSize && counts.get(f.size) > 1) out.push(f);
    return out;
  }

  registerChannels(ipc) {
    ipc.handle('scan:start', (e, root, depth, record, options) => this.start(e.sender, root, depth, record, options));
    ipc.handle('scan:restore', (e, root) => this.restore(e.sender, root));
    ipc.handle('scan:cancel', () => this.cancel());
  }

  isKnownEmptyDir(p) {
    return typeof p === 'string' && this.emptyDirs.has(p) && this.isInsideRoot(p);
  }

  forgetDir(p) {
    this.emptyDirs.delete(p);
  }

  #adopt(root, cols, emptyDirs) {
    this.currentRoot = root;
    this.cols = cols;
    this.#reset();
    this.emptyDirs = new Set((emptyDirs || []).map((d) => d.path));
  }

  /**
   * Reopens the last analysis of a folder saved in the catalog (without reading the disk).
   * Returns null when the catalog has none.
   */
  async restore(sender, root) {
    if (typeof root !== 'string') return null;
    await this.catalog.ready;
    if (!this.catalog.available) return null;
    root = path.resolve(root);
    let snap;
    try {
      snap = await this.worker.call('restore', [root], { onProgress: (p) => { if (!sender.isDestroyed()) sender.send('scan:restoreProgress', p); } });
    } catch (err) { console.error(err); return null; }
    if (!snap) return null;
    this.#adopt(root, snap.cols, snap.emptyDirs);
    snap.disk = await diskInfo(root); // the disk as it is now
    return snap;
  }

  /** True if the path is inside the analyzed folder. */
  isInsideRoot(p) {
    if (!this.currentRoot || typeof p !== 'string') return false;
    const rel = path.relative(this.currentRoot, path.resolve(p));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  isKnownFile(p) {
    return typeof p === 'string' && this.isInsideRoot(p) && !!this.fileInfo(p);
  }

  forget(p) {
    this.#removed.add(p);
    this.#added.delete(p);
  }

  /** Updates the in-memory list after a move/rename. */
  moved(src, dst) {
    const f = this.fileInfo(src);
    if (!f) return;
    this.forget(src);
    this.#removed.delete(dst);
    this.#added.set(dst, { size: f.size, mtime: f.mtime });
  }

  cancel() {
    if (this.callId) this.worker.cancel(this.callId);
    return true;
  }

  /**
   * @param {{ ignore?: string[], background?: boolean }} [options]
   *   background: a refresh of an analysis already on screen; if cancelled, the one on screen is kept.
   */
  async start(sender, root, depth, record, options) {
    const ignore = sanitizeIgnore(options?.ignore);
    const background = options?.background === true;
    if (typeof root !== 'string') throw new Error(t('main.scan.errors.invalidFolder'));
    root = path.resolve(root);
    const st = await fs.promises.stat(root).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error(t('main.scan.errors.notFolder'));

    let maxDepth = Infinity;
    if (depth !== null && depth !== undefined) {
      const n = Math.floor(Number(depth));
      if (!Number.isFinite(n) || n < 0 || n > MAX_DEPTH_LIMIT) throw new Error(t('main.scan.errors.invalidDepth'));
      maxDepth = n;
    }

    this.cancel();
    await this.catalog.ready;
    let id = null;
    const result = await this.worker.call('scan', [{ root, maxDepth, ignore, record: !!record && this.catalog.available, background }], {
      onId: (i) => { id = i; this.callId = i; },
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('scan:progress', p); },
    });
    if (this.callId === id) this.callId = null;
    // A cancelled refresh changes nothing: the analysis on screen (and what may be deleted) stays as it was.
    if (result.discarded) return result;
    this.#adopt(root, result.cols, result.emptyDirs);
    if (record && !this.catalog.available) result.catalog = { recorded: false, error: this.catalog.error };
    result.disk = await diskInfo(root);
    return result;
  }
}

module.exports = { ScanMainService };
