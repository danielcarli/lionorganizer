/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Runs the scan in the main process, sends progress to the UI
// and, if the user wants, records the result in the catalog.
const fs = require('fs');
const path = require('path');
const { scanFolder, compileIgnore } = require('../node/scanner');
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
    this.currentRoot = null;          // root of the last completed scan (used to validate actions)
    this.files = new Map();           // path -> { path, size, mtime } from the last scan
    this.emptyDirs = new Set();       // empty folders found by the last scan (the only folders that may be deleted)
    this.cancelToken = null;
  }

  registerChannels(ipc) {
    ipc.handle('scan:start', (e, root, depth, record, options) => this.start(e.sender, root, depth, record, options));
    ipc.handle('scan:restore', (_e, root) => this.restore(root));
    ipc.handle('scan:cancel', () => this.cancel());
  }

  isKnownEmptyDir(p) {
    return typeof p === 'string' && this.emptyDirs.has(p) && this.isInsideRoot(p);
  }

  forgetDir(p) {
    this.emptyDirs.delete(p);
  }

  #adopt(root, files, emptyDirs) {
    this.currentRoot = root;
    this.files = new Map(files.map((f) => [f.path, { path: f.path, size: f.size, mtime: f.mtime }]));
    this.emptyDirs = new Set((emptyDirs || []).map((d) => d.path));
  }

  /**
   * Reopens the last analysis of a folder saved in the catalog (instant, without reading the disk).
   * Returns null when the catalog has none. The UI shows its date and analyzes again in the background.
   */
  restore(root) {
    if (typeof root !== 'string' || !this.catalog.available) return null;
    root = path.resolve(root);
    let snap;
    try { snap = this.catalog.db.lastSnapshot(root, compileIgnore); } catch (err) { console.error(err); return null; }
    if (!snap) return null;
    this.#adopt(root, snap.files, snap.emptyDirs);
    return snap;
  }

  /** True if the path is inside the analyzed folder. */
  isInsideRoot(p) {
    if (!this.currentRoot || typeof p !== 'string') return false;
    const rel = path.relative(this.currentRoot, path.resolve(p));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  isKnownFile(p) {
    return typeof p === 'string' && this.files.has(p) && this.isInsideRoot(p);
  }

  forget(p) {
    this.files.delete(p);
  }

  /** Updates the in-memory list after a move/rename. */
  moved(src, dst) {
    const f = this.files.get(src);
    if (!f) return;
    this.files.delete(src);
    this.files.set(dst, { ...f, path: dst });
  }

  cancel() {
    if (this.cancelToken) this.cancelToken.cancelled = true;
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
    const token = { cancelled: false };
    this.cancelToken = token;
    const startedAt = Date.now();

    const result = await scanFolder(root, {
      maxDepth,
      ignore,
      isCancelled: () => token.cancelled,
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('scan:progress', p); },
    });

    if (this.cancelToken === token) this.cancelToken = null;
    // A cancelled refresh changes nothing: the analysis on screen (and what may be deleted) stays as it was.
    if (background && result.cancelled) return { root, cancelled: true, discarded: true };
    this.#adopt(root, result.files, result.emptyDirs);

    let catalog = { recorded: false };
    if (record && this.catalog.available) {
      try {
        catalog = { recorded: true, ...this.catalog.db.recordScan(result, startedAt) };
        this.catalog.db.saveExtras(catalog.scanId, extrasOf(result));
      } catch (err) {
        catalog = { recorded: false, error: String(err?.message || err) };
      }
    } else if (record) {
      catalog = { recorded: false, error: this.catalog.error };
    }
    const { readDirs, ...forUi } = result;
    return { ...forUi, catalog };
  }
}

/** What the catalog keeps besides the files, so a reopened analysis looks the same. */
function extrasOf(r) {
  return {
    dirsRead: r.dirsRead,
    durationMs: r.durationMs,
    errors: r.errors.slice(0, 2000),
    errorCount: r.errors.length,
    skippedDirs: r.skippedDirs.slice(0, 2000),
    skippedCount: r.skippedDirs.length,
    emptyDirs: r.emptyDirs,
    emptyDirCount: r.emptyDirCount,
    ignoredDirs: r.ignoredDirs.slice(0, 2000),
    ignoredCount: r.ignoredCount,
    ignore: r.ignore,
  };
}

module.exports = { ScanMainService };
