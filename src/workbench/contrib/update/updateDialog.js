/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Update dialog, opened from the version indicator: asks whether to update when there is a new version,
// otherwise says the app is up to date (or that the check failed). Updating is done by the installer
// the app was installed with; nothing is changed until the user clicks the button.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t } from '../../../base/common/nls.js';

/** @param {{ update: import('../../services/update/browser/updateService.js').UpdateService, notifications: any }} services */
export function showUpdateDialog({ update, notifications }) {
  if (document.querySelector('.update-dialog')) return;
  const body = h('div.update-body');
  const actions = h('footer.cm-actions');
  const close = () => { sub.dispose(); overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const auto = h('input', { type: 'checkbox', checked: update.autoCheck, onchange: (e) => { update.autoCheck = e.target.checked; } });
  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.update-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'update-title' },
      body,
      h('label.update-auto', auto, h('span', t('update.dialog.autoCheck'))),
      h('p.muted.small.update-privacy', t('update.dialog.privacy')),
      actions));

  let busy = false;
  const render = () => {
    const { status, info } = update;
    const version = info?.current || update.version;
    const head = (iconName, title, cls = '') => h(`header.update-head${cls}`, h('span.update-icon', { html: icon(iconName, 20) }), h('h2#update-title', title));
    const versions = (latest) => h('dl.update-versions',
      h('dt', t('update.dialog.installed')), h('dd', version || '—'),
      latest ? [h('dt', t('update.dialog.newVersion')), h('dd.update-new', latest)] : null);

    if (status === 'available') {
      const how = { installer: 'update.dialog.howInstaller', script: 'update.dialog.howScript', download: 'update.dialog.howDownload' }[info.method] || 'update.dialog.howDownload';
      setChildren(body,
        head('download', t('update.dialog.availableTitle'), '.is-available'),
        versions(info.latest),
        h('p', t(how)),
        h('p.update-question', t('update.dialog.question')),
        h('button.link', { onclick: () => update.openReleasePage() }, t('update.dialog.whatsNew')));
      const go = h('button.btn.btn-primary', { disabled: busy, onclick: () => run() },
        h('span', { html: icon('download', 14) }), t(info.method === 'download' ? 'update.dialog.openDownload' : 'update.dialog.updateNow'));
      setChildren(actions, h('button.btn.btn-secondary', { onclick: close }, t('update.dialog.notNow')), go);
      requestAnimationFrame(() => go.focus());
    } else if (status === 'checking' || status === 'idle') {
      setChildren(body, head('refresh', t('update.dialog.checking')), versions(null));
      setChildren(actions, h('button.btn.btn-secondary', { onclick: close }, t('common.close')));
    } else {
      const ok = status === 'current';
      setChildren(body,
        head(ok ? 'shield' : 'warning', t(ok ? 'update.dialog.currentTitle' : 'update.dialog.errorTitle')),
        versions(null),
        h('p', ok ? t('update.dialog.currentText') : t('update.dialog.errorText')));
      setChildren(actions,
        h('button.btn.btn-secondary', { onclick: () => update.check() }, h('span', { html: icon('refresh', 14) }), t('update.dialog.checkAgain')),
        h('button.btn.btn-primary', { onclick: close }, t('common.close')));
    }
  };

  const run = async () => {
    busy = true;
    render();
    const res = await update.install().catch((err) => ({ ok: false, error: String(err?.message || err) }));
    busy = false;
    if (!res.ok) { notifications.warn(t('update.failed', { error: res.error || '' })); render(); return; }
    if (res.action === 'download') { close(); notifications.info(t('update.downloadOpened'), 8000); return; }
    // installer / script: the app closes and the installer takes over
    setChildren(body, h('header.update-head', h('span.update-icon.spin', { html: icon('refresh', 20) }), h('h2#update-title', t('update.dialog.closing'))));
    setChildren(actions);
  };

  const sub = update.onDidChange(render);
  render();
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  update.check(); // always fresh: the saved state may be hours old (it is a tiny file)
}
