/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Turns the compact file columns sent by the main process (platform/files/node/fileColumns.js) into the
// file objects the views use. Paths are rebuilt exactly as the scanner builds them.

/**
 * @param {{ count:number, folders:string[], folderIdx:Uint32Array, names:string[], sizes:Float64Array, mtimes:Float64Array }} cols
 * @param {string} root
 * @param {(ext: string) => string} categorize
 */
export function decodeFiles(cols, root, categorize) {
  const d = decoder(cols, root, categorize);
  d.run(cols.count);
  return d.out;
}

/**
 * Same as decodeFiles, a slice at a time (about 12 ms each), so a million files never freeze the window.
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function decodeFilesAsync(cols, root, categorize, onProgress) {
  const d = decoder(cols, root, categorize);
  const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
  while (d.done < cols.count) {
    const t0 = performance.now();
    while (d.done < cols.count && performance.now() - t0 < 12) d.run(Math.min(cols.count, d.done + 4096));
    onProgress?.(d.done, cols.count);
    if (d.done < cols.count) await yieldNow();
  }
  return d.out;
}

function decoder(cols, root, categorize) {
  const sep = root.includes('\\') ? '\\' : '/';
  const base = root.endsWith(sep) ? root : root + sep;
  const { folders, folderIdx, names, sizes, mtimes, count } = cols;
  const prefixes = folders.map((f) => base + (f ? f + sep : ''));
  const depths = folders.map((f) => (f ? f.split(sep).length : 0));
  const cats = new Map();
  const out = new Array(count);
  const d = { out, done: 0, run: null };
  d.run = (end) => {
  for (let i = d.done; i < end; i++) {
    const fi = folderIdx[i];
    const name = names[i];
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    let cat = cats.get(ext);
    if (cat === undefined) { cat = categorize(ext); cats.set(ext, cat); }
    out[i] = { path: prefixes[fi] + name, name, ext, size: sizes[i], mtime: mtimes[i], folder: folders[fi], depth: depths[fi], cat, i };
  }
  d.done = end;
  };
  return d;
}
