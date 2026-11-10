/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "About" dialog: product, version, credits and license.
import { h } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t } from '../../../base/common/nls.js';

export const AUTHOR = 'Daniel Michelon De Carli';

export async function showAboutDialog(host) {
  const info = await host.appInfo().catch(() => ({ version: '' }));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const closeBtn = h('button.btn.btn-primary', { onclick: close }, t('common.close'));
  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.about-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'about-title' },
      h('header.about-head',
        h('img.about-logo', { src: 'media/logo.svg', alt: '' }),
        h('div',
          h('h2#about-title', 'Lion', h('b', 'Organizer')),
          h('div.welcome-tagline', t('app.tagline')),
          info.version ? h('div.muted.small', t('about.version', { version: info.version })) : null)),
      h('p.about-credit', h('span', { html: icon('sparkle', 14) }), t('about.createdBy', { author: AUTHOR })),
      h('p.about-team', t('about.team', { year: '2026' }) /* a string: years are not grouped like numbers */),
      h('p.muted', t('about.license')),
      h('p.muted', t('about.privacy')),
      h('p.muted.small', t('about.fonts')),
      h('footer.cm-actions', closeBtn)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => closeBtn.focus());
}
