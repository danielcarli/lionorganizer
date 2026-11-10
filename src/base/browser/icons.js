/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Thin-stroke icons (codicon style), drawn inline as SVG.
const svg = (body, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const paths = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  folderOpen: '<path d="M3 18.5V6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h7.8A1.5 1.5 0 0 1 20 8.7V10"/><path d="M3 18.5l2.6-7.1A1.5 1.5 0 0 1 7 10.4h13.6a1 1 0 0 1 .95 1.3L19.4 18.9a1.5 1.5 0 0 1-1.4 1.1H4.5A1.5 1.5 0 0 1 3 18.5z"/>',
  reveal: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M10 15.5l4-4M11 11.5h3v3"/>',
  trash: '<path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>',
  arrowUpRight: '<path d="M7 17L17 7M9 7h8v8"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  organize: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6l1.7 1.8H19a1.5 1.5 0 0 1 1.5 1.5v9.7A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 11.5h3.5M8 15h6M14.5 11.5h1.5"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  undo: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 1 0 9h-2"/>',
  shield: '<path d="M12 3.5l7.5 3v5.2c0 4.4-3.1 7.9-7.5 9.3-4.4-1.4-7.5-4.9-7.5-9.3V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  rename: '<path d="M4 7h10M4 12h7M4 17h5"/><path d="M14.5 19.5l1-3.5 4.6-4.6a1.6 1.6 0 0 1 2.3 2.3L17.8 18.3z"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.5l3 1.8"/>',
  hash: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15M3.5 15h15"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/>',
  disk: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 14h17M17 16.5h.01"/>',
};

export function icon(name, size) {
  return svg(paths[name] || '', size);
}
