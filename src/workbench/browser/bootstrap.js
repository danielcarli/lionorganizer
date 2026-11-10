/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Entry point of the UI: loads the language catalogs first, then the workbench.
// The workbench is imported dynamically so every module can call t() safely, even at load time.
import { initNls, t } from '../../base/common/nls.js';
import { bootStatus, bootDone } from './boot.js';

// the theme chosen in the app, before anything else is painted (the loading screen too)
try {
  const theme = localStorage.getItem('lionorganizer.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch { /* storage unavailable */ }

try {
  const locale = await initNls(new URL('../../nls/', import.meta.url));
  window.host?.setLocale?.(locale);
  bootStatus(t('boot.starting'));
  await import('./workbench.js');
} catch (err) {
  bootDone(); // never leave the loading screen over an error
  throw err;
}
