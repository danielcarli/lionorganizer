/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Loading screen (#boot in workbench.html): says what the app is doing while it starts — loading the
// interface, reading the last saved analysis — and goes away when the UI is ready.
const el = () => document.getElementById('boot');
let skipTimer = null;

export function bootStatus(text, detail = '') {
  const b = el();
  if (!b) return;
  b.querySelector('.boot-status').textContent = text;
  b.querySelector('.boot-detail').textContent = detail;
}

/** A button to stop waiting, shown only if the step takes longer than `delay` ms. */
export function bootSkip(label, onClick, delay = 2500) {
  const b = el();
  if (!b) return;
  const btn = b.querySelector('.boot-skip');
  btn.textContent = label;
  btn.onclick = onClick;
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => { btn.hidden = false; }, delay);
}

export function bootDone() {
  clearTimeout(skipTimer);
  const b = el();
  if (!b || b.classList.contains('is-done')) return;
  b.classList.add('is-done');
  setTimeout(() => b.remove(), 260);
}

/** Lets the browser paint the loading screen before a long synchronous step. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
