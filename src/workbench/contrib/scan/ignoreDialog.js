/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Ignore folders" list editor: one pattern per line. The option itself stays as the user set it
// (off by default) — this dialog only edits the list.
import { h } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t } from '../../../base/common/nls.js';
import { DEFAULT_IGNORE, cleanIgnoreList } from '../../services/scan/browser/scanService.js';

/** @param {{ scan: import('../../services/scan/browser/scanService.js').ScanService }} services */
export function showIgnoreDialog({ scan }) {
  if (document.querySelector('.ignore-dialog')) return;
  const area = h('textarea.ignore-textarea', {
    rows: 12, spellcheck: false, 'aria-label': t('ignore.dialog.listLabel'),
  });
  area.value = scan.settings.ignoreList.join('\n');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const save = () => { scan.setIgnoreList(area.value.split(/\r?\n/)); close(); };
  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.ignore-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ignore-title' },
      h('header.update-head', h('span.update-icon', { html: icon('stop', 20) }), h('h2#ignore-title', t('ignore.dialog.title'))),
      h('p', t('ignore.dialog.text')),
      h('ul.ai-report-list',
        h('li', t('ignore.dialog.byName')),
        h('li', t('ignore.dialog.byPath')),
        h('li', t('ignore.dialog.optional'))),
      area,
      h('footer.cm-actions',
        h('button.btn.btn-secondary.ignore-defaults', { onclick: () => { area.value = cleanIgnoreList(DEFAULT_IGNORE).join('\n'); area.focus(); } }, t('ignore.dialog.defaults')),
        h('span.cm-spacer'),
        h('button.btn.btn-secondary', { onclick: close }, t('common.cancel')),
        h('button.btn.btn-primary.ignore-save', { onclick: save }, t('common.save')))));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => area.focus());
}
