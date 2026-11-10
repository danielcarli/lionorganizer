/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Horizontal bars in a list (label · bar · value), with rounded ends.
import { h } from '../../dom.js';
import { bindTooltip } from './tooltip.js';

/**
 * @param {{ label:string, value:number, valueLabel:string, color:string, tooltip:object }[]} items
 */
export function barList(items, { onClick } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return h('div.bar-list', items.map((it) => {
    const row = h('div.bar-row',
      h('span.bar-label', { title: it.label }, it.label),
      h('span.bar-track', h('span.bar-fill', { style: { width: `${Math.max(1, (it.value / max) * 100)}%`, background: it.color } })),
      h('span.bar-value', it.valueLabel));
    bindTooltip(row, () => it.tooltip, onClick ? () => onClick(it) : null);
    return row;
  }));
}
