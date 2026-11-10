/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Editor area: view tabs, breadcrumbs of the folder in focus and the active view.
// With no analysis loaded, it shows the welcome page.
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes, formatNumber, formatDateTime, splitRel, baseName } from '../../../base/common/format.js';
import { VIEWS } from '../../services/layout/browser/layoutService.js';
import { t, tn } from '../../../base/common/nls.js';

export class EditorPart {
  constructor(services, views) {
    Object.assign(this, services);
    this.views = views;
    this.tabs = h('div.tabs', { role: 'tablist' });
    this.breadcrumbs = h('nav.breadcrumbs', { 'aria-label': t('editor.breadcrumbsLabel') });
    this.content = h('div.editor-content');
    this.banner = h('div.restore-banner', { role: 'status', hidden: true });
    this.element = h('main.part.editor', h('div.editor-header', this.tabs), this.breadcrumbs, this.banner, this.content);

    for (const v of Object.values(views)) { v.element.hidden = true; this.content.append(v.element); }
    this.welcome = h('div.welcome');
    this.content.append(this.welcome);

    this.layout.onDidChangeView(() => this.render());
    this.analysis.onDidChangeData(() => this.render());
    this.analysis.onDidChangeFilter(() => this.#renderBreadcrumbs());
    this.scan.onDidChangeState(() => this.render());
    this.scan.onDidProgress(() => { if (!this.analysis.hasData) this.#renderWelcome(); else this.#renderBanner(); });
    this.scan.onDidChangeSettings(() => { if (!this.analysis.hasData && !this.scan.busy) this.#renderWelcome(); });
    this.render();
  }

  render() {
    this.#renderTabs();
    this.#renderBreadcrumbs();
    this.#renderBanner();
    const hasData = this.analysis.hasData;
    const active = this.views[this.layout.activeView];
    const showWelcome = !hasData && !(active?.worksWithoutData && this.scan.state !== 'scanning');
    this.welcome.hidden = !showWelcome;
    if (showWelcome) this.#renderWelcome();
    for (const [id, view] of Object.entries(this.views)) {
      const visible = id === this.layout.activeView && (hasData || (view.worksWithoutData && !showWelcome));
      if (visible) view.show(); else view.hide();
    }
  }

  #renderTabs() {
    setChildren(this.tabs, VIEWS.map((v) =>
      h('button.tab', {
        role: 'tab', 'aria-selected': String(v.id === this.layout.activeView),
        class: `tab${v.id === this.layout.activeView ? ' active' : ''}`,
        onclick: () => this.layout.openView(v.id), title: `${v.label} (${v.shortcut})`,
      }, h('span.tab-icon', { html: icon(v.icon, 14) }), h('span.tab-label', v.label))));
  }

  #renderBreadcrumbs() {
    const { analysis } = this;
    clear(this.breadcrumbs);
    if (!analysis.hasData) { this.breadcrumbs.hidden = true; return; }
    this.breadcrumbs.hidden = false;
    const segs = splitRel(analysis.filter.folder);
    const sep = analysis.root.includes('\\') ? '\\' : '/';
    const crumb = (label, rel, current) => h('button.crumb', {
      class: `crumb${current ? ' current' : ''}`, onclick: () => analysis.setFilter({ folder: rel }),
    }, label);

    this.breadcrumbs.append(h('span.crumb-icon', { html: icon('folder', 14) }), crumb(baseName(analysis.root), '', segs.length === 0));
    segs.forEach((s, i) => {
      this.breadcrumbs.append(h('span.crumb-sep', { html: icon('chevronRight', 12) }), crumb(s, segs.slice(0, i + 1).join(sep), i === segs.length - 1));
    });
    const s = analysis.summary();
    this.breadcrumbs.append(
      h('span.crumb-meta', `${formatBytes(s.bytes)} · ${tn('common.files', s.count)}`),
      h('button.icon-button.crumb-action', {
        title: t('editor.openFolderIn', { explorer: this.actions.explorerName }), html: icon('reveal', 14),
        onclick: () => this.actions.revealFolder(analysis.filter.folder),
      }));
  }

  /** Reopened analysis (from the catalog): its date, and the refresh running in the background. */
  #renderBanner() {
    const { analysis, scan } = this;
    const restored = analysis.hasData ? analysis.result.restored : null;
    this.banner.hidden = !restored;
    if (!restored) { clear(this.banner); return; }
    const refreshing = scan.state === 'refreshing';
    const p = scan.progress;
    setChildren(this.banner,
      h(`span.restore-icon${refreshing ? '.spin' : ''}`, { html: icon(refreshing ? 'refresh' : 'history', 14) }),
      h('span.restore-text',
        h('strong', t('restore.banner.saved', { date: formatDateTime(restored.at) })),
        ' ',
        refreshing
          ? (p?.files ? tn('restore.banner.refreshingCount', p.files) : t('restore.banner.refreshing'))
          : t('restore.banner.idle')),
      refreshing
        ? h('button.btn.btn-secondary.btn-sm', { onclick: () => scan.cancel() }, t('restore.banner.stop'))
        : h('button.btn.btn-primary.btn-sm', { disabled: scan.busy, onclick: () => scan.scan() }, h('span', { html: icon('refresh', 14) }), t('restore.banner.analyze')));
  }

  #renderWelcome() {
    const { scan } = this;
    const busy = scan.busy;
    const p = scan.progress;
    setChildren(this.welcome, 
      h('div.welcome-inner',
        h('img.welcome-mark', { src: 'media/logo.svg', alt: t('welcome.logoAlt', { app: t('app.name') }) }),
        h('h1', 'Lion', h('span', 'Organizer')),
        h('p.welcome-tagline', t('app.tagline')),
        h('p.welcome-lead', t('welcome.lead')),
        busy && p
          ? h('div.welcome-progress',
              h('div.progress-track', h('div.progress-indeterminate')),
              h('div.welcome-progress-stats', emphasize(tn('welcome.progress', p.files, { size: formatBytes(p.bytes) }), [formatNumber(p.files), formatBytes(p.bytes)])),
              h('div.progress-path', p.current),
              h('button.btn.btn-secondary', { onclick: () => scan.cancel() }, t('common.cancel')))
          : h('div.welcome-actions',
              h('button.btn.btn-primary.btn-lg', { onclick: () => this.actions.openFolderAndScan() }, h('span', { html: icon('folderOpen', 16) }), t('welcome.openFolder')),
              scan.folder ? h('button.btn.btn-secondary.btn-lg', { onclick: () => scan.scan(), title: scan.folder }, t('welcome.scanFolder', { name: baseName(scan.folder) })) : null),
        h('dl.shortcuts',
          ...[['Ctrl+O', t('welcome.shortcuts.openFolder')], ['F5', t('welcome.shortcuts.rescan')], ['Ctrl+1 … 7', VIEWS.map((v) => v.label).join(' · ')], ['Ctrl+B', t('welcome.shortcuts.toggleSidebar')]]
            .flatMap(([k, d]) => [h('dt', h('kbd', k)), h('dd', d)])),
        h('p.welcome-note',
          scan.settings.unlimited
            ? t('welcome.note.unlimited', { field: t('sidebar.depthLabel') })
            : tn('welcome.note.depth', scan.settings.depth, { field: t('sidebar.depthLabel') }))));
  }
}

/** Wraps the first occurrence of each value inside a translated sentence in <strong> (any word order). */
function emphasize(text, values) {
  const hits = values
    .map((v) => ({ v, i: v ? text.indexOf(v) : -1 }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => x.i - y.i);
  const out = [];
  let pos = 0;
  for (const { v, i } of hits) {
    if (i < pos) continue;
    out.push(text.slice(pos, i), h('strong', v));
    pos = i + v.length;
  }
  out.push(text.slice(pos));
  return out.filter((x) => x !== '');
}
