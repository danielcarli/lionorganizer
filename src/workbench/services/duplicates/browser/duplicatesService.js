/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// State of the content-based duplicate check (SHA-256).
// The check only starts when the user clicks the button in the Duplicates view.
import { Emitter } from '../../../../base/common/event.js';
import { t } from '../../../../base/common/nls.js';
import { formatNumber } from '../../../../base/common/format.js';
import { cleanError } from '../../operations/browser/operationsService.js';

const KEY = 'lionorganizer.duplicates';
export const MIN_SIZE_OPTIONS = [
  [1],
  [100 * 1024, 100, 'KB'],
  [1024 * 1024, 1, 'MB'],
  [10 * 1024 * 1024, 10, 'MB'],
  [100 * 1024 * 1024, 100, 'MB'],
].map(([v, n, unit]) => [v, n ? t('duplicatesService.minSize.larger', { size: `${formatNumber(n)} ${t('units.' + unit)}` }) : t('duplicatesService.minSize.all')]);
export const KEEP_STRATEGIES = [
  { id: 'oldest' },
  { id: 'newest' },
  { id: 'shortest' },
].map((s) => ({ ...s, label: t('duplicatesService.keep.' + s.id) }));

export class DuplicatesService {
  #onDidChange = new Emitter();
  onDidChange = this.#onDidChange.event;

  status = 'idle'; // idle | running | done
  progress = null;
  error = null;
  stats = null;
  groups = [];     // { hash, size, files:[fileObj], elsewhere:[], keep: path }
  #forResult = null;
  #updating = false;

  constructor({ host, analysis }) {
    this.host = host;
    this.analysis = analysis;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable */ }
    this.minSize = MIN_SIZE_OPTIONS.some(([v]) => v === saved.minSize) ? saved.minSize : 100 * 1024;
    this.strategy = KEEP_STRATEGIES.some((s) => s.id === saved.strategy) ? saved.strategy : 'oldest';
    host.onHashProgress((p) => { this.progress = p; this.#onDidChange.fire(); });
    analysis.onDidChangeData(() => this.#sync());
  }

  #save() {
    try { localStorage.setItem(KEY, JSON.stringify({ minSize: this.minSize, strategy: this.strategy })); } catch { /* ignore */ }
  }

  setMinSize(v) { this.minSize = Number(v) || 1; this.#save(); this.#onDidChange.fire(); }

  setStrategy(id) {
    this.strategy = id;
    this.#save();
    for (const g of this.groups) g.keep = pickKeep(g.files, id);
    this.#publish();
  }

  setKeep(hash, path) {
    const g = this.groups.find((x) => x.hash === hash);
    if (g) { g.keep = path; this.#publish(); }
  }

  /** Estimate before checking: files that share their size with another file. */
  estimate() {
    const bySize = new Map();
    for (const f of this.analysis.files) {
      if (f.size < this.minSize) continue;
      bySize.set(f.size, (bySize.get(f.size) || 0) + 1);
    }
    let files = 0, bytes = 0;
    for (const [size, n] of bySize) if (n > 1) { files += n; bytes += size * n; }
    return { files, bytes };
  }

  async run() {
    if (this.status === 'running' || !this.analysis.hasData) return;
    this.status = 'running';
    this.error = null;
    this.progress = null;
    this.#forResult = this.analysis.result;
    this.#onDidChange.fire();
    try {
      const res = await this.host.findDuplicates({ minSize: this.minSize, persist: true });
      if (this.analysis.result !== this.#forResult) return; // another analysis started meanwhile
      this.stats = res.stats;
      this.#rawGroups = res.groups;
      this.status = 'done';
      this.#remap();
    } catch (err) {
      this.error = cleanError(err);
      this.status = 'idle';
    }
    this.#publish();
  }

  cancel() { if (this.status === 'running') this.host.cancelDuplicates(); }

  reset() {
    this.status = 'idle';
    this.groups = [];
    this.#rawGroups = [];
    this.stats = null;
    this.progress = null;
    this.#publish();
  }

  /** Extra copies (all except the one kept in each group). */
  extras() {
    return this.groups.flatMap((g) => g.files.filter((f) => f.path !== g.keep));
  }

  reclaimable() {
    return this.groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
  }

  // ---------------------------------------------------------------- sync with the analysis
  #rawGroups = [];

  #sync() {
    if (this.#updating) return;
    if (this.analysis.result !== this.#forResult) {
      // new analysis: old results are no longer valid
      if (this.status !== 'running') { this.status = 'idle'; this.groups = []; this.#rawGroups = []; this.stats = null; this.#publish(); }
      return;
    }
    if (this.status === 'done') { this.#remap(); this.#publish(); }
  }

  /** Rebuilds the groups from the current files (after Recycle Bin/move/rename). */
  #remap() {
    const byPath = new Map(this.analysis.files.map((f) => [f.path, f]));
    const prevKeep = new Map(this.groups.map((g) => [g.hash, g.keep]));
    // follow moved files: the hash stays the same, the path changes
    const raw = this.#rawGroups.map((g) => ({ ...g, paths: g.paths.map((p) => this.#renamed.get(p) || p) }));
    this.#rawGroups = raw;
    this.groups = raw.map((g) => {
      const files = g.paths.map((p) => byPath.get(p)).filter(Boolean);
      const kept = prevKeep.get(g.hash);
      return { hash: g.hash, size: g.size, elsewhere: g.elsewhere || [], files, keep: files.some((f) => f.path === kept) ? kept : pickKeep(files, this.strategy) };
    }).filter((g) => g.files.length > 1);
  }

  #renamed = new Map();
  /** Called by the workbench after operations that move files. */
  trackMoves(moved) {
    for (const m of moved || []) this.#renamed.set(m.src, m.dst);
  }

  #publish() {
    this.#updating = true;
    try {
      this.analysis.setConfirmedDuplicates(this.status === 'done' ? this.extras().map((f) => f.path) : null);
    } finally {
      this.#updating = false;
    }
    this.#onDidChange.fire();
  }
}

function pickKeep(files, strategy) {
  if (!files.length) return null;
  const sorted = [...files].sort((a, b) => {
    if (strategy === 'newest') return b.mtime - a.mtime;
    if (strategy === 'shortest') return a.path.length - b.path.length || a.mtime - b.mtime;
    return a.mtime - b.mtime;
  });
  return sorted[0].path;
}
