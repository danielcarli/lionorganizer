/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Activity bar: switches the editor view and toggles the side bar.
import { h } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { VIEWS } from '../../services/layout/browser/layoutService.js';
import { showAboutDialog } from '../../contrib/about/aboutDialog.js';
import { t } from '../../../base/common/nls.js';

export class ActivitybarPart {
  constructor({ layout, analysis, host }) {
    this.layout = layout;
    this.buttons = VIEWS.map((v) =>
      h('button.activity-item', {
        title: `${v.label} (${v.shortcut})`, 'aria-label': v.label, 'data-view': v.id,
        html: icon(v.icon, 22), onclick: () => layout.openView(v.id),
      }));
    this.badge = h('span.activity-badge');
    this.buttons[2].append(this.badge);
    this.element = h('nav.part.activitybar', { 'aria-label': t('activitybar.ariaLabel') },
      h('div.activity-top', this.buttons),
      h('div.activity-bottom',
        h('button.activity-item', { title: t('activitybar.toggleSidebar', { key: 'Ctrl+B' }), html: icon('sidebar', 20), onclick: () => layout.toggleSidebar() }),
        h('button.activity-item', { title: t('about.title'), 'aria-label': t('about.title'), html: icon('info', 20), onclick: () => showAboutDialog(host) })));
    layout.onDidChangeView(() => this.render());
    analysis.onDidChangeData(() => this.#updateBadge(analysis));
    analysis.onDidChangeFilter(() => this.#updateBadge(analysis));
    this.render();
  }

  #updateBadge(analysis) {
    const n = analysis.hasData ? analysis.cleanupGroups().length : 0;
    this.badge.textContent = n ? String(n) : '';
    this.badge.hidden = !n;
  }

  render() {
    for (const b of this.buttons) b.classList.toggle('active', b.dataset.view === this.layout.activeView);
  }
}
