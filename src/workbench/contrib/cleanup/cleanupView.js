/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Cleanup suggestions grouped by reason (CAD backups, temporary files, duplicates…).
import { ViewPane } from '../../browser/viewPane.js';
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { showAiReportDialog } from '../report/aiReportDialog.js';
import { missingBadge, removeFromListButton } from '../../browser/missingFile.js';
import { formatBytes, formatDate } from '../../../base/common/format.js';
import { categoryColor, freeDotColor } from '../../browser/chartTheme.js';
import { dotMatrix } from '../../../base/browser/ui/charts/dotMatrix.js';
import { bigNumber } from '../overview/overviewView.js';
import { formatPercent } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';

const PREVIEW = 5;

export class CleanupView extends ViewPane {
  constructor(services) {
    super(services, 'cleanup');
    this.analysis.onDidChangeData(() => this.invalidate());
    this.layout.onDidChangeTheme(() => this.invalidate());
    this.analysis.onDidChangeFilter(() => { if (this.lastFolder !== this.analysis.filter.folder) this.invalidate(); });
  }

  render() {
    const { analysis } = this;
    if (!analysis.hasData) return;
    this.lastFolder = analysis.filter.folder;
    const groups = analysis.cleanupGroups();
    const unique = new Map();
    for (const g of groups) for (const f of g.files) unique.set(f.path, f.size);
    const total = [...unique.values()].reduce((a, b) => a + b, 0);
    const maxGroup = groups[0]?.size || 1;
    const scopeBytes = analysis.summary().bytes;

    setChildren(this.element, 
      h('header.cleanup-hero',
        h('div.cleanup-hero-text',
          h('div.eyebrow', t('cleanup.hero.eyebrow')),
          bigNumber(total, 'hero-number'),
          h('p.muted', t('cleanup.hero.summary', { files: tn('common.files', unique.size), groups: tn('cleanup.hero.groups', groups.length), percent: formatPercent(total, scopeBytes) })),
          h('p.cleanup-explain',
            h('span', { html: icon('info', 14) }),
            t('cleanup.hero.explain')),
          h('button.btn.btn-secondary.btn-sm.ai-report-button', { title: t('report.buttonTitle'), onclick: () => showAiReportDialog(this) },
            h('span', { html: icon('sparkle', 14) }), t('report.button'))),
        dotMatrix([
          { value: total, color: freeDotColor(), tooltip: { title: t('cleanup.chart.freeable'), color: freeDotColor(), lines: [formatBytes(total)] } },
          { value: Math.max(0, scopeBytes - total), dim: true, tooltip: { title: t('cleanup.chart.remaining'), lines: [formatBytes(Math.max(0, scopeBytes - total))] } },
        ], { columns: 20, footerLeft: t('cleanup.chart.footerShare', { percent: formatPercent(total, scopeBytes) }), footerRight: t('cleanup.chart.footerTotal', { size: formatBytes(scopeBytes) }) })),
      groups.length
        ? h('div.cleanup-grid', groups.map((g) => this.#group(g, maxGroup)))
        : h('div.empty-state', h('span', { html: icon('sparkle', 28) }), h('h3', t('cleanup.empty.title')), h('p.muted', t('cleanup.empty.body'))));
  }

  /** The first files of a group, checked in the background (they may have been deleted meanwhile). */
  #preview(g) {
    const files = g.files.slice(0, PREVIEW);
    this.analysis.verify('cleanup:' + g.id, files.map((f) => f.path));
    return files;
  }

  #group(g, maxGroup) {
    return h('article.card.cleanup-card',
      h('header.cleanup-card-head',
        h('div',
          h('h2', g.label, h('span.badge', g.badge)),
          h('p.muted', g.desc)),
        h('div.cleanup-card-size', h('strong', formatBytes(g.size)), h('span.muted', tn('common.files', g.files.length)))),
      h('div.size-bar.wide', h('span', { style: { width: `${Math.max(1, (g.size / maxGroup) * 100)}%` } })),
      h('ul.cleanup-preview', this.#preview(g).map((f) => {
        const missing = this.analysis.isMissing(f.path);
        return h(`li${missing ? '.is-missing' : ''}`,
          h('span.swatch', { style: { background: categoryColor(f.cat) } }),
          h('span.cp-name', { title: missing ? t('files.missing.title') : f.path }, missing ? missingBadge() : null, f.name),
          h('span.cp-folder.muted', { title: f.folder }, f.folder || t('common.rootFolder')),
          h('span.cp-date.muted', formatDate(f.mtime)),
          h('span.cp-size', formatBytes(f.size)),
          missing
            ? removeFromListButton(this.actions, f.path, { compact: true })
            : h('button.icon-button', { title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 15), onclick: () => this.actions.reveal(f.path) }));
      })),
      h('footer.cleanup-actions',
        g.files.length > PREVIEW ? h('span.muted', tn('cleanup.group.more', g.files.length - PREVIEW)) : h('span'),
        h('div.btn-row',
          h('button.btn.btn-secondary.btn-sm', {
            onclick: () => { this.analysis.setFilter({ group: g.id, category: null, ext: null, query: '', minSize: 0 }); this.layout.openView('files'); },
          }, t('cleanup.group.review')),
          g.heuristic
            // without comparing contents, we don't offer bulk deletion
            ? h('button.btn.btn-primary.btn-sm', { onclick: () => this.layout.openView('duplicates') },
                h('span', { html: icon('hash', 14) }), t('cleanup.group.confirmByContent'))
            : h('button.btn.btn-danger-outline.btn-sm', { onclick: () => this.actions.trash(g.files) },
                h('span', { html: icon('trash', 14) }), t('cleanup.group.deleteAll')))));
  }
}
