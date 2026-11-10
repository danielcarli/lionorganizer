/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Hatched columns (made of thin vertical lines). Value above, label below.
import { bindTooltip } from './tooltip.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
let uid = 0;

/**
 * @param {{ label:string, value:number, valueLabel:string, tooltip:object }[]} items
 */
export function hatchColumns(items, { width = 560, height = 230, ariaLabel = '' } = {}) {
  const id = `hatch-${++uid}`;
  const top = 26, bottom = 30;
  const plotH = height - top - bottom;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'hatch-chart', role: 'img', 'aria-label': ariaLabel, preserveAspectRatio: 'xMidYMid meet' });
  const defs = s('defs');
  for (const [suffix, cls] of [['', 'hatch-line'], ['-hot', 'hatch-line-hot']]) {
    const pat = s('pattern', { id: id + suffix, width: 6, height: 8, patternUnits: 'userSpaceOnUse' });
    pat.append(s('line', { x1: 1.5, y1: 0, x2: 1.5, y2: 8, class: cls }));
    defs.append(pat);
  }
  svg.append(defs);
  const max = Math.max(...items.map((i) => i.value), 1);
  const slot = width / items.length;
  const colW = Math.min(64, slot * 0.62);
  items.forEach((it, i) => {
    const x = i * slot + (slot - colW) / 2;
    const hgt = Math.max(it.value > 0 ? 2 : 0, (it.value / max) * plotH);
    const g = s('g', { class: 'hatch-col' });
    g.append(s('rect', { x: i * slot, y: 0, width: slot, height, fill: 'transparent' })); // hover area
    const bar = s('rect', { x, y: top + plotH - hgt, width: colW, height: hgt, fill: `url(#${id})`, class: 'hatch-bar' });
    const barHot = s('rect', { x, y: top + plotH - hgt, width: colW, height: hgt, fill: `url(#${id}-hot)`, class: 'hatch-bar-hot' });
    const cap = s('line', { x1: x, x2: x + colW, y1: top + plotH - hgt, y2: top + plotH - hgt, class: 'hatch-cap' });
    const val = s('text', { x: x + colW / 2, y: top + plotH - hgt - 8, 'text-anchor': 'middle', class: 'hatch-value' });
    val.textContent = it.valueLabel;
    const lab = s('text', { x: x + colW / 2, y: height - 8, 'text-anchor': 'middle', class: 'hatch-label' });
    lab.textContent = it.label;
    g.append(bar, barHot, it.value > 0 ? cap : s('g'), val, lab);
    bindTooltip(g, () => it.tooltip);
    svg.append(g);
  });
  svg.append(s('line', { x1: 0, x2: width, y1: top + plotH + 0.5, y2: top + plotH + 0.5, class: 'hatch-base' }));
  return svg;
}
