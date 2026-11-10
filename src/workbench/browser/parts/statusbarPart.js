/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Status bar: analysis state, totals, configured depth, warnings, theme and language pickers, and the
// version indicator (bottom-right corner), which shows when a new version is available.
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes, formatDuration } from '../../../base/common/format.js';
import { t, tn, getLocales, getLocalePreference, setLocalePreference } from '../../../base/common/nls.js';
import { showUpdateDialog } from '../../contrib/update/updateDialog.js';
import { showAccessDialog } from '../../contrib/access/accessDialog.js';

export class StatusbarPart {
  constructor(services) {
    Object.assign(this, services);
    this.left = h('div.status-left');
    this.right = h('div.status-right');
    this.themeSwitch = h('div.theme-switch', { role: 'radiogroup', 'aria-label': t('statusbar.theme') });
    this.languagePicker = this.#createLanguagePicker();
    this.versionButton = h('button.status-version', { onclick: () => showUpdateDialog(services) });
    this.element = h('footer.part.statusbar', this.left, h('div.status-right-wrap', this.right, this.themeSwitch, this.languagePicker, this.versionButton));
    this.update.onDidChange(() => this.#renderVersion());
    this.#renderVersion();
    this.layout.onDidChangeTheme(() => this.#renderThemeSwitch());
    this.#renderThemeSwitch();
    const r = () => this.render();
    this.scan.onDidChangeState(r);
    this.scan.onDidProgress(r);
    this.scan.onDidChangeSettings(r);
    this.analysis.onDidChangeData(r);
    this.analysis.onDidChangeSelection(r);
    this.render();
  }

  render() {
    const { scan, analysis } = this;
    const busy = scan.state === 'scanning';
    this.element.classList.toggle('busy', scan.busy);
    clear(this.left);
    clear(this.right);

    if (busy) {
      const p = scan.progress || { files: 0, bytes: 0 };
      this.left.append(item('refresh', tn('statusbar.scanning', p.files, { size: formatBytes(p.bytes) }), { spin: true }));
    } else if (analysis.hasData) {
      const r = analysis.result;
      if (scan.state === 'refreshing') {
        const p = scan.progress || { files: 0, bytes: 0 };
        this.left.append(item('refresh', tn('statusbar.refreshing', p.files, { size: formatBytes(p.bytes) }), { spin: true }));
      }
      this.left.append(item('disk', tn('statusbar.total', analysis.files.length, { size: formatBytes(analysis.tree.size) })));
      this.left.append(item(null, tn(r.cancelled ? 'statusbar.dirsReadCancelled' : 'statusbar.dirsRead', r.dirsRead, { duration: formatDuration(r.durationMs) })));
      const errors = r.errorCount ?? r.errors.length;
      if (errors) {
        this.left.append(h('button.status-item.warn.status-access', {
          title: t('statusbar.noAccessTitle'), onclick: () => showAccessDialog(this),
        }, h('span.status-icon', { html: icon('warning', 13) }), tn('statusbar.noAccess', errors)));
      }
    } else {
      this.left.append(item(null, t('statusbar.ready')));
    }

    if (analysis.selection.size) {
      const bytes = analysis.selectedFiles().reduce((s, f) => s + f.size, 0);
      this.right.append(item(null, tn('statusbar.selected', analysis.selection.size, { size: formatBytes(bytes) })));
    }
    const depthText = scan.settings.unlimited ? t('statusbar.depthUnlimited') : tn('statusbar.depth', scan.settings.depth);
    this.right.append(item('layers', depthText, { title: t('statusbar.depthTitle') }));
  }

  /** Version indicator: "v1.0.3", highlighted when a new version is available. */
  #renderVersion() {
    const { status, info, version } = this.update;
    const available = status === 'available';
    const b = this.versionButton;
    b.classList.toggle('update-available', available);
    const title = available ? t('update.status.availableTitle', { version: info.latest })
      : status === 'checking' ? t('update.status.checking')
      : status === 'current' ? t('update.status.currentTitle')
      : status === 'error' ? t('update.status.errorTitle')
      : t('update.status.title');
    b.title = title;
    b.setAttribute('aria-label', title);
    setChildren(b,
      h(`span.status-icon${status === 'checking' ? '.spin' : ''}`, { html: icon(available ? 'download' : status === 'checking' ? 'refresh' : 'info', 12) }),
      available ? t('update.status.available', { version: info.latest }) : version ? `v${version}` : '');
  }

  #renderThemeSwitch() {
    const current = this.layout.themePreference;
    setChildren(this.themeSwitch, THEMES.map((th) => h('button.theme-option', {
      role: 'radio', 'aria-checked': String(th.id === current), title: t(th.title),
      class: `theme-option${th.id === current ? ' active' : ''}`,
      onclick: () => this.layout.setTheme(th.id),
    }, h('span.status-icon', { html: icon(th.icon, 12) }), t(th.label))));
  }

  /** Language picker: "auto" (follow the system) or one of the bundled locales. Changing it reloads the window. */
  #createLanguagePicker() {
    const current = getLocalePreference();
    const options = [['auto', t('nls.auto')], ...getLocales().map((l) => [l.id, l.label])];
    const select = h('select.status-select', {
      'aria-label': t('nls.language'),
      onchange: (e) => setLocalePreference(e.target.value, this.analysis.hasData),
    }, options.map(([value, label]) => h('option', { value, lang: value === 'auto' ? undefined : value, selected: value === current }, label)));
    return h('label.status-language', { title: `${t('nls.language')} — ${t('nls.changeHint')}` },
      h('span.status-icon', { html: icon('globe', 12) }),
      select);
  }
}

const THEMES = [
  { id: 'auto', label: 'statusbar.themeAuto', icon: 'auto', title: 'statusbar.themeAutoTitle' },
  { id: 'light', label: 'statusbar.themeLight', icon: 'sun', title: 'statusbar.themeLightTitle' },
  { id: 'dark', label: 'statusbar.themeDark', icon: 'moon', title: 'statusbar.themeDarkTitle' },
];

function item(iconName, text, { spin = false, title, cls } = {}) {
  return h(`span.status-item${cls ? '.' + cls : ''}`, { title },
    iconName ? h(`span.status-icon${spin ? '.spin' : ''}`, { html: icon(iconName, 13) }) : null, text);
}
