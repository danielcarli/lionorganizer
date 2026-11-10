/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Finds files with identical content in 3 stages, reading as little from disk as possible:
//   1) group by size (a unique size cannot have a copy);
//   2) quick hash of the first 64 KB + last 64 KB (rules out most false pairs);
//   3) full-file SHA-256 only for files that are still tied.
// Hashes already computed (same path, size and date) come from the catalog and are not re-read.
const fs = require('fs');
const crypto = require('crypto');

const EDGE = 64 * 1024;
const CHUNK = 1024 * 1024;

async function partialHash(file, size) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(Math.min(EDGE, size));
    let r = await fh.read(buf, 0, buf.length, 0);
    h.update(buf.subarray(0, r.bytesRead));
    if (size > EDGE * 2) {
      r = await fh.read(buf, 0, EDGE, size - EDGE);
      h.update(buf.subarray(0, r.bytesRead));
    }
    h.update(String(size));
    return h.digest('hex');
  } finally {
    await fh.close();
  }
}

function fullHash(file, onBytes, isCancelled) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: CHUNK });
    stream.on('data', (chunk) => {
      if (isCancelled()) { stream.destroy(); resolve(null); return; }
      h.update(chunk);
      onBytes(chunk.length);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * @param {{path:string,size:number,mtime:number}[]} files
 * @param {{ minSize:number, cache?:{get:(f)=>string|null}, onProgress:(p)=>void, isCancelled:()=>boolean }} opts
 */
async function findDuplicates(files, { minSize = 1, cache, onProgress = () => {}, isCancelled = () => false }) {
  const started = Date.now();
  const stats = { candidates: 0, cached: 0, partialRead: 0, fullRead: 0, bytesRead: 0, errors: [] };
  const fresh = []; // new hashes to save in the catalog

  // 1) by size
  const bySize = new Map();
  for (const f of files) {
    if (f.size < Math.max(1, minSize)) continue;
    let g = bySize.get(f.size);
    if (!g) bySize.set(f.size, (g = []));
    g.push(f);
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1);
  const candidates = sizeGroups.flat();
  stats.candidates = candidates.length;

  const full = new Map(); // path -> sha256
  const needWork = [];
  for (const f of candidates) {
    const h = cache?.get(f);
    if (h) { full.set(f.path, h); stats.cached++; } else needWork.push(f);
  }

  // byte estimate for the progress bar (partial reads + full reads of files that may tie)
  let bytesTotal = needWork.reduce((s, f) => s + Math.min(f.size, EDGE * 2), 0);
  let bytesDone = 0;
  let filesDone = stats.cached;
  let current = '';
  let last = 0;
  const report = (force) => {
    const now = Date.now();
    if (!force && now - last < 120) return;
    last = now;
    onProgress({ stage: stagesLabel, filesDone, filesTotal: candidates.length, bytesDone, bytesTotal, current });
  };
  let stagesLabel = 'partial';

  // 2) partial hash (small files get their full hash right here)
  const partial = new Map();
  for (const f of needWork) {
    if (isCancelled()) break;
    current = f.path;
    try {
      if (f.size <= EDGE * 2) {
        const h = await fullHash(f.path, (n) => { bytesDone += n; stats.bytesRead += n; }, isCancelled);
        if (h) { full.set(f.path, h); fresh.push({ ...f, hash: h }); stats.fullRead++; }
      } else {
        partial.set(f.path, await partialHash(f.path, f.size));
        bytesDone += EDGE * 2; stats.bytesRead += EDGE * 2; stats.partialRead++;
      }
    } catch (err) {
      stats.errors.push({ path: f.path, code: err.code || 'ERROR' });
    }
    filesDone++;
    report();
  }

  // 3) full SHA-256 only for files tied on the partial hash (also considering already-known hashes)
  stagesLabel = 'full';
  const toFull = [];
  for (const group of sizeGroups) {
    const byKey = new Map();
    for (const f of group) {
      const key = full.get(f.path) ? 'F:' + full.get(f.path) : partial.has(f.path) ? 'P:' + partial.get(f.path) : null;
      if (!key) continue;
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = []));
      g.push(f);
    }
    // a partial group needs a full read if it has 2+ members, or if it may match already-known full hashes
    const knownFull = [...byKey.keys()].some((k) => k.startsWith('F:'));
    for (const [key, g] of byKey) {
      if (!key.startsWith('P:')) continue;
      if (g.length > 1 || knownFull) toFull.push(...g);
    }
  }
  bytesTotal += toFull.reduce((s, f) => s + f.size, 0);
  report(true);
  for (const f of toFull) {
    if (isCancelled()) break;
    current = f.path;
    try {
      const h = await fullHash(f.path, (n) => { bytesDone += n; stats.bytesRead += n; report(); }, isCancelled);
      if (h) { full.set(f.path, h); fresh.push({ ...f, hash: h }); stats.fullRead++; }
    } catch (err) {
      stats.errors.push({ path: f.path, code: err.code || 'ERROR' });
    }
    report();
  }

  // final groups
  const byHash = new Map();
  for (const f of candidates) {
    const h = full.get(f.path);
    if (!h) continue;
    let g = byHash.get(h);
    if (!g) byHash.set(h, (g = { hash: h, size: f.size, paths: [] }));
    g.paths.push(f.path);
  }
  const groups = [...byHash.values()].filter((g) => g.paths.length > 1)
    .sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1));

  current = '';
  report(true);
  return { groups, fresh, stats: { ...stats, durationMs: Date.now() - started, cancelled: isCancelled() } };
}

module.exports = { findDuplicates };
