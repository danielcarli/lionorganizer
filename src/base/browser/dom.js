/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// DOM utilities (a lean equivalent of vs/base/browser/dom).

/**
 * h('div.class#id', { attrs/props/events }, ...children)
 * Attributes starting with "on" become event listeners.
 */
export function h(selector, props, ...children) {
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const [tag, ...rest] = selector.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const token of rest) {
    if (token.startsWith('.')) el.classList.add(token.slice(1));
    else if (token.startsWith('#')) el.id = token.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v; // only used with the app's own SVG icons
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Replaces all children (accepts nested arrays and ignores null/false). */
export function setChildren(el, ...children) {
  clear(el);
  return append(el, children);
}

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
