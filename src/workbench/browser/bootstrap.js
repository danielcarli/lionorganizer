/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Entry point of the UI: loads the language catalogs first, then the workbench.
// The workbench is imported dynamically so every module can call t() safely, even at load time.
import { initNls } from '../../base/common/nls.js';

const locale = await initNls(new URL('../../nls/', import.meta.url));
window.host?.setLocale?.(locale);
await import('./workbench.js');
