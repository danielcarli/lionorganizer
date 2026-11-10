/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Squarified" treemap with rounded-corner tiles (area = size).
import { h } from '../../dom.js';
import { bindTooltip } from './tooltip.js';

/**
 * @param {{ label:string, value:number, sub:string, tooltip:object, muted?:boolean }[]} items
 * @param {{ height?: number, onClick?: (item)=>void }} opts
 */
export function treemap(items, { height = 320, onClick } = {}) {
  const root = h('div.treemap', { style: { height: `${height}px` } });
  const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const draw = () => {
    root.replaceChildren();
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (!W || !data.length) return;
    const total = data.reduce((s, d) => s + d.value, 0);
    const scaled = data.map((d) => ({ d, area: (d.value / total) * W * H }));
    for (const r of squarify(scaled, { x: 0, y: 0, w: W, h: H })) {
      const gap = 3;
      const w = Math.max(0, r.w - gap * 2);
      const hh = Math.max(0, r.h - gap * 2);
      const small = w < 74 || hh < 44;
      const tile = h(`div.tm-tile${r.d.muted ? '.muted' : ''}${small ? '.small' : ''}`, {
        style: { left: `${r.x + gap}px`, top: `${r.y + gap}px`, width: `${w}px`, height: `${hh}px` },
      },
        small ? null : h('span.tm-label', r.d.label),
        small ? null : h('span.tm-sub', r.d.sub));
      bindTooltip(tile, () => r.d.tooltip, onClick && !r.d.muted ? () => onClick(r.d) : null);
      root.append(tile);
    }
  };
  const ro = new ResizeObserver(() => draw());
  ro.observe(root);
  return root;
}

function worst(row, side) {
  const s = row.reduce((a, r) => a + r.area, 0);
  let max = 0, min = Infinity;
  for (const r of row) { max = Math.max(max, r.area); min = Math.min(min, r.area); }
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

function squarify(items, rect) {
  const out = [];
  let rest = items.slice();
  let { x, y, w, h: hh } = rect;
  while (rest.length) {
    const side = Math.min(w, hh);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    rest = rest.slice(i);
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (w >= hh) {
      const cw = sum / hh;
      let cy = y;
      for (const r of row) { const rh = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }
      x += cw; w -= cw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const r of row) { const rw = r.area / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; hh -= rh;
    }
  }
  return out;
}
