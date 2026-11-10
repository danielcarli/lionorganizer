/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Central analysis model: files, folder tree, filters, sorting and selection.
// The "parts" and "views" only read from here and react to the events.
import { Emitter } from '../../../../base/common/event.js';
import { categorize, CATEGORIES, CLEANUP_RULES, findDuplicates } from '../common/fileCategories.js';
import { splitRel } from '../../../../base/common/format.js';
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

export class AnalysisService {
  #onDidChangeData = new Emitter();
  #onDidChangeFilter = new Emitter();
  #onDidChangeSelection = new Emitter();
  #onDidFindMissing = new Emitter();
  onDidChangeData = this.#onDidChangeData.event;
  /** Fires with the number of files newly found missing (deleted or moved outside the app). */
  onDidFindMissing = this.#onDidFindMissing.event;
  onDidChangeFilter = this.#onDidChangeFilter.event;
  onDidChangeSelection = this.#onDidChangeSelection.event;

  result = null;
  files = [];
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

  setResult(result) {
    const { files, ...meta } = result;
    for (const f of files) f.cat = categorize(f.ext);
    this.result = meta;
    this.files = files;
    this.filter = { ...EMPTY_FILTER };
    this.selection.clear();
    this.missing.clear();
    this.#checked.clear();
    this.#visible.clear();
    this.#rebuild();
    this.#onDidChangeData.fire();
    this.#onDidChangeFilter.fire();
    this.#onDidChangeSelection.fire();
  }

  removeFiles(paths) {
    const gone = new Set(paths);
    if (!gone.size) return;
    this.files = this.files.filter((f) => !gone.has(f.path));
    for (const p of gone) { this.selection.delete(p); this.missing.delete(p); }
    this.#rebuild();
    this.#onDidChangeData.fire();
    this.#onDidChangeSelection.fire();
  }

  // ---------- files that no longer exist ----------
  isMissing(path) { return this.missing.has(path); }
  hasFile(path) { return this.files.some((f) => f.path === path); }

  /** Marks files as missing (shown in gray). Returns how many were new. */
  markMissing(paths) {
    const known = new Set(this.files.map((f) => f.path));
    const fresh = (paths || []).filter((p) => known.has(p) && !this.missing.has(p));
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
    this.#cache.delete('cleanup');
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
    }
    this.#rebuild();
    this.#onDidChangeData.fire();
    this.#onDidChangeSelection.fire();
  }

  #rebuild() {
    this.#cache.clear();
    this.tree = buildTree(this.files, this.result.root);
  }

  // ---------- filters ----------
  setFilter(patch) {
    this.filter = { ...this.filter, ...patch };
    this.#cache.delete('filtered');
    if ('folder' in patch) this.#cache.clear();
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
    if (!this.#cache.has(key)) this.#cache.set(key, compute());
    return this.#cache.get(key);
  }

  /** Files inside the folder in focus (tree/breadcrumb). */
  scopeFiles() {
    return this.#memo('scope', () => {
      const folder = this.filter.folder;
      if (!folder) return this.files;
      const sep = folder.includes('\\') || this.root.includes('\\') ? '\\' : '/';
      const prefix = folder + sep;
      return this.files.filter((f) => f.folder === folder || f.folder.startsWith(prefix));
    });
  }

  summary() {
    return this.#memo('summary', () => {
      const files = this.scopeFiles();
      let bytes = 0;
      let largest = null;
      const byCat = new Map(CATEGORIES.map((c) => [c.id, { id: c.id, size: 0, count: 0 }]));
      const byExt = new Map();
      const bySub = new Map();
      const byAge = AGE_BUCKETS.map((b) => ({ ...b, size: 0, count: 0 }));
      const now = Date.now();
      const depth = splitRel(this.filter.folder).length;

      for (const f of files) {
        bytes += f.size;
        if (!largest || f.size > largest.size) largest = f;
        const c = byCat.get(f.cat); c.size += f.size; c.count++;
        const ek = f.ext || NO_EXTENSION;
        const e = byExt.get(ek) || { ext: ek, size: 0, count: 0, cat: f.cat };
        e.size += f.size; e.count++; byExt.set(ek, e);
        const segs = splitRel(f.folder);
        const sub = segs.length > depth ? segs[depth] : null;
        const sk = sub ?? '';
        const s = bySub.get(sk) || { name: sub, rel: sub ? [...segs.slice(0, depth + 1)].join(sepOf(this.root)) : this.filter.folder, size: 0, count: 0 };
        s.size += f.size; s.count++; bySub.set(sk, s);
        const age = now - f.mtime;
        const b = byAge.find((x) => age < x.max); b.size += f.size; b.count++;
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

  cleanupGroups() {
    return this.#memo('cleanup', () => {
      const files = this.scopeFiles();
      const now = Date.now();
      const groups = CLEANUP_RULES.map((r) => ({ ...r, files: [], size: 0 }));
      for (const f of files) {
        for (const g of groups) if (g.test(f, now)) { g.files.push(f); g.size += f.size; }
      }
      if (this.confirmedDuplicates) {
        const extras = files.filter((f) => this.confirmedDuplicates.has(f.path));
        groups.push({
          id: 'dupes', label: t('analysis.dupes.confirmed.label'), badge: t('analysis.dupes.confirmed.badge'), confirmed: true,
          desc: t('analysis.dupes.confirmed.desc', { tab: t('views.duplicates') }),
          files: extras, size: extras.reduce((s, f) => s + f.size, 0),
        });
      } else {
        const dup = findDuplicates(files);
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
      const list = this.scopeFiles().filter((f) =>
        (!category || f.cat === category) &&
        (!ext || (f.ext || NO_EXTENSION) === ext) &&
        f.size >= minSize &&
        (!groupSet || groupSet.has(f.path)) &&
        (!q || f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)));
      const { key, dir } = this.sort;
      const cmp = key === 'name' || key === 'folder' || key === 'ext'
        ? (a, b) => dir * a[key].localeCompare(b[key], getLocale(), { numeric: true })
        : (a, b) => dir * (a[key] - b[key]);
      return list.sort(cmp);
    });
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
  for (const f of files) {
    let node = top;
    node.size += f.size; node.count++;
    const segs = splitRel(f.folder);
    let rel = '';
    for (const s of segs) {
      rel = rel ? rel + sep + s : s;
      let child = node.children.get(s);
      if (!child) node.children.set(s, (child = mk(s, rel)));
      child.size += f.size; child.count++;
      node = child;
    }
  }
  return top;
}
