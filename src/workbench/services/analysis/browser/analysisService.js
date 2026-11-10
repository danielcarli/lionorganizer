/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Central analysis model: files, folder tree, filters, sorting and selection.
// The "parts" and "views" only read from here and react to the events.
// Built for very large analyses (a million files and more): results are cached per folder in focus, the
// cleanup rules run once per file, and the file list is sorted by a Web Worker (sortWorker.js) instead of
// the UI thread.
import { Emitter } from '../../../../base/common/event.js';
import { categorize, CATEGORIES, CLEANUP_RULES, findDuplicates, findDuplicatesSliced } from '../common/fileCategories.js';
import { splitRel } from '../../../../base/common/format.js';
import { decodeFiles, decodeFilesAsync } from '../common/fileColumns.js';
import { t, tn, getLocale } from '../../../../base/common/nls.js';

const DAY = 86400000;
export const AGE_BUCKETS = [
  { id: 'under1Month', max: 30 * DAY },
  { id: 'months1to6', max: 182 * DAY },
  { id: 'months6to12', max: 365 * DAY },
  { id: 'years1to2', max: 730 * DAY },
  { id: 'years2to5', max: 1826 * DAY },
  { id: 'over5Years', max: Infinity },
].map((b) => ({ ...b, label: t('analysis.age.' + b.id) }));

/** Label used as the "extension" of files that have none. */
const NO_EXTENSION = t('analysis.noExtension');

const EMPTY_FILTER = { folder: '', category: null, ext: null, query: '', minSize: 0, group: null };
/** From this many files on, the list is sorted by the worker (below, directly: it is instant). */
const WORKER_SORT_MIN = 40000;
const MAX_CACHED = 48;

export class AnalysisService {
  #onDidChangeData = new Emitter();
  #onDidChangeFilter = new Emitter();
  #onDidChangeSelection = new Emitter();
  #onDidFindMissing = new Emitter();
  #onDidPrepare = new Emitter();
  onDidChangeData = this.#onDidChangeData.event;
  /** Fires when the cleanup suggestions of a large analysis, computed in the background, are ready. */
  onDidPrepare = this.#onDidPrepare.event;
  /** Fires with the number of files newly found missing (deleted or moved outside the app). */
  onDidFindMissing = this.#onDidFindMissing.event;
  onDidChangeFilter = this.#onDidChangeFilter.event;
  onDidChangeSelection = this.#onDidChangeSelection.event;

  result = null;
  files = [];
  emptyDirList = [];
  tree = null;
  filter = { ...EMPTY_FILTER };
  sort = { key: 'size', dir: -1 };
  selection = new Set();
  #cache = new Map();
  confirmedDuplicates = null; // Set of paths of extra copies confirmed by hash (or null)
  /** Files of the analysis that no longer exist on disk: shown in gray until removed from the list. */
  missing = new Set();
  #checked = new Set();   // paths already checked since the last scan or window focus
  #visible = new Map();   // view id → paths it shows (re-checked when the window gets focus)

  /** @param {{ missingFiles?: (paths: string[]) => Promise<string[]> }} [host] */
  constructor(host) { this.host = host; }

  get hasData() { return !!this.result; }
  get root() { return this.result?.root ?? ''; }

  /**
   * @param {object} result
   * @param {{ keepView?: boolean }} [opts] keepView: a refresh of the same folder keeps the folder in focus,
   *   the filters and the selection (of the files that still exist).
   */
  /**
   * Like setResult, but turns the file columns into objects a slice at a time first (a million files
   * would otherwise block the window for about a second). onProgress(done, total) reports it.
   */
  async setResultAsync(result, opts, onProgress) {
    if (result.cols) {
      const { cols, ...meta } = result;
      const files = await decodeFilesAsync(cols, meta.root, categorize, onProgress);
      return this.setResult({ ...meta, files, decoded: true }, opts);
    }
    return this.setResult(result, opts);
  }

