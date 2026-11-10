/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "N inaccessible": which folders and files the system did not let the app read, why, and what to do
// (analyze again as administrator on Windows, Full Disk Access on macOS).
import { h } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t, tn } from '../../../base/common/nls.js';

const MAX_LISTED = 300;
const REASONS = { EACCES: 'denied', EPERM: 'denied', EBUSY: 'busy', ENOENT: 'gone', ENOTDIR: 'gone', ELOOP: 'other', ENAMETOOLONG: 'tooLong' };

/** @param {{ analysis: any, host: any, notifications: any, scan: any }} services */
export function showAccessDialog({ analysis, host, notifications, scan }) {
  const r = analysis.result;
  if (!r || !r.errors?.length || document.querySelector('.access-dialog')) return;
  const total = r.errorCount ?? r.errors.length;
  const root = r.root.replace(/[\\/]+$/, '');
  const rel = (p) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p) || '.';

  const groups = new Map();
  for (const e of r.errors) {
    const reason = REASONS[e.code] || 'other';
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(e);
  }
  const order = ['denied', 'busy', 'gone', 'tooLong', 'other'];
  let listed = 0;
  const sections = order.filter((k) => groups.has(k)).map((k) => {
    const items = groups.get(k);
    const shown = items.slice(0, Math.max(0, MAX_LISTED - listed));
    listed += shown.length;
    return h('section.access-group',
      h('h3', tn('access.reason.' + k + '.title', items.length)),
      h('p.muted.small', t('access.reason.' + k + '.desc')),
      shown.length ? h('ul.access-list', shown.map((e) => h('li', { title: e.path }, h('code', rel(e.path)), h('span.access-code', e.code)))) : null,
      items.length > shown.length ? h('p.muted.small', tn('access.more', items.length - shown.length)) : null);
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const copy = async () => {
    const text = r.errors.map((e) => `${e.code}\t${e.path}`).join('\n');
    const ok = await host.copyText(text).catch(() => false);
    if (ok) notifications.info(t('access.copied')); else notifications.warn(t('report.copyFailed'));
  };

  const platform = host.platform;
  const tip = platform === 'win32' ? t('access.tip.win32') : platform === 'darwin' ? t('access.tip.darwin') : t('access.tip.linux');
  const denied = groups.has('denied');
  let fixButton = null;
  if (denied && platform === 'win32') {
    fixButton = h('button.btn.btn-primary.access-admin', {
      onclick: async () => {
        fixButton.disabled = true;
        const res = await host.relaunchAsAdmin(r.root).catch(() => ({ ok: false }));
        if (res?.ok) { notifications.info(t('access.admin.opening')); close(); return; }
        fixButton.disabled = false;
        notifications.warn(t(res?.declined ? 'access.admin.declined' : 'access.admin.failed'));
      },
    }, h('span', { html: icon('shield', 14) }), t('access.admin.button'));
  } else if (denied && platform === 'darwin') {
    fixButton = h('button.btn.btn-primary.access-privacy', {
      onclick: async () => { if (!(await host.openPrivacySettings().catch(() => false))) notifications.warn(t('access.privacy.failed')); },
    }, h('span', { html: icon('shield', 14) }), t('access.privacy.button'));
  }

  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.access-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'access-title' },
      h('header.update-head', h('span.update-icon.is-warn', { html: icon('warning', 20) }), h('h2#access-title', tn('access.title', total))),
      h('p', t('access.text')),
      h('div.access-body', sections),
      h('p.access-tip', h('span', { html: icon('info', 14) }), h('span', tip)),
      h('footer.cm-actions',
        h('button.btn.btn-secondary', { onclick: copy }, h('span', { html: icon('copy', 14) }), t('access.copy')),
        h('span.cm-spacer'),
        h('button.btn.btn-secondary', { onclick: close }, t('common.close')),
        scan.busy ? null : fixButton)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}
