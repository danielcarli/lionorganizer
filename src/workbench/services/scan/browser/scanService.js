/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Orchestrates the scan on the UI side: picks the folder, stores the depth settings,
// relays progress and hands the result to the AnalysisService.
import { Emitter } from '../../../../base/common/event.js';

const STORAGE_KEY = 'lionorganizer.settings';
export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 50;

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      depth: Number.isInteger(s.depth) && s.depth >= 0 && s.depth <= MAX_DEPTH ? s.depth : DEFAULT_DEPTH,
      unlimited: s.unlimited === true,
      record: s.record !== false, // save analyses to the catalog (default: yes)
      lastFolder: typeof s.lastFolder === 'string' ? s.lastFolder : null,
    };
  } catch {
    return { depth: DEFAULT_DEPTH, unlimited: false, record: true, lastFolder: null };
  }
}

export class ScanService {
  #onDidChangeState = new Emitter();
  #onDidProgress = new Emitter();
  #onDidChangeSettings = new Emitter();
  onDidChangeState = this.#onDidChangeState.event;
  onDidProgress = this.#onDidProgress.event;
  onDidChangeSettings = this.#onDidChangeSettings.event;

  state = 'idle'; // idle | scanning
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

  async scan(folder = this.folder) {
    if (!folder || this.state === 'scanning') return;
    this.folder = folder;
    this.#save();
    this.state = 'scanning';
    this.error = null;
    this.progress = { files: 0, dirs: 0, bytes: 0, current: folder };
    this.#onDidChangeState.fire(this.state);
    try {
      const result = await this.host.startScan(folder, this.effectiveDepth, this.settings.record);
      this.analysis.setResult(result);
    } catch (err) {
      this.error = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      this.state = 'idle';
      this.#onDidChangeState.fire(this.state);
    }
  }

  cancel() {
    if (this.state === 'scanning') this.host.cancelScan();
  }
}
