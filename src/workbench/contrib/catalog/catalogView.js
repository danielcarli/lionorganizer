/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Catalog: search across every folder analyzed so far, history/comparison between scans,
// recent operations (with Undo) and database maintenance.
// Works even without an open analysis.
import { ViewPane } from '../../browser/viewPane.js';
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { formatBytes, formatNumber, formatDate, baseName } from '../../../base/common/format.js';
import { t, tn, getLocale } from '../../../base/common/nls.js';

// Built lazily so it uses the active locale.
let dt = null;
const fmtDateTime = (ms) => {
  if (!ms) return '—';
  dt ||= new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return dt.format(new Date(ms));
};
const signed = (b) => (b > 0 ? '+' : b < 0 ? '−' : '') + formatBytes(Math.abs(b));
const OP_KINDS = ['trash', 'organize', 'rename', 'undo'];
const opLabel = (kind) => (OP_KINDS.includes(kind) ? t(`catalog.ops.kind.${kind}`) : kind);
const MB = 1024 * 1024;

export class CatalogView extends ViewPane {
  worksWithoutData = true;
  search = { query: '', minSize: 0, includeMissing: true };
  selectedScan = null;

  constructor(services) {
    super(services, 'catalog');
    this.catalog.onDidChange(() => this.invalidate());
    this.statsEl = h('section.cat-stats');
    this.searchEl = h('section.card.cat-section');
    this.historyEl = h('section.card.cat-section');
    this.opsEl = h('section.card.cat-section');
    this.rootsEl = h('section.card.cat-section');
    this.element.append(
      h('header.view-header',
        h('div.eyebrow', h('span', { html: icon('database', 14) }), t('catalog.eyebrow')),
        h('h1.view-title', t('catalog.title')),
        h('p.muted', t('catalog.intro'))),
      this.statsEl, this.searchEl, this.historyEl, this.opsEl, this.rootsEl);
  }

  async render() {
    if (!this.catalog.available) {
      setChildren(this.statsEl, h('div.notice', h('span.notice-icon', { html: icon('warning', 16) }),
        h('span.notice-text', this.catalog.status.error ? t('catalog.unavailableWithError', { error: this.catalog.status.error }) : t('catalog.unavailable'))));
      for (const el of [this.searchEl, this.historyEl, this.opsEl, this.rootsEl]) el.hidden = true;
      return;
    }
    for (const el of [this.searchEl, this.historyEl, this.opsEl, this.rootsEl]) el.hidden = false;
    try {
      const [stats, ops] = await Promise.all([this.catalog.stats(), this.catalog.operations()]);
      this.#renderStats(stats);
      this.#renderSearchShell();
      this.#runSearch();
      this.#renderOps(ops);
      this.#renderRoots(stats.roots);
      await this.#renderHistory();
    } catch (err) {
      this.notifications.warn(String(err.message || err));
    }
  }

