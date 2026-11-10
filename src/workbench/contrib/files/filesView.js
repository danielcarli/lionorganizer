/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// File table with search, filters, sorting, selection and paging.
import { ViewPane } from '../../browser/viewPane.js';
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { showAiReportDialog } from '../report/aiReportDialog.js';
import { showAiImportDialog } from '../report/aiImportDialog.js';
import { missingBadge, removeFromListButton } from '../../browser/missingFile.js';
import { debounce } from '../../../base/common/event.js';
import { formatBytes, formatDate } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { CATEGORIES, CATEGORY_BY_ID } from '../../services/analysis/common/fileCategories.js';
import { categoryColor } from '../../browser/chartTheme.js';

const PAGE_SIZE = 100;
const MB = 1024 * 1024;
const SIZE_OPTIONS = [
  [0, t('files.size.any')], [1 * MB, t('files.size.over1MB')], [10 * MB, t('files.size.over10MB')],
  [100 * MB, t('files.size.over100MB')], [500 * MB, t('files.size.over500MB')], [1024 * MB, t('files.size.over1GB')],
];
const COLUMNS = [
  { key: 'name', label: t('files.column.name') },
  { key: 'folder', label: t('files.column.folder') },
  { key: 'ext', label: t('files.column.type') },
  { key: 'size', label: t('files.column.size'), num: true },
  { key: 'mtime', label: t('files.column.modified'), num: true },
];

export class FilesView extends ViewPane {
  page = 0;

