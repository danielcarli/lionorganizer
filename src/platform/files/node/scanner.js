/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Recursive folder scan with a depth limit.
// Level 0 = the chosen folder itself; maxDepth = 3 reads up to 3 levels of subfolders below it.
// Optionally skips folders that match an ignore list (node_modules, .git…) and reports empty folders.
const fs = require('fs');
const path = require('path');

const DIR_CONCURRENCY = 8;   // folders read in parallel
const STAT_BATCH = 64;       // files stat'ed at a time within a folder
const MAX_LISTED = 5000;     // ignored / empty folders listed in the result (the counts are always exact)
const MAX_PATTERNS = 200;

/**
 * Compiles an ignore list. A pattern without a separator matches a folder NAME anywhere ("node_modules",
 * ".Trash*"); one with a separator matches a path relative to the analyzed folder ("Projects/old/*").
 * "*" and "?" are wildcards. Case-insensitive. Returns null when the list is empty.
 * @param {string[]} patterns
 * @returns {((rel: string, name: string) => boolean) | null}
 */
function compileIgnore(patterns) {
  const list = (Array.isArray(patterns) ? patterns : [])
    .filter((p) => typeof p === 'string')
    .map((p) => p.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, ''))
    .filter((p) => p && p.length <= 260)
    .slice(0, MAX_PATTERNS);
  if (!list.length) return null;
  const toRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$', 'i');
  const byName = list.filter((p) => !p.includes('/')).map(toRe);
  const byPath = list.filter((p) => p.includes('/')).map(toRe);
  return (rel, name) => byName.some((re) => re.test(name)) || (byPath.length > 0 && byPath.some((re) => re.test(rel.replace(/\\/g, '/'))));
}

/**
 * @param {string} root
 * @param {{ maxDepth: number, ignore?: string[], onProgress?: (p:object)=>void, isCancelled?: ()=>boolean }} opts
 *   maxDepth: number of subfolder levels; Infinity = no limit. ignore: see compileIgnore.
 */
function scanFolder(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const isCancelled = opts.isCancelled || (() => false);
  const onProgress = opts.onProgress || (() => {});
  const isIgnored = compileIgnore(opts.ignore);
  const started = Date.now();
  const ignoredDirs = [];    // folders left out by the ignore list (not read)
  let ignoredCount = 0;
  const dirInfo = new Map(); // folder read → { entries: non-folder entries, children: subfolders, ok }

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
    const info = { entries: 0, children: [], ok: true };
    dirInfo.set(dir, info);
    const pendingFiles = [];
    try {
      for await (const ent of handle) {
        if (isCancelled()) { info.ok = false; break; }
        const full = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) { info.entries++; continue; } // avoids loops and double counting (shortcuts/junctions)
        if (ent.isDirectory()) {
          info.children.push(full);
          if (isIgnored && isIgnored(path.relative(root, full), ent.name)) {
            ignoredCount++;
            if (ignoredDirs.length < MAX_LISTED) ignoredDirs.push(full);
          } else if (depth + 1 <= maxDepth) queue.push({ dir: full, depth: depth + 1 });
          else skippedDirs.push(full);
        } else {
          info.entries++;
          if (ent.isFile()) pendingFiles.push(full);
        }
      }
    } catch (err) {
      info.ok = false;
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

  /**
   * Empty folders: read completely, with no files and only empty subfolders (also read completely).
   * Folders below the depth limit, ignored or unreadable are unknown, so their parents are never "empty".
   * Lists only the topmost empty folder of each empty branch (moving it to the Recycle Bin takes the rest).
   */
  function emptyFolders() {
    const memo = new Map();
    const isEmpty = (dir) => {
      if (memo.has(dir)) return memo.get(dir);
      const info = dirInfo.get(dir);
      memo.set(dir, false); // guards against cycles (cannot happen without symlinks, but cheap)
      const empty = !!info && info.ok && info.entries === 0 && info.children.every(isEmpty);
      memo.set(dir, empty);
      return empty;
    };
    const list = [];
    let count = 0;
    const walk = (dir) => {
      const info = dirInfo.get(dir);
      if (!info) return;
      for (const child of info.children) {
        if (isEmpty(child)) {
          count++;
          if (list.length < MAX_LISTED) list.push({ path: child, folder: path.relative(root, child), dirs: countDirs(child) });
        } else walk(child);
      }
    };
    const countDirs = (dir) => 1 + (dirInfo.get(dir)?.children || []).reduce((n, c) => n + countDirs(c), 0);
    walk(root);
    return { list, count };
  }

  return new Promise((resolve) => {
    const finish = () => {
      const cancelled = isCancelled();
      const empty = cancelled ? { list: [], count: 0 } : emptyFolders();
      resolve({
        root,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : null,
        files,
        dirsRead,
        readDirs,
        skippedDirs,
        skippedCount: skippedDirs.length,
        errors,
        errorCount: errors.length,
        bytes,
        emptyDirs: empty.list,
        emptyDirCount: empty.count,
        ignoredDirs,
        ignoredCount,
        ignore: isIgnored ? opts.ignore.slice(0, MAX_PATTERNS) : [],
        cancelled,
        durationMs: Date.now() - started,
      });
    };

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

module.exports = { scanFolder, compileIgnore };
