/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Overview: headline numbers, rose chart by type, subfolder treemap, dot matrix,
// extensions, file age and largest files.
import { ViewPane } from '../../browser/viewPane.js';
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { missingBadge, removeFromListButton } from '../../browser/missingFile.js';
import { formatBytes, formatNumber, formatPercent, formatDate, bytesParts } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { CATEGORIES, CATEGORY_BY_ID } from '../../services/analysis/common/fileCategories.js';
import { categoryColor, dotColor } from '../../browser/chartTheme.js';
import { roseChart } from '../../../base/browser/ui/charts/roseChart.js';
import { treemap } from '../../../base/browser/ui/charts/treemap.js';
import { dotMatrix } from '../../../base/browser/ui/charts/dotMatrix.js';
import { barList } from '../../../base/browser/ui/charts/barList.js';
import { hatchColumns } from '../../../base/browser/ui/charts/hatchColumns.js';
import { showAccessDialog } from '../access/accessDialog.js';
import { formatDuration, baseName } from '../../../base/common/format.js';

const TOP_FOLDERS = 14;
const TOP_EXTS = 10;
const TOP_FILES = 10;

export class OverviewView extends ViewPane {
  constructor(services) {
    super(services, 'overview');
    const inv = () => this.invalidate();
    this.analysis.onDidChangeData(inv);
    this.analysis.onDidChangeFilter(() => { if (this.lastFolder !== this.analysis.filter.folder) inv(); });
    this.layout.onDidChangeTheme(inv);
  }

