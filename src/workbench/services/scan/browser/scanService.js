/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Orchestrates the scan on the UI side: picks the folder, stores the depth and ignore settings,
// relays progress and hands the result to the AnalysisService. It can also reopen the last analysis
// saved in the catalog (instant) and analyze again in the background without hiding it.
import { Emitter } from '../../../../base/common/event.js';

const STORAGE_KEY = 'lionorganizer.settings';
export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 50;
/** Folders usually worth leaving out (the option itself is off by default). Same list as the scanner's. */
export const DEFAULT_IGNORE = [
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', '.gradle', '.idea',
  '$RECYCLE.BIN', 'System Volume Information', '.Trash*', '.Spotlight-V100', '.fseventsd',
];
const MAX_IGNORE = 200;

/** Cleans a list typed by the user: one pattern per item, no blanks or repeats. */
export function cleanIgnoreList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const p = String(raw ?? '').trim();
    if (!p || p.length > 260 || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    out.push(p);
  }
  return out.slice(0, MAX_IGNORE);
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      depth: Number.isInteger(s.depth) && s.depth >= 0 && s.depth <= MAX_DEPTH ? s.depth : DEFAULT_DEPTH,
      unlimited: s.unlimited === true,
      record: s.record !== false, // save analyses to the catalog (default: yes)
      lastFolder: typeof s.lastFolder === 'string' ? s.lastFolder : null,
      ignoreEnabled: s.ignoreEnabled === true, // off unless the user turns it on
      ignoreList: Array.isArray(s.ignoreList) ? cleanIgnoreList(s.ignoreList) : [...DEFAULT_IGNORE],
    };
  } catch {
    return { depth: DEFAULT_DEPTH, unlimited: false, record: true, lastFolder: null, ignoreEnabled: false, ignoreList: [...DEFAULT_IGNORE] };
  }
}

export class ScanService {
  #onDidChangeState = new Emitter();
  #onDidProgress = new Emitter();
  #onDidChangeSettings = new Emitter();
  #onDidFinish = new Emitter();
  onDidChangeState = this.#onDidChangeState.event;
  onDidProgress = this.#onDidProgress.event;
  onDidChangeSettings = this.#onDidChangeSettings.event;
  /** Fires with { background, result } when a scan ends with a new analysis on screen. */
  onDidFinish = this.#onDidFinish.event;

  /** idle | scanning (nothing on screen yet, or a new analysis) | refreshing (in the background, data stays) */
  state = 'idle';
  progress = null;
  error = null;

  constructor(host, analysis) {
    this.host = host;
    this.analysis = analysis;
    this.settings = loadSettings();
    this.folder = this.settings.lastFolder;
    host.onScanProgress((p) => {
      this.progress = p;
      this.#onDidProgress.fire(p);
    });
  }

  #save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.settings, lastFolder: this.folder })); } catch { /* storage unavailable */ }
    this.#onDidChangeSettings.fire(this.settings);
  }

  setDepth(depth) {
    const n = Math.max(0, Math.min(MAX_DEPTH, Math.round(Number(depth) || 0)));
    this.settings = { ...this.settings, depth: n };
    this.#save();
  }

  setRecord(on) {
    this.settings = { ...this.settings, record: !!on };
    this.#save();
  }

  setIgnoreEnabled(on) {
    this.settings = { ...this.settings, ignoreEnabled: !!on };
    this.#save();
  }

  setIgnoreList(list) {
    this.settings = { ...this.settings, ignoreList: cleanIgnoreList(list) };
    this.#save();
  }

  get busy() { return this.state !== 'idle'; }

  /** Patterns sent to the scan: none unless the option is on. */
  get ignorePatterns() {
    return this.settings.ignoreEnabled ? this.settings.ignoreList : [];
  }

  setUnlimited(on) {
    this.settings = { ...this.settings, unlimited: !!on };
    this.#save();
  }

  /** Effective depth: number of levels, or null (no limit). */
  get effectiveDepth() {
    return this.settings.unlimited ? null : this.settings.depth;
  }

  async pickFolder() {
    const folder = await this.host.pickFolder();
    if (folder) {
      this.folder = folder;
      this.#save();
    }
    return folder;
  }

  /**
   * @param {string} [folder]
   * Analyzing again the folder on screen is always a background refresh: the analysis stays visible (and in
   * use) until the new one is ready, and cancelling keeps it.
   */
  async scan(folder = this.folder) {
    if (!folder || this.busy) return;
    const background = this.analysis.hasData && this.analysis.root === folder;
    this.folder = folder;
    this.#save();
    this.state = background ? 'refreshing' : 'scanning';
    this.error = null;
    this.progress = { files: 0, dirs: 0, bytes: 0, current: folder };
    this.#onDidChangeState.fire(this.state);
    try {
      const result = await this.host.startScan(folder, this.effectiveDepth, this.settings.record, { ignore: this.ignorePatterns, background });
      if (!result.discarded) {
        this.analysis.setResult(result, { keepView: background });
        this.#onDidFinish.fire({ background, result });
      }
    } catch (err) {
      this.error = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      this.state = 'idle';
      this.#onDidChangeState.fire(this.state);
    }
  }

  /**
   * Shows the last analysis of the folder saved in the catalog right away (with its date) and analyzes it
   * again in the background. Returns false when the catalog has none.
   */
  async reopen(folder = this.folder) {
    if (!folder || this.busy) return false;
    let snap = null;
    try { snap = await this.host.restoreScan(folder); } catch { snap = null; }
    if (!snap) return false;
    this.folder = snap.root;
    this.#save();
    this.analysis.setResult(snap);
    this.scan(snap.root);
    return true;
  }

  cancel() {
    if (this.busy) this.host.cancelScan();
  }
}
