/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Radial rose: one petal per item, same angle for all; the radius grows with the square root
// of the value (proportional area). Each petal sits on a rounded neutral "track".
import { bindTooltip } from './tooltip.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/**
 * @param {{ id:string, label:string, value:number, color:string, valueLabel:string, tooltip:object }[]} items
 * @param {{ size?: number, onClick?: (item)=>void, ariaLabel?: string }} opts
 */
export function roseChart(items, { size = 380, onClick, ariaLabel } = {}) {
  const C = size / 2;
  const R = C - 4;          // track radius
  const r0 = size * 0.1;    // center hole
  const valueMax = R * 0.78; // largest petal — leaves the outer band free for the label
  const corner = 9;          // rounded corner radius
  const gap = 3;             // half the gap between petals
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, class: 'rose', role: 'img', 'aria-label': ariaLabel || '' });
  const n = items.length;
  if (!n) return svg;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const step = (Math.PI * 2) / n;
  const start = -Math.PI / 2 - (n === 1 ? 0 : step / 2) ;

  items.forEach((it, i) => {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const g = s('g', { class: 'rose-petal' });
    const rv = r0 + (valueMax - r0) * Math.sqrt(it.value / max);
    g.append(
      s('path', { d: wedge(C, r0, R, a0, a1, gap, corner, n), class: 'rose-track' }),
      s('path', { d: wedge(C, r0, Math.max(rv, r0 + corner * 2 + 2), a0, a1, gap, corner, n), class: 'rose-value', fill: it.color, stroke: it.color, 'stroke-width': corner * 2, 'stroke-linejoin': 'round' }));

    // label on the outer band of the track
    const mid = (a0 + a1) / 2;
    const lr = (valueMax + R) / 2 + 2;
    const x = C + lr * Math.cos(mid);
    const y = C + lr * Math.sin(mid);
    const t1 = s('text', { x, y: y - 3, class: 'rose-value-label', 'text-anchor': 'middle' });
    t1.textContent = it.valueLabel;
    const t2 = s('text', { x, y: y + 11, class: 'rose-name-label', 'text-anchor': 'middle' });
    t2.textContent = it.label;
    g.append(t1, t2);
    bindTooltip(g, () => it.tooltip, onClick ? () => onClick(it) : null);
    svg.append(g);
  });
  return svg;
}

/** Petal inset by the corner radius; the rounded stroke restores the size and rounds the corners. */
function wedge(C, rIn, rOut, a0, a1, gap, corner, n) {
  const d = gap + corner;
  const ri = rIn + corner;
  const ro = rOut - corner;
  if (n === 1) {
    // full circle (ring)
    return `M ${C + ro} ${C} A ${ro} ${ro} 0 1 1 ${C - ro} ${C} A ${ro} ${ro} 0 1 1 ${C + ro} ${C} M ${C + ri} ${C} A ${ri} ${ri} 0 1 0 ${C - ri} ${C} A ${ri} ${ri} 0 1 0 ${C + ri} ${C} Z`;
  }
  const dOut = Math.asin(Math.min(0.95, d / ro));
  const dIn = Math.asin(Math.min(0.95, d / Math.max(ri, d + 1)));
  const o0 = a0 + dOut, o1 = a1 - dOut;
  const i0 = a0 + dIn, i1 = a1 - dIn;
  const p = (r, a) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  const large = o1 - o0 > Math.PI ? 1 : 0;
  if (i1 <= i0) {
    // petal too narrow at the center: ends in a point
    const am = (a0 + a1) / 2;
    return `M ${p(ri, am)} L ${p(ro, o0)} A ${ro} ${ro} 0 ${large} 1 ${p(ro, o1)} Z`;
  }
  return `M ${p(ri, i0)} L ${p(ro, o0)} A ${ro} ${ro} 0 ${large} 1 ${p(ro, o1)} L ${p(ri, i1)} A ${ri} ${ri} 0 ${i1 - i0 > Math.PI ? 1 : 0} 0 ${p(ri, i0)} Z`;
}
