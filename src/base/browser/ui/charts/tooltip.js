/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Single tooltip shared by all charts. Follows the pointer and never leaves the window.
import { h, clear, setChildren } from '../../dom.js';

let el;
function ensure() {
  if (!el) {
    el = h('div.chart-tooltip', { role: 'tooltip', hidden: true });
    document.body.append(el);
  }
  return el;
}

/**
 * @param {PointerEvent|MouseEvent} e
 * @param {{ title: string, color?: string, lines: string[] }} content
 */
export function showTooltip(e, { title, color, lines = [] }) {
  const t = ensure();
  setChildren(t, 
    h('div.ct-title', color ? h('span.ct-swatch', { style: { background: color } }) : null, title),
    ...lines.map((l) => h('div.ct-line', l)));
  t.hidden = false;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + r.width > W - 8) x = e.clientX - r.width - pad;
  if (y + r.height > H - 8) y = e.clientY - r.height - pad;
  t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

export function hideTooltip() {
  if (el) el.hidden = true;
}

/** Binds an element's hover/click to a tooltip. */
export function bindTooltip(target, getContent, onClick) {
  target.addEventListener('pointermove', (e) => showTooltip(e, getContent()));
  target.addEventListener('pointerleave', hideTooltip);
  if (onClick) {
    target.addEventListener('click', (e) => { hideTooltip(); onClick(e); });
    target.style.cursor = 'pointer';
  }
}
