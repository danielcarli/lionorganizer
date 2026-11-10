/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Category colors read from the theme (CSS variables). The color follows the type, never the position.
import { cssVar } from '../../base/browser/dom.js';
import { CATEGORY_BY_ID } from '../services/analysis/common/fileCategories.js';

export function categoryColor(catId) {
  const slot = CATEGORY_BY_ID[catId]?.slot ?? 0;
  return cssVar(slot ? `--series-${slot}` : '--series-other');
}

/** Dot matrix colors (follow the theme). */
export function dotColor(catId) {
  const slot = CATEGORY_BY_ID[catId]?.slot ?? 0;
  return cssVar(slot ? `--dot-${slot}` : '--dot-other');
}

/** Color of the "can go" dots in the Cleanup dot matrix. */
export const freeDotColor = () => cssVar('--dot-free');
