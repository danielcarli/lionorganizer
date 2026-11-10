/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Dot matrix: 100 dots = 100% (each dot is worth 1%).
// Dots take the color of the group they belong to, in the given order (largest remainder method).
import { h } from '../../dom.js';
import { bindTooltip } from './tooltip.js';

/**
 * @param {{ value:number, color:string, tooltip:object, dim?:boolean }[]} groups
 * @param {{ columns?: number, total?: number, footerLeft?: string, footerRight?: string }} opts
 */
export function dotMatrix(groups, { columns = 20, footerLeft = '', footerRight = '' } = {}) {
  const total = groups.reduce((s, g) => s + g.value, 0) || 1;
  const exact = groups.map((g) => (g.value / total) * 100);
  const counts = exact.map(Math.floor);
  let left = 100 - counts.reduce((a, b) => a + b, 0);
  exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left--; } });

  const grid = h('div.dot-grid', { style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } });
  groups.forEach((g, gi) => {
    for (let k = 0; k < counts[gi]; k++) {
      const dot = h(`span.dot${g.dim ? '.dim' : ''}`, { style: g.dim ? null : { background: g.color } });
      bindTooltip(dot, () => g.tooltip);
      grid.append(dot);
    }
  });
  return h('div.dot-card', grid, h('div.dot-footer', h('span', footerLeft), h('span', footerRight)));
}
