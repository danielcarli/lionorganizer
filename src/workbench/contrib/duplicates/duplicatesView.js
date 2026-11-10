/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Duplicates by content: on-demand check (SHA-256), groups of identical copies,
// choosing which copy to keep and deleting the extras (always with a confirmation code).
import { ViewPane } from '../../browser/viewPane.js';
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { missingBadge, removeFromListButton } from '../../browser/missingFile.js';
import { formatBytes, formatNumber, formatDate, formatDuration, formatPercent } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { categoryColor } from '../../browser/chartTheme.js';
import { MIN_SIZE_OPTIONS, KEEP_STRATEGIES } from '../../services/duplicates/browser/duplicatesService.js';
import { bigNumber, hatchStrip } from '../overview/overviewView.js';

const PAGE = 40;

export class DuplicatesView extends ViewPane {
  shown = PAGE;

  constructor(services) {
    super(services, 'duplicates');
    this.duplicates.onDidChange(() => this.invalidate());
    this.analysis.onDidChangeData(() => this.invalidate());
  }

  render() {
    if (!this.analysis.hasData) return;
    const d = this.duplicates;
    setChildren(this.element,
      d.status === 'running' ? this.#running() : d.status === 'done' ? this.#done() : this.#idle());
  }

  // ---------------------------------------------------------------- before checking
  #idle() {
    const d = this.duplicates;
    const est = d.estimate();
    return h('div.dup-idle',
      h('section.card.dup-intro',
        h('div.dup-intro-text',
          h('div.eyebrow', h('span', { html: icon('hash', 14) }), t('duplicates.idle.eyebrow')),
          h('h1.view-title', t('duplicates.idle.title')),
          h('p.muted', t('duplicates.idle.description')),
          h('div.dup-controls',
            h('label.field-inline', t('duplicates.idle.minSizeLabel'),
              h('select.select', { onchange: (e) => d.setMinSize(e.target.value) },
                MIN_SIZE_OPTIONS.map(([v, l]) => h('option', { value: String(v), selected: v === d.minSize }, l)))),
            h('button.btn.btn-primary', { onclick: () => d.run(), disabled: !est.files }, h('span', { html: icon('hash', 14) }), t('duplicates.idle.run'))),
          d.error ? h('p.field-error', h('span', { html: icon('warning', 14) }), d.error) : null,
          h('p.dup-safe', h('span', { html: icon('shield', 14) }), t('duplicates.idle.safe'))),
        h('div.dup-estimate',
          h('div.fact-label', t('duplicates.estimate.label')),
          h('div.dup-estimate-num', formatNumber(est.files)),
          h('div.muted', est.files ? t('duplicates.estimate.bytes', { size: formatBytes(est.bytes) }) : t('duplicates.estimate.none')))));
  }

