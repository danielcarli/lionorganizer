/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Shared pieces for files that no longer exist (deleted or moved outside the app, or their folder
// is gone): a "Not found" badge and a "Remove from list" button. Removing from the list only
// changes the interface, never the disk, so it does not need the confirmation code.
import { h } from '../../base/browser/dom.js';
import { icon } from '../../base/browser/icons.js';
import { t } from '../../base/common/nls.js';

export function missingBadge() {
  return h('span.missing-badge', { title: t('files.missing.title') }, h('span', { html: icon('warning', 12) }), t('files.missing.badge'));
}

/**
 * @param {{ removeFromList(paths: string[]): void }} actions
 * @param {string} path
 * @param {{ compact?: boolean }} [opts] compact: icon only (for tight rows)
 */
export function removeFromListButton(actions, path, { compact = false } = {}) {
  const props = { title: t('files.missing.removeTitle'), 'aria-label': t('files.missing.removeFromList'), onclick: () => actions.removeFromList([path]) };
  return compact
    ? h('button.icon-button.missing-remove', { ...props, html: icon('close', 15) })
    : h('button.btn.btn-ghost.btn-sm.missing-remove', props, h('span', { html: icon('close', 13) }), t('files.missing.removeFromList'));
}
