/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Organize: (1) move loose files into subfolders by type; (2) batch rename.
// Everything shows a preview first; running always asks for the confirmation code and can be undone.
import { ViewPane } from '../../browser/viewPane.js';
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { formatBytes, formatNumber, baseName, joinPath, splitRel } from '../../../base/common/format.js';
import { t, tn, getLocale } from '../../../base/common/nls.js';
import { CATEGORIES } from '../../services/analysis/common/fileCategories.js';
import { categoryColor } from '../../browser/chartTheme.js';

const SKIP = (f) => f.name.startsWith('~$') || /^(desktop\.ini|thumbs\.db)$/i.test(f.name) || ['tmp', 'temp', 'lock', 'part', 'crdownload'].includes(f.ext);
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/;
const INVALID_ALL = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const PREVIEW_ROWS = 60;

/**
 * Name of the subfolder created for a category (localized). Characters that are invalid in
 * Windows file names are stripped, so a translation can never produce an unusable folder name.
 */
function folderName(cat) {
  const name = t(`organize.folders.${cat}`).replace(INVALID_ALL, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  return name && !RESERVED.test(name) ? name : cat;
}

// Subfolder names keyed by category id; getters so they always follow the active language.
const FOLDER_NAMES = Object.freeze(Object.defineProperties({}, Object.fromEntries(CATEGORIES.map((c) => [c.id, { get: () => folderName(c.id), enumerable: true }]))));

// Batch-rename tokens: canonical English tokens plus the old Portuguese ones as aliases.
const TOKEN_ALIASES = { '{nome}': '{name}', '{data}': '{date}', '{pasta}': '{folder}' };

export class OrganizeView extends ViewPane {
  // the user's choices
  cats = new Set(CATEGORIES.map((c) => c.id).filter((id) => id !== 'other'));
  rn = { pattern: '{name}', find: '', replace: '', lower: false, noAccents: false, hyphens: false, order: 'name', start: 1 };

  constructor(services) {
    super(services, 'organize');
    this.analysis.onDidChangeData(() => this.invalidate());
    this.analysis.onDidChangeFilter(() => this.invalidate());
    this.analysis.onDidChangeSelection(() => { if (this.visible) this.#renderRename(); });
    this.byType = h('section.card.org-card');
    this.renameCard = h('section.card.org-card');
    this.element.append(
      h('header.view-header',
        h('div.eyebrow', h('span', { html: icon('organize', 14) }), t('organize.eyebrow')),
        h('h1.view-title', t('organize.title')),
        h('p.muted', t('organize.intro'))),
      this.byType,
      this.renameCard);
  }

  render() {
    if (!this.analysis.hasData) return;
    this.#renderByType();
    this.#renderRename();
  }

  // ================================================================ organize by type
  #planByType() {
    const { analysis } = this;
    const rel = analysis.filter.folder;
    const loose = analysis.files.filter((f) => f.folder === rel && !SKIP(f));
    const base = joinPath(analysis.root, rel);
    const sep = analysis.root.includes('\\') ? '\\' : '/';
    const byCat = new Map();
    for (const f of loose) {
      let g = byCat.get(f.cat);
      if (!g) byCat.set(f.cat, (g = { cat: f.cat, files: [], bytes: 0 }));
      g.files.push(f); g.bytes += f.size;
    }
    const groups = CATEGORIES.map((c) => byCat.get(c.id)).filter(Boolean);
    const moves = groups.filter((g) => this.cats.has(g.cat))
      .flatMap((g) => g.files.map((f) => ({ src: f.path, dst: base.replace(/[\\/]+$/, '') + sep + folderName(g.cat) + sep + f.name })));
    return { rel, loose, groups, moves };
  }

  #renderByType() {
    const plan = this.#planByType();
    const folderLabel = plan.rel ? splitRel(plan.rel).at(-1) : baseName(this.analysis.root);
    const selectedGroups = plan.groups.filter((g) => this.cats.has(g.cat));

    setChildren(this.byType,
      h('header.org-head',
        h('div',
          h('h2', h('span', { html: icon('organize', 16) }), t('organize.byType.title')),
          h('p.muted', t('organize.byType.desc', { image: folderName('image'), cad: folderName('cad'), doc: folderName('doc') }))),
        h('div.org-target',
          h('span.fact-label', t('organize.byType.target')),
          h('strong', { title: joinPath(this.analysis.root, plan.rel) }, folderLabel),
          h('span.muted.small', t('organize.byType.targetHint')))),
      plan.loose.length
        ? h('div.org-grid',
            plan.groups.map((g) => {
              const on = this.cats.has(g.cat);
              return h(`label.org-cat${on ? '.on' : ''}`,
                h('input', { type: 'checkbox', checked: on, onchange: (e) => { e.target.checked ? this.cats.add(g.cat) : this.cats.delete(g.cat); this.#renderByType(); } }),
                h('span.swatch', { style: { background: categoryColor(g.cat) } }),
                h('span.org-cat-name', h('strong', folderName(g.cat)), h('span.muted.small', t('organize.byType.catStats', { files: tn('common.files', g.files.length), size: formatBytes(g.bytes) }))),
                h('span.org-cat-sample.muted.small', { title: g.files.map((f) => f.name).join('\n') }, g.files.slice(0, 3).map((f) => f.name).join(', ') + (g.files.length > 3 ? '…' : '')));
            }))
        : h('p.empty-hint', t('organize.byType.empty')),
      h('footer.org-foot',
        h('span.muted', plan.moves.length
          ? tn('organize.byType.summary', plan.moves.length, { subfolders: tn('organize.byType.subfolders', selectedGroups.length) })
          : t('organize.byType.pickOne')),
        h('button.btn.btn-primary', { disabled: !plan.moves.length, onclick: () => this.operations.organize(plan.moves) },
          h('span', { html: icon('organize', 14) }), tn('organize.byType.run', plan.moves.length))));
  }

  // ================================================================ batch rename
  #selectedFiles() {
    const files = this.analysis.selectedFiles();
    const locale = getLocale();
    const cmp = this.rn.order === 'date' ? (a, b) => a.mtime - b.mtime : (a, b) => a.name.localeCompare(b.name, locale, { numeric: true });
    return files.sort(cmp);
  }

  #planRename(files) {
    const o = this.rn;
    const digits = Math.max(2, String(o.start + files.length - 1).length);
    let pattern = o.pattern || '{name}';
    for (const [alias, token] of Object.entries(TOKEN_ALIASES)) pattern = pattern.replaceAll(alias, token);
    const rows = files.map((f, i) => {
      const dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
      const ext = dot > 0 ? f.name.slice(dot) : '';
      const d = new Date(f.mtime);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let out = pattern
        .replaceAll('{name}', stem)
        .replaceAll('{date}', date)
        .replaceAll('{n}', String(o.start + i).padStart(digits, '0'))
        .replaceAll('{folder}', splitRel(f.folder).at(-1) || baseName(this.analysis.root));
      if (o.find) out = out.split(o.find).join(o.replace);
      if (o.noAccents) out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (o.hyphens) out = out.replace(/\s+/g, '-');
      if (o.lower) out = out.toLowerCase();
      out = out.trim();
      const name = out + (o.lower ? ext.toLowerCase() : ext);
      return { f, name, error: validate(out, name) };
    });
    // duplicate names in the same folder (case-insensitive, like Windows)
    const seen = new Map();
    for (const r of rows) {
      const key = (r.f.folder + '|' + r.name).toLowerCase();
      if (seen.has(key)) { r.error ||= t('organize.rename.error.duplicate'); seen.get(key).error ||= t('organize.rename.error.duplicate'); }
      seen.set(key, r);
    }
    // conflicts with files already in the folder that are not being renamed
    const renaming = new Set(rows.map((r) => r.f.path));
    const existing = new Set(this.analysis.files.filter((f) => !renaming.has(f.path)).map((f) => (f.folder + '|' + f.name).toLowerCase()));
    for (const r of rows) if (!r.error && existing.has((r.f.folder + '|' + r.name).toLowerCase())) r.error = t('organize.rename.error.exists');
    const changes = rows.filter((r) => r.name !== r.f.name);
    return { rows, changes, errors: rows.filter((r) => r.error) };
  }

  #renderRename() {
    const files = this.#selectedFiles();
    const o = this.rn;
    const head = h('header.org-head',
      h('div',
        h('h2', h('span', { html: icon('rename', 16) }), t('organize.rename.title')),
        h('p.muted', t('organize.rename.desc'))),
      h('div.org-target',
        h('span.fact-label', t('organize.rename.selected')),
        h('strong', formatNumber(files.length)),
        h('button.link', { onclick: () => this.layout.openView('files') }, files.length ? t('organize.rename.changeSelection') : t('organize.rename.selectInFiles'))));

    if (!files.length) {
      setChildren(this.renameCard, head, h('p.empty-hint', t('organize.rename.empty')));
      return;
    }

    const plan = this.#planRename(files);
    const update = (patch) => { Object.assign(this.rn, patch); this.#renderRenamePreview(); };
    const debounced = debounce(update, 120);
    const token = (tok, hint) => h('button.chip-token', { title: hint, onclick: () => { patternInput.value += tok; update({ pattern: patternInput.value }); patternInput.focus(); } }, tok);
    const patternInput = h('input.text-input.mono', { value: o.pattern, spellcheck: false, oninput: (e) => debounced({ pattern: e.target.value }), 'aria-label': t('organize.rename.patternAria') });
    const check = (key, label) => h('label.checkbox', h('input', { type: 'checkbox', checked: o[key], onchange: (e) => update({ [key]: e.target.checked }) }), label);

    this.previewEl = h('div.rn-preview');
    setChildren(this.renameCard, head,
      h('div.rn-form',
        h('div.field',
          h('label.field-label', t('organize.rename.pattern')),
          patternInput,
          h('div.rn-tokens',
            token('{name}', t('organize.rename.token.name')),
            token('{date}', t('organize.rename.token.date')),
            token('{n}', t('organize.rename.token.n')),
            token('{folder}', t('organize.rename.token.folder')))),
        h('div.rn-row',
          h('div.field', h('label.field-label', t('organize.rename.find')), h('input.text-input', { value: o.find, oninput: (e) => debounced({ find: e.target.value }) })),
          h('div.field', h('label.field-label', t('organize.rename.replace')), h('input.text-input', { value: o.replace, oninput: (e) => debounced({ replace: e.target.value }) })),
          h('div.field', h('label.field-label', t('organize.rename.order')),
            h('select.select', { onchange: (e) => update({ order: e.target.value }) },
              h('option', { value: 'name', selected: o.order === 'name' }, t('organize.rename.order.name')),
              h('option', { value: 'date', selected: o.order === 'date' }, t('organize.rename.order.date')))),
          h('div.field', h('label.field-label', t('organize.rename.start')), h('input.text-input.num-input', { type: 'number', min: '0', value: String(o.start), oninput: (e) => debounced({ start: Math.max(0, parseInt(e.target.value, 10) || 0) }) }))),
        h('div.rn-checks', check('lower', t('organize.rename.option.lower')), check('noAccents', t('organize.rename.option.noAccents')), check('hyphens', t('organize.rename.option.hyphens')))),
      this.previewEl);
    this.#renderRenamePreview(plan);
  }

  #renderRenamePreview(plan = this.#planRename(this.#selectedFiles())) {
    if (!this.previewEl) return;
    const rows = plan.rows.slice(0, PREVIEW_ROWS);
    setChildren(this.previewEl,
      h('div.rn-table',
        h('div.rn-tr.rn-th', h('span', t('organize.rename.col.current')), h('span'), h('span', t('organize.rename.col.new'))),
        rows.map((r) => h(`div.rn-tr${r.error ? '.err' : r.name === r.f.name ? '.same' : ''}`,
          h('span.rn-old', { title: r.f.path }, r.f.name),
          h('span.rn-arrow', { html: icon('chevronRight', 12) }),
          h('span.rn-new', { title: r.error || r.name }, r.name, r.error ? h('em', ` — ${r.error}`) : null))),
        plan.rows.length > PREVIEW_ROWS ? h('div.rn-tr.rn-more', tn('organize.rename.more', plan.rows.length - PREVIEW_ROWS)) : null),
      h('footer.org-foot',
        h('span.muted', plan.errors.length
          ? tn('organize.rename.needFix', plan.errors.length)
          : tn('organize.rename.summary', plan.rows.length, { changed: plan.changes.length })),
        h('button.btn.btn-primary', {
          disabled: !!plan.errors.length || !plan.changes.length,
          onclick: () => this.operations.rename(plan.changes.map((r) => ({ src: r.f.path, name: r.name }))),
        }, h('span', { html: icon('rename', 14) }), tn('organize.rename.run', plan.changes.length))));
  }
}

function validate(stem, name) {
  if (!stem) return t('organize.rename.error.empty');
  if (name.length > 240) return t('organize.rename.error.tooLong');
  if (INVALID.test(name)) return t('organize.rename.error.invalidChar');
  if (/[. ]$/.test(name)) return t('organize.rename.error.trailing');
  if (RESERVED.test(name)) return t('organize.rename.error.reserved');
  return null;
}

export { FOLDER_NAMES };
