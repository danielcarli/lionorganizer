/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Unobtrusive notifications in the bottom-right corner (like VS Code's "toasts"),
// with an optional action button (e.g. "Undo").
import { h } from '../../../../base/browser/dom.js';
import { icon } from '../../../../base/browser/icons.js';
import { t } from '../../../../base/common/nls.js';

export class NotificationService {
  element = h('div.notifications', { role: 'status', 'aria-live': 'polite' });

  info(message, ms = 4500, action = null) { this.#show('info', message, ms, action); }
  warn(message, ms = 8000, action = null) { this.#show('warning', message, ms, action); }

  #show(kind, message, ms, action) {
    const toast = h(`div.toast.toast-${kind}`,
      h('span.toast-icon', { html: icon(kind === 'info' ? 'info' : 'warning') }),
      h('span.toast-text', message),
      action ? h('button.btn.btn-secondary.btn-sm', { onclick: () => { toast.remove(); action.run(); } }, action.label) : null,
      h('button.icon-button', { title: t('common.close'), html: icon('close', 14), onclick: () => toast.remove() }));
    this.element.append(toast);
    let timer = setTimeout(() => toast.remove(), ms);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { timer = setTimeout(() => toast.remove(), 2500); });
  }
}