  setResult(result, { keepView = false } = {}) {
    const { files: rawFiles, cols, decoded, ...meta } = result;
    let files;
    if (cols) files = decodeFiles(cols, meta.root, categorize);
    else if (decoded) files = rawFiles;
    else { files = rawFiles || []; files.forEach((f, i) => { f.cat = categorize(f.ext); f.i = i; }); }
    this.#all = files;
    this.#orders.clear();
    this.#ordersPending.clear();
    this.#ruleHits = null;
    this.#dupRoot = null;
    this.#prepareToken = null;
    this.#removed = new Set();
    this.#byPath = null;
    const keep = keepView && this.result && this.result.root === meta.root;
    const prevFilter = this.filter;
    const prevSelection = this.selection;
    this.result = meta;
    this.files = files;
    this.emptyDirList = (meta.emptyDirs || []).slice();
    this.#emptyRemoved = 0;
    this.filter = { ...EMPTY_FILTER };
    this.selection = new Set();
    if (keep) {
      if (prevSelection.size) {
        const byPath = this.#pathIndex();
        for (const p of prevSelection) if (byPath.has(p)) this.selection.add(p);
      }
      const sep = sepOf(meta.root);
      const folder = prevFilter.folder;
      const stillThere = !folder || files.some((f) => f.folder === folder || f.folder.startsWith(folder + sep));
      this.filter = { ...prevFilter, folder: stillThere ? folder : '' };
    }
    this.missing.clear();
    this.#checked.clear();
    this.#visible.clear();
    this.#rebuild();
    this.#onDidChangeData.fire();
    this.#onDidChangeFilter.fire();
    this.#onDidChangeSelection.fire();
    this.#prepareOrder('size'); // the default sort, ready before the Files tab is opened
    this.#prepareInBackground();
  }

  // ---------- large analyses: work done in slices after the first screen ----------
  #dupRoot = null;           // duplicate heuristic of the whole analysis, computed in the background
  #prepareToken = null;