  render() {
    const { analysis } = this;
    if (!analysis.hasData) return;
    this.lastFolder = analysis.filter.folder;
    const s = analysis.summary();
    setChildren(this.element, 
      this.#hero(s),
      analysis.filter.folder ? this.#notices() : this.#coverage(),
      h('div.overview-grid',
        card(t('overview.card.types.title'), t('overview.card.types.subtitle'), this.#types(s), 'span-2'),
        card(t('overview.card.folders.title'), t('overview.card.folders.subtitle'), this.#folders(s), 'span-2'),
        card(t('overview.card.dots.title'), null, this.#dots(s)),
        card(t('overview.card.exts.title'), t('overview.card.exts.subtitle'), this.#exts(s)),
        card(t('overview.card.age.title'), t('overview.card.age.subtitle'), this.#age(s)),
        card(t('overview.card.biggest.title'), null, this.#biggest())));
  }

  // ---------- headline numbers ----------
  #hero(s) {
    const freeable = this.#freeable();
    const top = s.byCategory[0];
    return h('section.hero',
      h('div.hero-main',
        h('div.eyebrow', t('overview.hero.analyzed')),
        bigNumber(s.bytes, 'hero-number'),
        h('div.hero-facts',
          fact(t('overview.hero.files'), formatNumber(s.count)),
          fact(t('overview.hero.topType'), top ? `${CATEGORY_BY_ID[top.id].label} · ${formatPercent(top.size, s.bytes)}` : '—'),
          s.largest ? fact(t('overview.hero.largestFile'), `${formatBytes(s.largest.size)} · ${s.largest.name}`, s.largest.path) : null)),
      h('button.hero-block', { onclick: () => this.layout.openView('cleanup'), title: t('overview.hero.openCleanup') },
        h('div.hero-block-top', h('span.eyebrow', h('span.hb-icon', '!'), t('overview.hero.freeable')), h('span.hb-arrow', { html: icon('arrowUpRight', 18) })),
        bigNumber(freeable.bytes, 'hero-block-number'),
        h('div.hero-block-sub', tn('overview.hero.freeableFiles', freeable.count)),
        hatchStrip(freeable.bytes / (s.bytes || 1))));
  }

  #freeable() {
    const m = new Map();
    for (const g of this.analysis.cleanupGroups()) for (const f of g.files) m.set(f.path, f.size);
    return { count: m.size, bytes: [...m.values()].reduce((a, b) => a + b, 0) };
  }

  /**
   * How much of the disk the analysis covers, and why the numbers differ: space used on the disk vs space
   * analyzed, with the reasons (inaccessible items, depth limit, ignored folders, system files, other folders)
   * and how far the analysis went.
   */
  #coverage() {
    const { analysis } = this;
    const r = analysis.result;
    const analyzed = analysis.tree.size;
    const d = r.disk;
    const busy = this.scan.busy;
    const errors = r.errorCount ?? r.errors.length;
    const skipped = r.skippedCount ?? r.skippedDirs.length;
    const reasons = [];
    const reason = (iconId, text, ...actions) => reasons.push(h('li.coverage-reason', h('span.cr-icon', { html: icon(iconId, 15) }), h('span.cr-text', text), ...actions));

    if (errors) {
      reason('warning', tn('overview.coverage.inaccessible', errors),
        h('button.btn.btn-secondary.btn-sm.coverage-access', { onclick: () => showAccessDialog(this) }, t('overview.coverage.seeWhich')));
    }
    if (skipped && r.maxDepth !== null) {
      reason('layers', tn('overview.notice.depthLimit', skipped, { levels: tn('overview.notice.levels', r.maxDepth) }),
        h('button.btn.btn-secondary.btn-sm', { disabled: busy, onclick: () => { this.scan.setUnlimited(false); this.scan.setDepth((r.maxDepth ?? 0) + 2); this.scan.scan(); } }, t('overview.notice.readMore')),
        h('button.btn.btn-ghost.btn-sm', { disabled: busy, onclick: () => { this.scan.setUnlimited(true); this.scan.scan(); } }, t('overview.notice.readAll')));
    }
    if (r.ignoredCount) {
      reason('stop', tn('overview.notice.ignored', r.ignoredCount),
        h('button.btn.btn-ghost.btn-sm', { disabled: busy, onclick: () => { this.scan.setIgnoreEnabled(false); this.scan.scan(); } }, t('overview.notice.analyzeAll')));
    }
    if (r.cancelled) reason('warning', t('overview.notice.cancelled'));
    if (d && d.isVolumeRoot) reason('shield', t('overview.coverage.system.' + (this.host.platform === 'win32' ? 'win32' : this.host.platform === 'darwin' ? 'darwin' : 'linux')));
    if (d && !d.isVolumeRoot) reason('folder', t('overview.coverage.otherFolders', { folder: baseName(r.root) || r.root }));

    const reach = r.maxDepth === null
      ? tn('overview.coverage.reachAll', r.dirsRead, { duration: formatDuration(r.durationMs) })
      : tn('overview.coverage.reachDepth', r.dirsRead, { levels: tn('overview.notice.levels', r.maxDepth), duration: formatDuration(r.durationMs) });

    if (!d) {
      return h('section.coverage.card',
        h('div.coverage-head', h('h2', t('overview.coverage.title')), h('span.muted.small', reach)),
        reasons.length ? h('ul.coverage-reasons', reasons) : null);
    }
    const pctOfUsed = d.used ? analyzed / d.used : 0;
    const over = analyzed > d.used;
    const notRead = Math.max(0, d.used - analyzed);
    const seg = (cls, value, label) => h(`div.cov-seg.${cls}`, { style: { flexGrow: String(Math.max(value, 0)) }, title: `${label}: ${formatBytes(value)}` });
    const key = (cls, label, value) => h('span.cov-key', h(`span.cov-swatch.${cls}`), h('span', label), h('strong', formatBytes(value)));
    return h('section.coverage.card',
      h('div.coverage-head',
        h('h2', t('overview.coverage.title')),
        h('span.muted.small', reach)),
      h('p.coverage-lead',
        t(d.isVolumeRoot ? 'overview.coverage.leadDisk' : 'overview.coverage.leadFolder', {
          analyzed: formatBytes(analyzed), used: formatBytes(d.used), total: formatBytes(d.total), free: formatBytes(d.free),
          percent: formatPercent(Math.min(analyzed, d.used), d.used || 1), volume: d.volume || '',
        })),
      h('div.cov-bar', { role: 'img', 'aria-label': t('overview.coverage.barLabel', { analyzed: formatBytes(analyzed), used: formatBytes(d.used), total: formatBytes(d.total) }) },
        seg('is-analyzed', Math.min(analyzed, d.used), t('overview.coverage.key.analyzed')),
        notRead ? seg('is-unread', notRead, t('overview.coverage.key.unread')) : null,
        seg('is-free', d.free, t('overview.coverage.key.free'))),
      h('div.cov-keys',
        key('is-analyzed', t('overview.coverage.key.analyzed'), analyzed),
        notRead ? key('is-unread', t(d.isVolumeRoot ? 'overview.coverage.key.unread' : 'overview.coverage.key.elsewhere'), notRead) : null,
        key('is-free', t('overview.coverage.key.free'), d.free)),
      over ? h('p.muted.small.coverage-over', t('overview.coverage.over')) : null,
      reasons.length && (notRead || errors || skipped || r.ignoredCount || r.cancelled)
        ? h('div.coverage-why', h('h3', t('overview.coverage.why')), h('ul.coverage-reasons', reasons))
        : null,
      d.isVolumeRoot && pctOfUsed >= 0.98 && !errors && !skipped && !r.ignoredCount ? h('p.muted.small', t('overview.coverage.complete')) : null);
  }

  #notices() {
    const r = this.analysis.result;
    const out = h('div.notice-slot');
    const skipped = r.skippedCount ?? r.skippedDirs.length;
    const busy = this.scan.busy;
    if (skipped && r.maxDepth !== null) {
      out.append(h('div.notice',
        h('span.notice-icon', { html: icon('layers', 16) }),
        h('span.notice-text', tn('overview.notice.depthLimit', skipped, { levels: tn('overview.notice.levels', r.maxDepth) })),
        h('button.btn.btn-secondary.btn-sm', { disabled: busy, onclick: () => { this.scan.setUnlimited(false); this.scan.setDepth((r.maxDepth ?? 0) + 2); this.scan.scan(); } }, t('overview.notice.readMore')),
        h('button.btn.btn-ghost.btn-sm', { disabled: busy, onclick: () => { this.scan.setUnlimited(true); this.scan.scan(); } }, t('overview.notice.readAll'))));
    }
    if (r.ignoredCount) {
      out.append(h('div.notice.notice-ignored',
        h('span.notice-icon', { html: icon('stop', 16) }),
        h('span.notice-text', tn('overview.notice.ignored', r.ignoredCount)),
        h('button.btn.btn-ghost.btn-sm', { disabled: busy, onclick: () => { this.scan.setIgnoreEnabled(false); this.scan.scan(); } }, t('overview.notice.analyzeAll'))));
    }
    if (r.cancelled) {
      out.append(h('div.notice', h('span.notice-icon', { html: icon('warning', 16) }), h('span.notice-text', t('overview.notice.cancelled'))));
    }
    return out;
  }

  // ---------- charts ----------
  #types(s) {
    const present = CATEGORIES.map((c) => s.byCategory.find((x) => x.id === c.id)).filter(Boolean);
    const items = present.map((c) => ({
      id: c.id,
      label: CATEGORY_BY_ID[c.id].label,
      value: c.size,
      color: categoryColor(c.id),
      valueLabel: formatBytes(c.size),
      tooltip: { title: CATEGORY_BY_ID[c.id].label, color: categoryColor(c.id), lines: [`${formatBytes(c.size)} · ${formatPercent(c.size, s.bytes)}`, tn('common.files', c.count)] },
    }));
    const open = (it) => this.#openFilesWith({ category: it.id });
    const legend = h('div.type-legend',
      h('div.legend-head', h('span', t('overview.types.column.type')), h('span', t('overview.types.column.size')), h('span', t('overview.types.column.percent')), h('span', t('overview.types.column.files'))),
      [...present].sort((a, b) => b.size - a.size).map((c) =>
        h('button.legend-row', { onclick: () => open({ id: c.id }), title: t('overview.types.viewFiles') },
          h('span.legend-name', h('span.swatch', { style: { background: categoryColor(c.id) } }), CATEGORY_BY_ID[c.id].label),
          h('span.num', formatBytes(c.size)),
          h('span.num.muted', formatPercent(c.size, s.bytes)),
          h('span.num.muted', formatNumber(c.count)))));
    return h('div.types-layout',
      h('div.rose-wrap', roseChart(items, { onClick: open, ariaLabel: t('overview.card.types.title') }), h('div.rose-center', h('strong', formatBytes(s.bytes)), h('span', t('overview.types.total')))),
      legend);
  }

  #folders(s) {
    const subs = s.bySubfolder;
    const top = subs.filter((f) => f.name).slice(0, TOP_FOLDERS);
    const loose = subs.find((f) => !f.name);
    const rest = subs.filter((f) => f.name).slice(TOP_FOLDERS);
    const restSize = rest.reduce((a, f) => a + f.size, 0);
    const items = top.map((f) => ({
      label: f.name, value: f.size, rel: f.rel, sub: `${formatBytes(f.size)} · ${formatPercent(f.size, s.bytes)}`,
      tooltip: { title: f.name, lines: [`${formatBytes(f.size)} · ${formatPercent(f.size, s.bytes)}`, tn('common.files', f.count), t('overview.folders.clickToOpen')] },
    }));
    if (restSize) items.push({ label: tn('overview.folders.otherFolders', rest.length), value: restSize, muted: true, sub: formatBytes(restSize), tooltip: { title: tn('overview.folders.smallerFolders', rest.length), lines: [formatBytes(restSize)] } });
    if (loose) items.push({ label: t('overview.folders.looseFiles'), value: loose.size, muted: true, sub: formatBytes(loose.size), tooltip: { title: t('overview.folders.looseFilesTitle'), lines: [formatBytes(loose.size), tn('common.files', loose.count)] } });
    if (!items.length) return h('p.muted', t('overview.folders.empty'));
    return treemap(items, { height: 300, onClick: (it) => this.analysis.setFilter({ folder: it.rel }) });
  }

  #dots(s) {
    const groups = CATEGORIES.map((c) => s.byCategory.find((x) => x.id === c.id)).filter(Boolean).map((c) => ({
      value: c.size, color: dotColor(c.id),
      tooltip: { title: CATEGORY_BY_ID[c.id].label, color: dotColor(c.id), lines: [`${formatPercent(c.size, s.bytes)} · ${formatBytes(c.size)}`] },
    }));
    return dotMatrix(groups, { columns: 20, footerLeft: formatBytes(s.bytes), footerRight: t('overview.dots.scale', { size: formatBytes(s.bytes / 100) }) });
  }

  #exts(s) {
    const items = s.byExtension.slice(0, TOP_EXTS).map((e) => {
      const label = e.ext.startsWith('(') ? e.ext : '.' + e.ext;
      return {
        label, ext: e.ext, value: e.size, valueLabel: formatBytes(e.size), color: categoryColor(e.cat),
        tooltip: { title: label, color: categoryColor(e.cat), lines: [`${formatBytes(e.size)} · ${formatPercent(e.size, s.bytes)}`, `${tn('common.files', e.count)} · ${CATEGORY_BY_ID[e.cat].label}`] },
      };
    });
    return barList(items, { onClick: (it) => this.#openFilesWith({ ext: it.ext }) });
  }

  #age(s) {
    return hatchColumns(s.byAge.map((b) => ({
      label: b.label, value: b.size, valueLabel: b.size ? formatBytes(b.size) : '',
      tooltip: { title: t('overview.age.tooltip', { age: b.label }), lines: [`${formatBytes(b.size)} · ${formatPercent(b.size, s.bytes)}`, tn('common.files', b.count)] },
    })), { ariaLabel: t('overview.age.ariaLabel') });
  }

  #biggest() {
    const files = [...this.analysis.scopeFiles()].sort((a, b) => b.size - a.size).slice(0, TOP_FILES);
    const max = files[0]?.size || 1;
    this.analysis.verify('overview', files.map((f) => f.path));
    return h('div.file-list', files.map((f) => {
      const missing = this.analysis.isMissing(f.path);
      return h(`div.file-item${missing ? '.is-missing' : ''}`,
        h('span.swatch', { style: { background: categoryColor(f.cat) } }),
        h('div.file-item-main',
          h('div.file-item-name', { title: f.path }, f.name),
          h('div.file-item-meta', missing ? missingBadge() : null, `${f.folder || t('common.rootFolder')} · ${formatDate(f.mtime)}`),
          h('div.size-bar', h('span', { style: { width: `${(f.size / max) * 100}%` } }))),
        h('span.file-item-size', formatBytes(f.size)),
        missing
          ? removeFromListButton(this.actions, f.path)
          : [h('button.icon-button', { title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 16), onclick: () => this.actions.reveal(f.path) }),
            h('button.icon-button.danger', { title: t('common.moveToTrash'), html: icon('trash', 16), onclick: () => this.actions.trash([f]) })]);
    }));
  }

  #openFilesWith(patch) {
    this.analysis.setFilter({ category: null, ext: null, group: null, query: '', minSize: 0, ...patch });
    this.layout.openView('files');
  }
}

function card(title, subtitle, body, extra = '') {
  return h(`article.card${extra ? '.' + extra : ''}`,
    h('header.card-header', h('h2', title), subtitle ? h('p', subtitle) : null),
    body);
}

export function bigNumber(bytes, cls) {
  const p = bytesParts(bytes);
  return h(`div.big-number.${cls}`, h('span.bn-int', p.int), h('span.bn-dec', p.dec), h('span.bn-unit', p.unit));
}

function fact(label, value, title) {
  return h('div.fact', h('span.fact-label', label), h('span.fact-value', { title: title || value }, value));
}

/** Strip of vertical lines; the part proportional to the fraction is lit. */
export function hatchStrip(fraction, n = 28) {
  const lit = Math.round(Math.min(1, Math.max(0, fraction)) * n);
  return h('div.hatch-strip', Array.from({ length: n }, (_, i) => h(`span${i < lit ? '.on' : ''}`)));
}