  // ---------------------------------------------------------------- numbers and maintenance
  #renderStats(s) {
    const record = this.scan.settings.record;
    setChildren(this.statsEl,
      h('div.cat-kpis',
        kpi(t('catalog.kpi.files'), formatNumber(s.files)),
        kpi(t('catalog.kpi.roots'), formatNumber(s.roots.length)),
        kpi(t('catalog.kpi.scans'), formatNumber(s.scans)),
        kpi(t('catalog.kpi.hashed'), formatNumber(s.hashed)),
        kpi(t('catalog.kpi.dbSize'), formatBytes(s.dbBytes))),
      h('div.cat-tools',
        h('label.checkbox', { title: t('catalog.record.tooltip') },
          h('input', { type: 'checkbox', checked: record, onchange: (e) => { this.scan.setRecord(e.target.checked); } }),
          t('catalog.record.label')),
        h('div.toolbar-spacer'),
        h('button.btn.btn-ghost.btn-sm', { title: s.file, onclick: () => this.catalog.revealDb() }, h('span', { html: icon('reveal', 14) }), t('catalog.dbLocation')),
        h('button.btn.btn-secondary.btn-sm', { onclick: async () => { const f = await this.catalog.exportCsv(); if (f) this.notifications.info(t('catalog.exported', { file: f })); } },
          h('span', { html: icon('download', 14) }), t('catalog.exportCsv')),
        h('button.btn.btn-danger-outline.btn-sm', { disabled: !s.files && !s.scans, onclick: () => this.operations.clearCatalog() },
          h('span', { html: icon('trash', 14) }), t('catalog.clear'))));
  }

  // ---------------------------------------------------------------- search
  #renderSearchShell() {
    if (this.searchInput) return;
    const run = debounce(() => this.#runSearch(), 200);
    this.searchInput = h('input.search-input', { type: 'search', placeholder: t('catalog.search.placeholder'), spellcheck: false,
      oninput: (e) => { this.search.query = e.target.value; run(); } });
    this.searchResults = h('div.cat-results');
    setChildren(this.searchEl,
      h('header.cat-head', h('h2', h('span', { html: icon('search', 16) }), t('catalog.search.title')),
        h('p.muted', t('catalog.search.desc'))),
      h('div.files-toolbar.flush',
        h('div.search-box.grow', h('span.search-icon', { html: icon('search', 14) }), this.searchInput),
        h('select.select', { 'aria-label': t('catalog.search.minSize'), onchange: (e) => { this.search.minSize = Number(e.target.value); this.#runSearch(); } },
          [[0, t('catalog.search.size.any')], [MB, t('catalog.search.size.over1MB')], [100 * MB, t('catalog.search.size.over100MB')], [1024 * MB, t('catalog.search.size.over1GB')]].map(([v, l]) => h('option', { value: String(v) }, l))),
        h('label.checkbox', h('input', { type: 'checkbox', checked: true, onchange: (e) => { this.search.includeMissing = e.target.checked; this.#runSearch(); } }), t('catalog.search.includeMissing'))),
      this.searchResults);
  }

  async #runSearch() {
    if (!this.searchResults) return;
    let res;
    try { res = await this.catalog.search({ ...this.search, limit: 100 }); } catch (err) { setChildren(this.searchResults, h('p.field-error', err.message)); return; }
    if (!res.rows.length) {
      setChildren(this.searchResults, h('p.empty-hint', this.search.query ? t('catalog.search.noResults') : t('catalog.search.emptyCatalog')));
      return;
    }
    setChildren(this.searchResults,
      h('p.muted.small', res.total > res.rows.length
        ? tn('catalog.search.resultsTop', res.total, { size: formatBytes(res.totalBytes), shown: res.rows.length })
        : tn('catalog.search.results', res.total, { size: formatBytes(res.totalBytes) })),
      h('div.table-wrap.static', h('table.file-table',
        h('thead', h('tr', h('th.col-name', t('catalog.col.name')), h('th', t('catalog.col.path')), h('th.num.col-size', t('catalog.col.size')), h('th.num.col-mtime', t('catalog.col.modified')), h('th.col-status', t('catalog.col.status')), h('th.col-hash', t('catalog.col.hash')), h('th.col-actions'))),
        h('tbody', res.rows.map((r) => h('tr',
          h('td.col-name', { title: r.name }, h('span.cell-text', r.name)),
          h('td.col-path', { title: r.path }, h('span.cell-text.muted', relDir(r))),
          h('td.num.col-size', formatBytes(r.size)),
          h('td.num.col-mtime.muted', formatDate(r.mtime)),
          h('td.col-status', r.missing ? h('span.pill.warn', t('catalog.status.missing')) : h('span.pill.ok', t('catalog.status.present'))),
          h('td.col-hash', r.hash ? h('code.hash', { title: `SHA-256 ${r.hash}` }, r.hash.slice(0, 10) + '…') : h('span.muted', '—')),
          h('td.col-actions', r.missing ? null : h('button.icon-button', { title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 15), onclick: () => this.actions.reveal(r.path) }))))))));
  }

  // ---------------------------------------------------------------- history
  async #renderHistory() {
    const root = this.analysis.root || this.scan.folder;
    if (!root) {
      setChildren(this.historyEl, h('header.cat-head', h('h2', h('span', { html: icon('history', 16) }), t('catalog.history.title')), h('p.muted', t('catalog.history.noFolder'))));
      return;
    }
    const hist = await this.catalog.history(root);
    const head = h('header.cat-head', h('h2', h('span', { html: icon('history', 16) }), t('catalog.history.titleFor', { folder: baseName(root) })),
      h('p.muted', t('catalog.history.desc')));
    if (!hist.scans.length) {
      setChildren(this.historyEl, head, h('p.empty-hint', t('catalog.history.empty')));
      return;
    }
    // a new scan becomes the selected one; otherwise keep the user's choice
    if (hist.scans[0].id !== this.latestScan || !hist.scans.some((s) => s.id === this.selectedScan)) {
      this.latestScan = hist.scans[0].id;
      this.selectedScan = hist.scans[0].id;
    }
    const maxBytes = Math.max(...hist.scans.map((s) => s.total_bytes), 1);
    const list = h('div.hist-list', hist.scans.map((s, i) => {
      const prev = hist.scans[i + 1];
      const delta = prev ? s.total_bytes - prev.total_bytes : null;
      return h('button.hist-row', { class: `hist-row${s.id === this.selectedScan ? ' active' : ''}`, onclick: () => { this.selectedScan = s.id; this.#renderHistory(); } },
        h('span.hist-date', fmtDateTime(s.finished_at)),
        h('span.hist-bar', h('span', { style: { width: `${(s.total_bytes / maxBytes) * 100}%` } })),
        h('span.hist-total', formatBytes(s.total_bytes)),
        h('span.hist-delta', { class: `hist-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}` }, delta === null ? t('catalog.history.first') : signed(delta)));
    }));
    const cmp = await this.catalog.compare(this.selectedScan);
    setChildren(this.historyEl, head, h('div.hist-layout', list, this.#comparison(cmp)));
  }

  #comparison(c) {
    if (!c) return h('div');
    if (!c.prev) return h('div.hist-compare', h('p.empty-hint', t('catalog.history.firstScan')));
    const sum = Object.fromEntries(c.summary.map((s) => [s.kind, s]));
    const chip = (kind, label, cls) => {
      const s = sum[kind];
      return h(`div.cmp-chip.${cls}`, h('span.fact-label', label), h('strong', formatNumber(s?.count || 0)),
        h('span.muted.small', kind === 'grew' || kind === 'shrank' ? signed((s?.bytes || 0) - (s?.prev_bytes || 0)) : formatBytes(s?.bytes || 0)));
    };
    const maxDelta = Math.max(...c.folderDelta.map((f) => Math.abs(f.delta)), 1);
    const fileList = (title, rows, fmt) => rows.length ? h('div.cmp-list', h('h4', title), h('ul', rows.map((r) =>
      h('li', h('span.cell-text', { title: r.path }, baseName(r.path)), h('span.muted.small', fmt(r)))))) : null;
    return h('div.hist-compare',
      h('p.muted.small', t('catalog.compare.summary', { current: fmtDateTime(c.scan.finished_at), previous: fmtDateTime(c.prev.finished_at), delta: signed(c.scan.total_bytes - c.prev.total_bytes) })),
      h('div.cmp-chips', chip('new', t('catalog.compare.new'), 'new'), chip('removed', t('catalog.compare.removed'), 'removed'), chip('grew', t('catalog.compare.grew'), 'grew'), chip('shrank', t('catalog.compare.shrank'), 'shrank')),
      c.folderDelta.length ? h('div.cmp-folders', h('h4', t('catalog.compare.topFolders')),
        c.folderDelta.map((f) => h('div.cmp-folder',
          h('span.cell-text', f.name || t('catalog.compare.looseFiles')),
          h('span.cmp-diverge',
            h('span.neg', h('span', { style: { width: f.delta < 0 ? `${(Math.abs(f.delta) / maxDelta) * 100}%` : '0' } })),
            h('span.pos', h('span', { style: { width: f.delta > 0 ? `${(f.delta / maxDelta) * 100}%` : '0' } }))),
          h('span.cmp-folder-val', signed(f.delta))))) : null,
      h('div.cmp-lists',
        fileList(t('catalog.compare.largestNew'), c.newFiles, (r) => formatBytes(r.size)),
        fileList(t('catalog.compare.largestRemoved'), c.removedFiles, (r) => formatBytes(r.size)),
        fileList(t('catalog.compare.mostGrown'), c.grewFiles, (r) => `${formatBytes(r.prev_size)} → ${formatBytes(r.size)}`)));
  }

  // ---------------------------------------------------------------- operations
  #renderOps(ops) {
    setChildren(this.opsEl,
      h('header.cat-head', h('h2', h('span', { html: icon('undo', 16) }), t('catalog.ops.title')),
        h('p.muted', t('catalog.ops.desc'))),
      ops.length
        ? h('div.ops-list', ops.map((o) => h('div.op-row',
            h('span.pill', opLabel(o.kind)),
            h('span.op-summary', o.summary, o.bytes ? h('span.muted', ` · ${formatBytes(o.bytes)}`) : null),
            h('span.muted.small', fmtDateTime(o.created_at)),
            o.undoable && !o.undone_at
              ? h('button.btn.btn-secondary.btn-sm', { onclick: () => this.operations.undo(o.id) }, h('span', { html: icon('undo', 13) }), t('catalog.ops.undo'))
              : h('span.muted.small.op-status', o.undone_at ? t('catalog.ops.undone') : o.kind === 'trash' ? t('catalog.ops.restoreFromBin') : ''))))
        : h('p.empty-hint', t('catalog.ops.empty')));
  }

  #renderRoots(roots) {
    setChildren(this.rootsEl,
      h('header.cat-head', h('h2', h('span', { html: icon('folder', 16) }), t('catalog.roots.title'))),
      roots.length
        ? h('div.ops-list', roots.map((r) => h('div.op-row.root-row',
            h('span.op-summary', { title: r.path }, h('strong', baseName(r.path)), h('span.muted.small', ` ${r.path}`)),
            h('span.muted.small', t('catalog.roots.stats', { files: tn('common.files', r.files), size: formatBytes(r.bytes) })),
            h('span.muted.small', tn('catalog.roots.scans', r.scans, { last: fmtDateTime(r.last_scan_at) })))))
        : h('p.empty-hint', t('catalog.roots.empty')));
  }
}

/** The file's folder relative to the analyzed folder (e.g. "Projects/Theater/Plans"). */
function relDir(r) {
  const dir = r.path.slice(0, Math.max(r.path.lastIndexOf('\\'), r.path.lastIndexOf('/')));
  return r.root && dir.startsWith(r.root) ? baseName(r.root) + dir.slice(r.root.length) : dir;
}

function kpi(label, value) {
  return h('div.cat-kpi', h('span.fact-label', label), h('strong', value));
}