  constructor(services) {
    super(services, 'files');
    this.search = h('input.search-input', {
      type: 'search', placeholder: t('files.search.placeholder'), spellcheck: false,
      oninput: debounce((e) => this.analysis.setFilter({ query: e.target.value }), 160),
    });
    this.toolbar = h('div.files-toolbar');
    this.selectionBar = h('div.selection-bar');
    this.thead = h('thead');
    this.tbody = h('tbody');
    this.pager = h('div.pager');
    this.element.append(
      this.toolbar,
      this.selectionBar,
      h('div.table-wrap', h('table.file-table', this.thead, this.tbody)),
      this.pager);

    this.analysis.onDidChangeData(() => this.invalidate());
    this.analysis.onDidChangeFilter(() => { this.page = 0; this.invalidate(); });
    this.analysis.onDidChangeSelection(() => { if (this.visible) { this.#renderSelectionBar(); this.#syncChecks(); } });
  }

  render() {
    if (!this.analysis.hasData) return;
    const list = this.analysis.filteredFiles();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    this.#renderToolbar(list);
    this.#renderSelectionBar();
    this.#renderHead();
    this.#renderRows(list);
    this.#renderPager(list.length, pages);
  }

  #renderToolbar(list) {
    const { analysis } = this;
    const f = analysis.filter;
    if (this.search.value !== f.query) this.search.value = f.query;
    const total = list.reduce((s, x) => s + x.size, 0);
    const groupLabel = f.group ? analysis.cleanupGroups().find((g) => g.id === f.group)?.label : null;
    const hasFilters = f.category || f.ext || f.query || f.minSize || f.group;

    const select = (value, options, onchange, label) => h('select.select', { 'aria-label': label, onchange },
      options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));

    setChildren(this.toolbar, 
      h('div.search-box', h('span.search-icon', { html: icon('search', 14) }), this.search),
      select(f.category ?? '', [['', t('files.filter.allTypes')], ...CATEGORIES.map((c) => [c.id, c.label])],
        (e) => analysis.setFilter({ category: e.target.value || null }), t('files.filter.type')),
      select(f.minSize, SIZE_OPTIONS, (e) => analysis.setFilter({ minSize: Number(e.target.value) }), t('files.filter.minSize')),
      f.ext ? chip(t('files.filter.extensionChip', { ext: f.ext.startsWith('(') ? f.ext : '.' + f.ext }), () => analysis.setFilter({ ext: null })) : null,
      groupLabel ? chip(t('files.filter.cleanupChip', { group: groupLabel }), () => analysis.setFilter({ group: null })) : null,
      hasFilters ? h('button.link', { onclick: () => analysis.resetFilters() }, t('files.filter.clear')) : null,
      h('div.toolbar-spacer'),
      h('span.toolbar-count', tn('files.toolbar.count', list.length, { size: formatBytes(total) })),
      h('button.btn.btn-secondary.btn-sm', { onclick: () => this.actions.exportCsv(list), title: t('files.toolbar.exportTitle') },
        h('span', { html: icon('download', 14) }), t('files.toolbar.export')),
      h('button.btn.btn-secondary.btn-sm.ai-report-button', { onclick: () => showAiReportDialog(this), title: t('report.buttonTitle') },
        h('span', { html: icon('sparkle', 14) }), t('report.button')),
      h('button.btn.btn-secondary.btn-sm.ai-import-button', { onclick: () => showAiImportDialog(this), title: t('aiImport.buttonTitle') },
        h('span', { html: icon('import', 14) }), t('aiImport.button')));
  }

  #renderSelectionBar() {
    const { analysis } = this;
    const n = analysis.selection.size;
    this.selectionBar.hidden = !n;
    if (!n) return;
    const files = analysis.selectedFiles();
    const bytes = files.reduce((s, f) => s + f.size, 0);
    setChildren(this.selectionBar, 
      h('span', tn('files.selection.summary', n, { size: formatBytes(bytes) })),
      h('div.toolbar-spacer'),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => analysis.setSelection([]) }, t('files.selection.clear')),
      h('button.btn.btn-danger.btn-sm', { onclick: () => this.actions.trash(files) }, h('span', { html: icon('trash', 14) }), t('common.moveToTrash')));
  }

  #renderHead() {
    const { sort } = this.analysis;
    this.headCheck = h('input', { type: 'checkbox', 'aria-label': t('files.table.selectPage'), onchange: (e) => this.#selectPage(e.target.checked) });
    setChildren(this.thead, h('tr',
      h('th.col-check', this.headCheck),
      COLUMNS.map((c) => h(`th.col-${c.key}${c.num ? '.num' : ''}`,
        { 'aria-sort': sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button.th-button', { onclick: () => this.analysis.setSort(c.key) },
          c.label,
          h('span.sort-indicator', { html: sort.key === c.key ? icon(sort.dir > 0 ? 'chevronDown' : 'chevronDown', 12) : '' , class: `sort-indicator${sort.dir > 0 ? ' asc' : ''}` })))),
      h('th.col-actions', h('span.visually-hidden', t('files.table.actions')))));
  }

  #renderRows(list) {
    const { analysis } = this;
    const pageItems = list.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    this.pageItems = pageItems;
    const max = list.reduce((m, f) => Math.max(m, f.size), 1);
    clear(this.tbody);
    if (!pageItems.length) {
      this.tbody.append(h('tr', h('td.empty-row', { colSpan: 7 }, t('files.table.empty'))));
      return;
    }
    const frag = document.createDocumentFragment();
    analysis.verify('files', pageItems.map((f) => f.path));
    for (const f of pageItems) {
      const missing = analysis.isMissing(f.path);
      const check = h('input', { type: 'checkbox', disabled: missing, checked: !missing && analysis.selection.has(f.path), 'aria-label': t('files.table.selectFile', { name: f.name }), onchange: (e) => analysis.toggleSelected(f.path, e.target.checked) });
      const ext = f.ext ? '.' + f.ext : '—';
      frag.append(h('tr', {
        'data-path': f.path,
        ondblclick: missing ? undefined : () => this.actions.reveal(f.path),
        class: missing ? 'is-missing' : analysis.selection.has(f.path) ? 'is-selected' : undefined,
      },
        h('td.col-check', check),
        h('td.col-name', { title: f.path }, h('span.swatch', { style: { background: categoryColor(f.cat) } }), h('span.cell-text', f.name), missing ? missingBadge() : null),
        h('td.col-folder', { title: f.folder || t('common.rootFolder') }, h('span.cell-text.muted', f.folder || '·')),
        h('td.col-ext', { title: CATEGORY_BY_ID[f.cat].label }, h('span.ext-badge', ext)),
        h('td.col-size.num', h('div.size-cell', h('span', formatBytes(f.size)), h('div.size-bar', h('span', { style: { width: `${Math.max(0.5, (f.size / max) * 100)}%` } })))),
        h('td.col-mtime.num.muted', formatDate(f.mtime)),
        h('td.col-actions', missing
          ? removeFromListButton(this.actions, f.path, { compact: true })
          : [h('button.icon-button', { title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 16), onclick: () => this.actions.reveal(f.path) }),
            h('button.icon-button.danger', { title: t('common.moveToTrash'), html: icon('trash', 16), onclick: () => this.actions.trash([f]) })])));
    }
    this.tbody.append(frag);
    this.#syncChecks();
  }

  #syncChecks() {
    const sel = this.analysis.selection;
    for (const tr of this.tbody.rows) {
      const p = tr.dataset.path;
      if (!p) continue;
      const on = sel.has(p);
      tr.classList.toggle('is-selected', on);
      const cb = tr.querySelector('input[type=checkbox]');
      if (cb) cb.checked = on;
    }
    if (this.headCheck && this.pageItems?.length) {
      const n = this.pageItems.filter((f) => sel.has(f.path)).length;
      this.headCheck.checked = n === this.pageItems.length;
      this.headCheck.indeterminate = n > 0 && n < this.pageItems.length;
    }
  }

  #selectPage(on) {
    const next = new Set(this.analysis.selection);
    for (const f of this.pageItems || []) on ? next.add(f.path) : next.delete(f.path);
    this.analysis.setSelection(next);
  }

  #renderPager(count, pages) {
    const from = count ? this.page * PAGE_SIZE + 1 : 0;
    const to = Math.min(count, (this.page + 1) * PAGE_SIZE);
    const go = (p) => { this.page = p; this.render(); this.element.querySelector('.table-wrap').scrollTop = 0; };
    setChildren(this.pager, 
      h('span.muted', t('files.pager.range', { from, to, total: count })),
      h('div.toolbar-spacer'),
      h('button.btn.btn-ghost.btn-sm', { disabled: this.page === 0, onclick: () => go(0) }, t('files.pager.first')),
      h('button.btn.btn-ghost.btn-sm', { disabled: this.page === 0, onclick: () => go(this.page - 1) }, t('files.pager.previous')),
      h('span.pager-page', t('files.pager.page', { page: this.page + 1, pages })),
      h('button.btn.btn-ghost.btn-sm', { disabled: this.page >= pages - 1, onclick: () => go(this.page + 1) }, t('files.pager.next')));
  }
}

function chip(label, onRemove) {
  return h('span.chip', label, h('button.chip-x', { title: t('files.filter.remove'), html: icon('close', 12), onclick: onRemove }));
}