  /** True when the cleanup suggestions can be shown without computing them now. */
  get cleanupReady() {
    return this.files.length < WORKER_SORT_MIN || (!!this.#ruleHits && (!!this.filter.folder || !!this.#dupRoot || !!this.confirmedDuplicates));
  }

  /**
   * Cleanup rules and the duplicate heuristic for a large analysis, a slice at a time (~12 ms), so the
   * first screen appears at once; also the lowercase names the search uses.
   */
  async #prepareInBackground() {
    if (this.files.length < WORKER_SORT_MIN) return;
    const token = (this.#prepareToken = {});
    const files = this.files;
    const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
    let t0 = performance.now();
    const pause = async () => {
      if (performance.now() - t0 < 12) return true;
      await yieldNow();
      t0 = performance.now();
      return this.#prepareToken === token && this.files === files;
    };
    await yieldNow(); // after the first screen
    if (this.#prepareToken !== token) return;
    // 1) cleanup rules, once per file
    if (!this.#ruleHits) {
      const now = Date.now();
      const hits = new Map(CLEANUP_RULES.map((r) => [r.id, []]));
      const rules = CLEANUP_RULES.map((r) => [r.test, hits.get(r.id)]);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        for (const [test, list] of rules) if (test(f, now)) list.push(f);
        if ((i & 2047) === 0 && !(await pause())) return;
      }
      this.#ruleHits = hits;
    }
    // 2) duplicate heuristic (same name and size), for the whole analysis
    const dup = await findDuplicatesSliced(files, pause);
    if (!dup) return;
    this.#dupRoot = dup;
    for (const k of [...this.#cache.keys()]) if (k.startsWith('cleanup:') || k.startsWith('freeable:')) this.#cache.delete(k);
    this.#onDidPrepare.fire();
    // 3) lowercase names for the search
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      f.ln ??= f.name.toLowerCase();
      if ((i & 4095) === 0 && !(await pause())) return;
    }
  }

  #all = [];                 // every file of the analysis by index (f.i); removed ones stay, see #removed
  #removed = new Set();      // paths removed from the analysis since it was loaded
  #byPath = null;            // path → file, built only when needed
  #ruleHits = null;          // cleanup rule id → files (whole analysis), computed once

  #pathIndex() {
    if (!this.#byPath) {
      this.#byPath = new Map();
      for (const f of this.files) this.#byPath.set(f.path, f);
    }
    return this.#byPath;
  }

  removeFiles(paths) {
    const gone = new Set(paths);
    if (!gone.size) return;
    const removed = [];
    this.files = this.files.filter((f) => { if (gone.has(f.path)) { removed.push(f); return false; } return true; });
    if (!removed.length) return;
    for (const f of removed) { this.#removed.add(f.path); this.#byPath?.delete(f.path); }
    for (const p of gone) { this.selection.delete(p); this.missing.delete(p); }
    // the tree and the rule hits lose just these files (no full rebuild)
    subtractFromTree(this.tree, removed);
    if (this.#ruleHits) for (const [id, list] of this.#ruleHits) this.#ruleHits.set(id, list.filter((f) => !gone.has(f.path)));
    if (this.#dupRoot) this.#dupRoot = { ...this.#dupRoot, extras: this.#dupRoot.extras.filter((f) => !gone.has(f.path)) };
    this.#cache.clear();
    this.#onDidChangeData.fire();
    this.#onDidChangeSelection.fire();
  }

  // ---------- empty folders ----------
  /** Empty folders inside the folder in focus (topmost of each empty branch). */
  emptyDirs() {
    const folder = this.filter.folder;
    if (!folder) return this.emptyDirList;
    const prefix = folder + sepOf(this.root);
    return this.emptyDirList.filter((d) => d.folder.startsWith(prefix));
  }

  /** Total of empty folders found (the list may be capped for very large analyses). */
  get emptyDirCount() {
    return Math.max(this.emptyDirList.length, (this.result?.emptyDirCount ?? 0) - this.#emptyRemoved);
  }

  #emptyRemoved = 0;
  removeEmptyDirs(paths) {
    const gone = new Set(paths);
    const before = this.emptyDirList.length;
    this.emptyDirList = this.emptyDirList.filter((d) => !gone.has(d.path));
    this.#emptyRemoved += before - this.emptyDirList.length;
    if (before !== this.emptyDirList.length) this.#onDidChangeData.fire();
  }

  // ---------- files that no longer exist ----------
  isMissing(path) { return this.missing.has(path); }
  hasFile(path) { return this.#pathIndex().has(path); }

  /** Marks files as missing (shown in gray). Returns how many were new. */
  markMissing(paths) {
    // the paths come from the lists of this analysis: only those removed meanwhile are left out
    const fresh = (paths || []).filter((p) => typeof p === 'string' && !this.missing.has(p) && !this.#removed.has(p));
    if (!fresh.length) return 0;
    for (const p of fresh) { this.missing.add(p); this.#checked.add(p); this.selection.delete(p); }
    this.#onDidChangeData.fire();
    this.#onDidChangeSelection.fire();
    this.#onDidFindMissing.fire(fresh.length);
    return fresh.length;
  }

  /** Removes missing files from the analysis (only from the interface — nothing on disk changes). */
  dismissMissing(paths = [...this.missing]) {
    const list = paths.filter((p) => this.missing.has(p));
    if (list.length) this.removeFiles(list);
    return list.length;
  }

  /**
   * Checks in the background whether the files a view shows still exist. Each path is checked once,
   * until the window gets focus again (see recheck).
   * @param {string} viewId @param {string[]} paths
   */
  async verify(viewId, paths) {
    if (!this.host?.missingFiles) return;
    this.#visible.set(viewId, paths);
    const todo = paths.filter((p) => !this.#checked.has(p));
    if (!todo.length) return;
    for (const p of todo) this.#checked.add(p);
    let gone = [];
    try { gone = await this.host.missingFiles(todo); } catch { return; }
    this.markMissing(gone);
  }

  /** The user may have deleted, moved or restored files meanwhile: check what is on screen again. */
  async recheck() {
    if (!this.host?.missingFiles || !this.result) return;
    this.#checked.clear();
    const shown = new Set([...this.#visible.values()].flat());
    for (const p of this.missing) shown.add(p);
    const paths = [...shown];
    if (!paths.length) return;
    let gone = [];
    try { gone = await this.host.missingFiles(paths); } catch { return; }
    for (const p of paths) this.#checked.add(p);
    const goneSet = new Set(gone);
    const back = [...this.missing].filter((p) => !goneSet.has(p)); // restored (e.g. from the Recycle Bin)
    if (back.length) {
      for (const p of back) this.missing.delete(p);
      this.#onDidChangeData.fire();
    }
    this.markMissing(gone);
  }

  /** Receives from DuplicatesService the extra copies confirmed by SHA-256. */
  setConfirmedDuplicates(paths) {
    const next = paths ? new Set(paths) : null;
    const same = (a, b) => a === b || (a && b && a.size === b.size && [...a].every((p) => b.has(p)));
    if (same(this.confirmedDuplicates, next)) return;
    this.confirmedDuplicates = next;
    for (const k of [...this.#cache.keys()]) if (k.startsWith('cleanup:') || k.startsWith('freeable:')) this.#cache.delete(k);
    this.#cache.delete('filtered');
    this.#onDidChangeData.fire();
  }

  /** Updates paths after organize/rename/undo. @param {{src:string,dst:string}[]} moved */
  applyMoves(moved) {
    if (!moved?.length || !this.result) return;
    const root = this.result.root;
    const sep = sepOf(root);
    const prefix = root.replace(/[\\/]+$/, '') + sep;
    const bySrc = new Map(moved.map((m) => [m.src, m.dst]));
    for (const f of this.files) {
      const dst = bySrc.get(f.path);
      if (!dst) continue;
      if (this.selection.delete(f.path)) this.selection.add(dst);
      const idx = Math.max(dst.lastIndexOf('\\'), dst.lastIndexOf('/'));
      const name = dst.slice(idx + 1);
      const dir = dst.slice(0, idx);
      const dot = name.lastIndexOf('.');
      f.path = dst;
      f.name = name;
      f.ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      f.cat = categorize(f.ext);
      f.folder = dir === root.replace(/[\\/]+$/, '') ? '' : dir.startsWith(prefix) ? dir.slice(prefix.length) : f.folder;
      f.depth = f.folder ? f.folder.split(sep).length : 0;
    }
    this.#byPath = null;
    this.#ruleHits = null;
    this.#dupRoot = null;
    for (const f of this.files) f.ln = undefined;
    for (const k of ['name', 'folder', 'ext']) { this.#orders.delete(k); this.#ordersPending.delete(k); }
    this.#rebuild();
    this.#onDidChangeData.fire();
    this.#onDidChangeSelection.fire();
    this.#prepareInBackground();
  }

  #rebuild() {
    this.#cache.clear();
    this.tree = buildTree(this.files, this.result.root);
  }

  // ---------- filters ----------
  setFilter(patch) {
    this.filter = { ...this.filter, ...patch };
    this.#cache.delete('filtered');
    // results per folder stay cached: going back to a folder seen before is instant
    this.#onDidChangeFilter.fire();
  }

  resetFilters({ keepFolder = true } = {}) {
    this.setFilter({ ...EMPTY_FILTER, folder: keepFolder ? this.filter.folder : '' });
  }

  setSort(key) {
    this.sort = this.sort.key === key ? { key, dir: -this.sort.dir } : { key, dir: key === 'name' || key === 'folder' ? 1 : -1 };
    this.#cache.delete('filtered');
    this.#onDidChangeFilter.fire();
  }

  // ---------- selection ----------
  toggleSelected(path, on = !this.selection.has(path)) {
    on ? this.selection.add(path) : this.selection.delete(path);
    this.#onDidChangeSelection.fire();
  }
  setSelection(paths) {
    this.selection = new Set(paths);
    this.#onDidChangeSelection.fire();
  }
  selectedFiles() {
    return this.files.filter((f) => this.selection.has(f.path));
  }

  // ---------- derived data (cached) ----------
  #memo(key, compute) {
    if (!this.#cache.has(key)) {
      if (this.#cache.size > MAX_CACHED) this.#cache.clear();
      this.#cache.set(key, compute());
    }
    return this.#cache.get(key);
  }

  /** Files inside the folder in focus (tree/breadcrumb). */
  scopeFiles() {
    return this.#memo('scope:' + this.filter.folder, () => {
      const folder = this.filter.folder;
      if (!folder) return this.files;
      const sep = folder.includes('\\') || this.root.includes('\\') ? '\\' : '/';
      const prefix = folder + sep;
      return this.files.filter((f) => f.folder === folder || f.folder.startsWith(prefix));
    });
  }

  summary() {
    return this.#memo('summary:' + this.filter.folder, () => {
      const files = this.scopeFiles();
      const sep = sepOf(this.root);
      const scope = this.filter.folder;
      const cut = scope ? scope.length + 1 : 0; // where the subfolder name starts in f.folder
      let bytes = 0;
      let largest = null;
      const byCat = new Map(CATEGORIES.map((c) => [c.id, { id: c.id, size: 0, count: 0 }]));
      const byExt = new Map();
      const byFolder = new Map(); // folder → { size, count }: subfolders are summed from these
      const byAge = AGE_BUCKETS.map((b) => ({ ...b, size: 0, count: 0 }));
      const ageMax = byAge.map((b) => b.max);
      const now = Date.now();

      for (const f of files) {
        const size = f.size;
        bytes += size;
        if (!largest || size > largest.size) largest = f;
        const c = byCat.get(f.cat); c.size += size; c.count++;
        const ek = f.ext || NO_EXTENSION;
        let e = byExt.get(ek);
        if (!e) byExt.set(ek, (e = { ext: ek, size: 0, count: 0, cat: f.cat }));
        e.size += size; e.count++;
        let d = byFolder.get(f.folder);
        if (!d) byFolder.set(f.folder, (d = { size: 0, count: 0 }));
        d.size += size; d.count++;
        const age = now - f.mtime;
        let k = 0;
        while (age >= ageMax[k]) k++;
        byAge[k].size += size; byAge[k].count++;
      }
      const bySub = new Map();
      for (const [folder, d] of byFolder) {
        const inside = folder === scope ? '' : folder.slice(cut);
        const end = inside.indexOf(sep);
        const sub = inside ? (end < 0 ? inside : inside.slice(0, end)) : null;
        const sk = sub ?? '';
        let s = bySub.get(sk);
        if (!s) bySub.set(sk, (s = { name: sub, rel: sub ? (scope ? scope + sep + sub : sub) : scope, size: 0, count: 0 }));
        s.size += d.size; s.count += d.count;
      }
      const sortDesc = (a, b) => b.size - a.size;
      return {
        bytes,
        count: files.length,
        largest,
        byCategory: [...byCat.values()].filter((c) => c.count).sort(sortDesc),
        byExtension: [...byExt.values()].sort(sortDesc),
        bySubfolder: [...bySub.values()].sort(sortDesc),
        byAge,
      };
    });
  }

  /** Files and bytes in the cleanup suggestions of the folder in focus (each file counted once). */
  freeable() {
    return this.#memo('freeable:' + this.filter.folder + (this.confirmedDuplicates ? ':hash' : ''), () => {
      const seen = new Set();
      let bytes = 0;
      for (const g of this.cleanupGroups()) for (const f of g.files) if (!seen.has(f)) { seen.add(f); bytes += f.size; }
      return { count: seen.size, bytes };
    });
  }

  /** Files of the whole analysis matched by each cleanup rule (each rule tested once per file). */
  #rules() {
    if (!this.#ruleHits) {
      const now = Date.now();
      const hits = new Map(CLEANUP_RULES.map((r) => [r.id, []]));
      const rules = CLEANUP_RULES.map((r) => [r.test, hits.get(r.id)]);
      for (const f of this.files) for (const [test, list] of rules) if (test(f, now)) list.push(f);
      this.#ruleHits = hits;
    }
    return this.#ruleHits;
  }

  /** Whether a file is inside the folder in focus. */
  #inScope() {
    const folder = this.filter.folder;
    if (!folder) return null;
    const prefix = folder + sepOf(this.root);
    return (f) => f.folder === folder || f.folder.startsWith(prefix);
  }

  cleanupGroups() {
    return this.#memo('cleanup:' + this.filter.folder + (this.confirmedDuplicates ? ':hash' : ''), () => {
      const files = this.scopeFiles();
      const hits = this.#rules();
      const inScope = this.#inScope();
      const groups = CLEANUP_RULES.map((r) => {
        const list = inScope ? hits.get(r.id).filter(inScope) : hits.get(r.id).slice();
        return { ...r, files: list, size: list.reduce((n, f) => n + f.size, 0) };
      });
      if (this.confirmedDuplicates) {
        const extras = files.filter((f) => this.confirmedDuplicates.has(f.path));
        groups.push({
          id: 'dupes', label: t('analysis.dupes.confirmed.label'), badge: t('analysis.dupes.confirmed.badge'), confirmed: true,
          desc: t('analysis.dupes.confirmed.desc', { tab: t('views.duplicates') }),
          files: extras, size: extras.reduce((s, f) => s + f.size, 0),
        });
      } else {
        const dup = !this.filter.folder && this.#dupRoot ? this.#dupRoot : findDuplicates(files);
        groups.push({
          id: 'dupes', label: t('analysis.dupes.heuristic.label'), badge: t('analysis.dupes.heuristic.badge'), heuristic: true,
          desc: tn('analysis.dupes.heuristic.desc', dup.groupCount, { tab: t('views.duplicates') }),
          files: dup.extras, size: dup.extras.reduce((s, f) => s + f.size, 0),
        });
      }
      for (const g of groups) g.files.sort((a, b) => b.size - a.size);
      return groups.filter((g) => g.files.length).sort((a, b) => b.size - a.size);
    });
  }

  /** List for the table: scope + filters + sorting. */
  filteredFiles() {
    return this.#memo('filtered', () => {
      const { category, ext, query, minSize, group } = this.filter;
      const q = query.trim().toLowerCase();
      const groupSet = group ? new Set((this.cleanupGroups().find((g) => g.id === group)?.files || []).map((f) => f.path)) : null;
      const keep = (f) =>
        (!category || f.cat === category) &&
        (!ext || (f.ext || NO_EXTENSION) === ext) &&
        f.size >= minSize &&
        (!groupSet || groupSet.has(f.path)) &&
        (!q || (f.ln ??= f.name.toLowerCase()).includes(q) || lowerFolder(f.folder).includes(q));
      const { key, dir } = this.sort;
      const scope = this.scopeFiles();
      // large lists: walk the order prepared by the worker (no sorting on the UI thread)
      if (scope.length >= WORKER_SORT_MIN) {
        let order = this.#orders.get(key);
        let d = dir;
        this.sorting = null;
        if (!order) {
          // not ready yet: ask the worker, and meanwhile show the list by size
          this.#prepareOrder(key);
          this.sorting = key;
          order = this.#orders.get('size');
          d = -1;
        }
        if (order) {
          const inScope = this.#inScope();
          const all = this.#all;
          const removed = this.#removed;
          const out = [];
          const take = (f) => { if ((!removed.size || !removed.has(f.path)) && (!inScope || inScope(f)) && keep(f)) out.push(f); };
          if (d > 0) for (let i = 0; i < order.length; i++) take(all[order[i]]);
          else for (let i = order.length - 1; i >= 0; i--) take(all[order[i]]);
          return out;
        }
        return scope.filter(keep);
      }
      this.sorting = null;
      const list = scope.filter(keep);
      const cmp = key === 'name' || key === 'folder' || key === 'ext'
        ? ((c) => (a, b) => dir * c.compare(a[key], b[key]))(collator())
        : (a, b) => dir * (a[key] - b[key]);
      return list.sort(cmp);
    });
  }

  /** Which column is being sorted in the background (null when the list is in order). */
  sorting = null;

  #orders = new Map();         // column → Uint32Array of file indexes, ascending
  #ordersPending = new Set();
  #worker = null;
  #nextSortId = 1;

  /** Asks the worker for the order of a column (once per analysis). */
  #prepareOrder(key) {
    if (this.#orders.has(key) || this.#ordersPending.has(key) || this.#all.length < WORKER_SORT_MIN) return;
    if (typeof Worker === 'undefined') return;
    const all = this.#all;
    let msg;
    if (key === 'size' || key === 'mtime') {
      const numbers = new Float64Array(all.length);
      for (let i = 0; i < all.length; i++) numbers[i] = all[i][key];
      msg = { numbers };
    } else if (key === 'name') msg = { texts: all.map((f) => f.name) };
    else if (key === 'folder') msg = { texts: all.map((f) => f.folder), texts2: all.map((f) => f.name) };
    else if (key === 'ext') msg = { texts: all.map((f) => f.ext), texts2: all.map((f) => f.name) };
    else return;
    this.#ordersPending.add(key);
    const id = this.#nextSortId++;
    try {
      this.#worker ||= new Worker(new URL('./sortWorker.js', import.meta.url));
    } catch { this.#ordersPending.delete(key); return; }
    const onMessage = (e) => {
      if (e.data.id !== id) return;
      this.#worker.removeEventListener('message', onMessage);
      if (this.#all !== all) return; // another analysis meanwhile
      this.#ordersPending.delete(key);
      this.#orders.set(key, e.data.order);
      if (this.sort.key === key) { this.#cache.delete('filtered'); this.#onDidChangeFilter.fire(); }
    };
    this.#worker.addEventListener('message', onMessage);
    this.#worker.postMessage({ id, ...msg }, msg.numbers ? [msg.numbers.buffer] : []);
  }
}

const folderLower = new Map();
/** Lowercase folder for the search: folders repeat, so each is lowered once. */
function lowerFolder(folder) {
  let l = folderLower.get(folder);
  if (l === undefined) {
    if (folderLower.size > 300000) folderLower.clear();
    l = folder.toLowerCase();
    folderLower.set(folder, l);
  }
  return l;
}

let collatorCache = null;
/** One collator for every comparison (creating one per comparison made sorting 50× slower). */
function collator() {
  const locale = getLocale();
  if (!collatorCache || collatorCache.locale !== locale) collatorCache = { locale, c: new Intl.Collator(locale, { numeric: true }) };
  return collatorCache.c;
}

/** Takes removed files out of the folder totals (and drops folders left empty). */
function subtractFromTree(top, removed) {
  for (const f of removed) {
    top.size -= f.size; top.count--;
    let node = top;
    const chain = [];
    for (const s of splitRel(f.folder)) {
      const child = node.children.get(s);
      if (!child) break;
      child.size -= f.size; child.count--;
      chain.push([node, s, child]);
      node = child;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const [parent, name, child] = chain[i];
      if (child.count <= 0) parent.children.delete(name);
    }
  }
}

function sepOf(root) {
  return root.includes('\\') ? '\\' : '/';
}

/** Folder tree with accumulated sizes (only folders that contain scanned files). */
function buildTree(files, root) {
  const sep = sepOf(root);
  const mk = (name, rel) => ({ name, rel, size: 0, count: 0, children: new Map() });
  const top = mk(root, '');
  // totals per folder first (a million files are a few thousand folders), then the tree from the folders
  const byFolder = new Map();
  for (const f of files) {
    let d = byFolder.get(f.folder);
    if (!d) byFolder.set(f.folder, (d = { size: 0, count: 0 }));
    d.size += f.size; d.count++;
  }
  for (const [folder, d] of byFolder) {
    let node = top;
    node.size += d.size; node.count += d.count;
    let rel = '';
    for (const s of splitRel(folder)) {
      rel = rel ? rel + sep + s : s;
      let child = node.children.get(s);
      if (!child) node.children.set(s, (child = mk(s, rel)));
      child.size += d.size; child.count += d.count;
      node = child;
    }
  }
  return top;
}