  // ---------------------------------------------------------------- checking
  #running() {
    const p = this.duplicates.progress || { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, stage: 'partial' };
    const pct = p.bytesTotal ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : 0;
    return h('section.card.dup-running',
      h('div.eyebrow', h('span.spin', { html: icon('refresh', 14) }), p.stage === 'full' ? t('duplicates.running.full') : t('duplicates.running.partial')),
      h('div.dup-progress-num', `${Math.round(pct)}%`),
      h('div.progress-bar', h('span', { style: { width: `${pct}%` } })),
      h('div.dup-progress-stats',
        h('span', tn('duplicates.running.files', p.filesTotal, { done: p.filesDone })),
        h('span', t('duplicates.running.bytes', { done: formatBytes(p.bytesDone), total: formatBytes(p.bytesTotal) }))),
      p.current ? h('div.progress-path', { title: p.current }, p.current) : null,
      h('button.btn.btn-secondary', { onclick: () => this.duplicates.cancel() }, h('span', { html: icon('stop', 14) }), t('common.cancel')));
  }

  // ---------------------------------------------------------------- result
  #done() {
    const d = this.duplicates;
    const groups = d.groups;
    const extras = d.extras();
    const bytes = d.reclaimable();
    const st = d.stats || {};
    const total = this.analysis.tree?.size || 1;

    const hero = h('section.dup-hero',
      h('div.hero-main',
        h('div.eyebrow', t('duplicates.done.eyebrow')),
        bigNumber(bytes, 'hero-number'),
        h('div.hero-facts',
          fact(t('duplicates.done.groups'), formatNumber(groups.length)),
          fact(t('duplicates.done.extraCopies'), formatNumber(extras.length)),
          fact(t('duplicates.done.shareOfAnalyzed'), formatPercent(bytes, total))),
        h('p.dup-stats.muted',
          st.cancelled ? t('duplicates.done.statsCancelled', { stats: statsLine(st) }) : statsLine(st))),
      h('div.dup-actions-card',
        h('div.fact-label', t('duplicates.done.keepLabel')),
        h('div.segmented', { role: 'radiogroup' }, KEEP_STRATEGIES.map((s) =>
          h('button.seg', { class: `seg${s.id === d.strategy ? ' active' : ''}`, role: 'radio', 'aria-checked': String(s.id === d.strategy), onclick: () => d.setStrategy(s.id) }, s.label))),
        h('p.muted.small', t('duplicates.done.manualHint')),
        h('button.btn.btn-danger', { disabled: !extras.length, onclick: () => this.actions.trash(extras) },
          h('span', { html: icon('trash', 14) }), tn('duplicates.done.deleteExtras', extras.length)),
        h('button.btn.btn-ghost.btn-sm', { onclick: () => { d.reset(); d.run(); } }, h('span', { html: icon('refresh', 13) }), t('duplicates.done.rerun')),
        hatchStrip(bytes / total)));

    if (!groups.length) {
      return h('div', hero, h('div.empty-state', h('span', { html: icon('shield', 28) }), h('h3', t('duplicates.empty.title')), h('p.muted', t('duplicates.empty.body'))));
    }

    const shownGroups = groups.slice(0, this.shown);
    this.analysis.verify('duplicates', shownGroups.flatMap((g) => g.files.map((f) => f.path)));
    const list = h('div.dup-groups', shownGroups.map((g) => this.#group(g)));
    const more = groups.length > this.shown
      ? h('button.btn.btn-secondary.dup-more', { onclick: () => { this.shown += PAGE; this.render(); } }, tn('duplicates.showMore', Math.min(PAGE, groups.length - this.shown)))
      : null;
    return h('div', hero, h('h2.section-title', t('duplicates.groups.title'), h('span.muted', ` · ${t('duplicates.groups.sortHint')}`)), list, more);
  }

  #group(g) {
    const d = this.duplicates;
    const keepFile = g.files.find((f) => f.path === g.keep) || g.files[0];
    const name = `dup-${g.hash.slice(0, 12)}`;
    return h('article.card.dup-group',
      h('header.dup-group-head',
        h('span.swatch', { style: { background: categoryColor(keepFile.cat) } }),
        h('div.dup-group-title',
          h('h3', { title: keepFile.name }, keepFile.name),
          h('div.muted.small', tn('duplicates.group.summary', g.files.length, { size: formatBytes(g.size), freed: formatBytes(g.size * (g.files.length - 1)) }))),
        h('code.hash', { title: `SHA-256 ${g.hash}` }, `${g.hash.slice(0, 8)}…${g.hash.slice(-6)}`)),
      h('ul.dup-copies', g.files.map((f) => {
        const keep = f.path === g.keep;
        const missing = this.analysis.isMissing(f.path);
        return h(`li${keep ? '.keep' : ''}${missing ? '.is-missing' : ''}`,
          h('label.dup-keep', { title: t('duplicates.copy.keepTitle') },
            h('input', { type: 'radio', name, checked: keep, onchange: () => d.setKeep(g.hash, f.path) }),
            h('span.dup-keep-tag', keep ? t('duplicates.copy.keep') : t('duplicates.copy.delete'))),
          h('span.dup-path', { title: f.path }, h('span.dup-file', missing ? missingBadge() : null, f.name), h('span.muted', f.folder || t('common.rootFolder'))),
          h('span.dup-date.muted', formatDate(f.mtime)),
          missing
            ? [h('span'), removeFromListButton(this.actions, f.path, { compact: true })]
            : [h('button.icon-button', { title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 15), onclick: () => this.actions.reveal(f.path) }),
              h('button.icon-button.danger', { title: t('duplicates.copy.deleteTitle'), disabled: keep, html: icon('trash', 15), onclick: () => this.actions.trash([f]) })]);
      })),
      g.elsewhere.length
        ? h('div.dup-elsewhere',
            h('span', { html: icon('database', 13) }),
            h('span', `${t('duplicates.group.elsewhere')} `),
            g.elsewhere.slice(0, 3).map((e) => h('button.link', { title: e.path, onclick: () => this.actions.reveal(e.path) }, shortPath(e.path))),
            g.elsewhere.length > 3 ? h('span.muted', ` +${g.elsewhere.length - 3}`) : null)
        : null);
  }
}

function statsLine(st) {
  return tn('duplicates.done.stats', st.cached || 0, { read: formatBytes(st.bytesRead || 0), duration: formatDuration(st.durationMs || 0) });
}

function fact(label, value) {
  return h('div.fact', h('span.fact-label', label), h('span.fact-value', value));
}

function shortPath(p) {
  const parts = p.split(/[\\/]/);
  return parts.length > 4 ? `${parts[0]}${p.includes('\\') ? '\\' : '/'}…${p.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(p.includes('\\') ? '\\' : '/')}` : p;
}
