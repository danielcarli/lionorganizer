/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Typed event emitter, in the style of vs/base/common/event.
export class Emitter {
  #listeners = new Set();

  /** Subscribe function: emitter.event(fn) returns { dispose }. */
  get event() {
    return (listener) => {
      this.#listeners.add(listener);
      return { dispose: () => this.#listeners.delete(listener) };
    };
  }

  fire(value) {
    for (const l of [...this.#listeners]) {
      try { l(value); } catch (err) { console.error(err); }
    }
  }
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
