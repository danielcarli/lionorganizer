/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Custom title bar with a "command center" showing the current folder.
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { baseName } from '../../../base/common/format.js';
import { t } from '../../../base/common/nls.js';

export class TitlebarPart {
  constructor({ scan, actions, analysis }) {
    this.scan = scan;
    this.actions = actions;
    this.center = h('button.command-center', { onclick: () => actions.openFolderAndScan(), title: t('titlebar.openFolder', { key: 'Ctrl+O' }) });
    this.element = h('header.part.titlebar',
      h('div.titlebar-left', h('img.app-glyph', { src: 'media/logo.svg', alt: '' }), h('span.app-name', 'Lion', h('b', 'Organizer'))),
      h('div.titlebar-center', this.center),
      h('div.titlebar-right'));
    this.render();
    scan.onDidChangeState(() => this.render());
    scan.onDidChangeSettings(() => this.render());
    analysis.onDidChangeData(() => this.render());
  }

  render() {
    const folder = this.scan.folder;
    setChildren(this.center, 
      h('span.cc-icon', { html: icon(this.scan.state === 'scanning' ? 'refresh' : 'search', 14) }),
      h('span.cc-text', folder ? baseName(folder) : t('titlebar.placeholder')),
      h('kbd', 'Ctrl+O'));
    this.center.classList.toggle('busy', this.scan.state === 'scanning');
    document.title = folder ? `${baseName(folder)} — ${t('app.name')}` : `${t('app.name')} — ${t('app.tagline')}`;
  }
}
