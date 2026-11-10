/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Recursive folder scan with a depth limit.
// Level 0 = the chosen folder itself; maxDepth = 3 reads up to 3 levels of subfolders below it.
const fs = require('fs');
const path = require('path');

const DIR_CONCURRENCY = 8;   // folders read in parallel
const STAT_BATCH = 64;       // files stat'ed at a time within a folder

/**
 * @param {string} root
 * @param {{ maxDepth: number, onProgress?: (p:object)=>void, isCancelled?: ()=>boolean }} opts
 *   maxDepth: number of subfolder levels; Infinity = no limit.
 */
function scanFolder(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const isCancelled = opts.isCancelled || (() => false);
  const onProgress = opts.onProgress || (() => {});
  const started = Date.now();

  const files = [];
  const skippedDirs = [];   // folders below the limit (not read)
  const errors = [];        // folders/files without permission, etc.
  let dirsRead = 0;
  const readDirs = [];      // folders read (relative to the root) — used by the catalog to detect removed files
  let bytes = 0;

  const queue = [{ dir: root, depth: 0 }];
  let head = 0;
  let active = 0;
  let lastProgress = 0;

  async function readDir({ dir, depth }) {
    let handle;
    try {
      handle = await fs.promises.opendir(dir);
    } catch (err) {
      errors.push({ path: dir, code: err.code || 'ERROR' });
      return;
    }
    dirsRead++;
    readDirs.push(path.relative(root, dir));
    const pendingFiles = [];
    try {
      for await (const ent of handle) {
        if (isCancelled()) break;
        const full = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) continue; // avoids loops and double counting (shortcuts/junctions)
        if (ent.isDirectory()) {
          if (depth + 1 <= maxDepth) queue.push({ dir: full, depth: depth + 1 });
          else skippedDirs.push(full);
        } else if (ent.isFile()) {
          pendingFiles.push(full);
        }
      }
    } catch (err) {
      errors.push({ path: dir, code: err.code || 'ERROR' });
    }

    const rel = path.relative(root, dir);
    for (let i = 0; i < pendingFiles.length && !isCancelled(); i += STAT_BATCH) {
      const batch = pendingFiles.slice(i, i + STAT_BATCH);
      const stats = await Promise.all(batch.map((f) => fs.promises.lstat(f).catch((e) => e)));
      stats.forEach((st, k) => {
        const full = batch[k];
        if (st instanceof Error) {
          errors.push({ path: full, code: st.code || 'ERROR' });
          return;
        }
        const name = path.basename(full);
        const dot = name.lastIndexOf('.');
        files.push({
          path: full,
          name,
          ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
          size: st.size,
          mtime: st.mtimeMs,
          folder: rel,
          depth,
        });
        bytes += st.size;
      });
    }

    const now = Date.now();
    if (now - lastProgress > 120) {
      lastProgress = now;
      onProgress({ files: files.length, dirs: dirsRead, bytes, current: dir });
    }
  }

  return new Promise((resolve) => {
    const finish = () =>
      resolve({
        root,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : null,
        files,
        dirsRead,
        readDirs,
        skippedDirs,
        errors,
        bytes,
        cancelled: isCancelled(),
        durationMs: Date.now() - started,
      });

    const pump = () => {
      if (isCancelled()) head = queue.length;
      while (active < DIR_CONCURRENCY && head < queue.length) {
        const item = queue[head++];
        active++;
        readDir(item).finally(() => {
          active--;
          if (active === 0 && head >= queue.length) finish();
          else pump();
        });
      }
      if (active === 0 && head >= queue.length) finish();
    };
    pump();
  });
}

module.exports = { scanFolder };
