/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Compact form of a file list, used between the background worker, the main process and the window:
// one table of folders and one column per field (numbers in typed arrays). A million files take a few
// tens of MB instead of hundreds, and cross processes far faster than a million objects.
// The window decodes it with the same rules (workbench/services/analysis/common/fileColumns.js).

/** @param {{folder:string,name:string,size:number,mtime:number}[]} files */
function encodeFiles(files) {
  const n = files.length;
  const folders = [];
  const ids = new Map();
  const folderIdx = new Uint32Array(n);
  const sizes = new Float64Array(n);
  const mtimes = new Float64Array(n);
  const names = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = files[i];
    let id = ids.get(f.folder);
    if (id === undefined) { id = folders.length; folders.push(f.folder); ids.set(f.folder, id); }
    folderIdx[i] = id;
    names[i] = f.name;
    sizes[i] = f.size;
    mtimes[i] = f.mtime;
  }
  return { count: n, folders, folderIdx, names, sizes, mtimes };
}

/** Typed arrays of a column set, to transfer instead of copying. */
const transferList = (cols) => [cols.folderIdx.buffer, cols.sizes.buffer, cols.mtimes.buffer];

/** Full path of file i, exactly as the scanner builds it (path.join of the root, the folder and the name). */
function pathAt(cols, root, sep, i) {
  const base = root.endsWith(sep) ? root : root + sep;
  const folder = cols.folders[cols.folderIdx[i]];
  return base + (folder ? folder + sep : '') + cols.names[i];
}

module.exports = { encodeFiles, transferList, pathAt };
