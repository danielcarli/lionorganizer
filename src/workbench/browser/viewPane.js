/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Base class for editor views: only re-renders while visible and marks itself "dirty" while hidden.
import { h } from '../../base/browser/dom.js';

export class ViewPane {
  visible = false;
  #dirty = true;

  constructor(services, id) {
    Object.assign(this, services);
    this.element = h(`section.view.view-${id}`);
  }

  /** Call on any data change: re-renders now, or the next time the view is shown. */
  invalidate() {
    if (this.visible) this.render();
    else this.#dirty = true;
  }

  show() {
    this.element.hidden = false;
    const wasVisible = this.visible;
    this.visible = true;
    if (this.#dirty || !wasVisible) { this.#dirty = false; this.render(); }
  }

  hide() {
    this.element.hidden = true;
    this.visible = false;
  }

  render() {}
}
