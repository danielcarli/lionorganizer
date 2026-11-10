/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Layout state: active view, side bar visibility and theme.
import { Emitter } from '../../../../base/common/event.js';
import { t } from '../../../../base/common/nls.js';

export const VIEWS = [
  { id: 'overview', icon: 'pie', shortcut: 'Ctrl+1' },
  { id: 'files', icon: 'list', shortcut: 'Ctrl+2' },
  { id: 'cleanup', icon: 'sparkle', shortcut: 'Ctrl+3' },
  { id: 'duplicates', icon: 'copy', shortcut: 'Ctrl+4' },
  { id: 'organize', icon: 'organize', shortcut: 'Ctrl+5' },
  { id: 'catalog', icon: 'database', shortcut: 'Ctrl+6' },
  { id: 'treemap', icon: 'map', shortcut: 'Ctrl+7' },
].map((v) => ({ ...v, label: t('views.' + v.id) }));

const THEME_KEY = 'lionorganizer.theme';

export class LayoutService {
  #onDidChangeView = new Emitter();
  #onDidChangeSidebar = new Emitter();
  #onDidChangeTheme = new Emitter();
  onDidChangeView = this.#onDidChangeView.event;
  onDidChangeSidebar = this.#onDidChangeSidebar.event;
  onDidChangeTheme = this.#onDidChangeTheme.event;

  activeView = 'overview';
  sidebarVisible = true;

  constructor(host) {
    this.host = host;
    let pref = 'auto';
    try { pref = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* ignore */ }
    this.themePreference = ['auto', 'light', 'dark'].includes(pref) ? pref : 'auto';
    this.media = matchMedia('(prefers-color-scheme: dark)');
    this.media.addEventListener('change', () => this.#applyTheme());
    this.#applyTheme();
  }

  openView(id) {
    if (id === this.activeView) return;
    this.activeView = id;
    this.#onDidChangeView.fire(id);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    this.#onDidChangeSidebar.fire(this.sidebarVisible);
  }

  get isDark() {
    return this.themePreference === 'dark' || (this.themePreference === 'auto' && this.media.matches);
  }

  /** @param {'auto'|'light'|'dark'} pref */
  setTheme(pref) {
    if (!['auto', 'light', 'dark'].includes(pref) || pref === this.themePreference) return;
    this.themePreference = pref;
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
    this.#applyTheme();
  }

  #applyTheme() {
    const root = document.documentElement;
    if (this.themePreference === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.themePreference);
    this.host.setTheme(this.isDark);
    this.#onDidChangeTheme.fire(this.isDark);
  }
}
