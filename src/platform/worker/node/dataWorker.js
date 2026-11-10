/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Background worker (a thread of the main process) that does the heavy work: reading folders, the
// catalog (SQLite) and the content hashes. The main process stays free to keep the window responsive
// and only relays messages. It holds the only connection to the catalog, so writes never wait on each other.
//
// Messages in:  { type: 'call', id, method, args } · { type: 'cancel', id }
// Messages out: { type: 'ready', available, error, file } · { type: 'progress', id, data }
//               { type: 'result', id, value } · { type: 'result', id, error }
const { parentPort, workerData } = require('worker_threads');
const { scanFolder, compileIgnore } = require('../../files/node/scanner');
const { encodeFiles, transferList } = require('../../files/node/fileColumns');
const { findDuplicates } = require('../../catalog/node/duplicateFinder');

// Tests only: lets the end-to-end test simulate protected or slow folders inside this thread.
if (workerData.testHook && process.env.LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS === '1') require(workerData.testHook);

let db = null;
let dbError = null;
try {
  const { CatalogDatabase } = require('../../catalog/node/catalogDatabase');
  db = new CatalogDatabase(workerData.dbFile);
} catch (err) {
  dbError = String(err?.message || err);
}
parentPort.postMessage({ type: 'ready', available: !!db, error: dbError, file: db?.file || null });

// catalog methods the main process may call
const DB_METHODS = new Set(['history', 'compare', 'stats', 'search', 'allFilesForExport', 'hasPath', 'applyMoves',
  'markTrashed', 'logOperation', 'operation', 'markUndone', 'recentOperations', 'clear']);

const tokens = new Map(); // call id → { cancelled }
const progress = (id) => (data) => parentPort.postMessage({ type: 'progress', id, data });

function extrasOf(r) {
  return {
    dirsRead: r.dirsRead, durationMs: r.durationMs,
    errors: r.errors.slice(0, 2000), errorCount: r.errors.length,
    skippedDirs: r.skippedDirs.slice(0, 2000), skippedCount: r.skippedDirs.length,
    emptyDirs: r.emptyDirs, emptyDirCount: r.emptyDirCount,
    ignoredDirs: r.ignoredDirs.slice(0, 2000), ignoredCount: r.ignoredCount, ignore: r.ignore,
  };
}

/** Result without the file objects: the files go as columns. */
function pack(result) {
  const { files, readDirs, ...meta } = result;
  const cols = encodeFiles(files);
  return { value: { ...meta, cols }, transfer: transferList(cols) };
}

const handlers = {
  db(_id, method, args) {
    if (!db) throw new Error('catalog unavailable');
    if (!DB_METHODS.has(method)) throw new Error(`unknown catalog method ${method}`);
    return db[method](...args);
  },

  async scan(id, { root, maxDepth, ignore, record, background }) {
    const token = { cancelled: false };
    tokens.set(id, token);
    const startedAt = Date.now();
    try {
      const result = await scanFolder(root, { maxDepth, ignore, isCancelled: () => token.cancelled, onProgress: progress(id) });
      // a cancelled refresh changes nothing: the analysis on screen stays as it was
      if (background && result.cancelled) return { value: { root, cancelled: true, discarded: true } };
      let catalog = { recorded: false };
      if (record && db) {
        try {
          progress(id)({ phase: 'catalog', files: result.files.length, dirs: result.dirsRead, bytes: result.bytes });
          catalog = { recorded: true, ...db.recordScan(result, startedAt) };
          db.saveExtras(catalog.scanId, extrasOf(result));
        } catch (err) {
          catalog = { recorded: false, error: String(err?.message || err) };
        }
      }
      const packed = pack(result);
      packed.value.catalog = catalog;
      return packed;
    } finally {
      tokens.delete(id);
    }
  },

  restore(id, root) {
    if (!db) return { value: null };
    const snap = db.lastSnapshot(root, compileIgnore, progress(id));
    return snap ? pack(snap) : { value: null };
  },

  /** Duplicates by content. files: [{path,size,mtime}] already narrowed to sizes that repeat. */
  async hash(id, { files, minSize, persist, root }) {
    const token = { cancelled: false };
    tokens.set(id, token);
    try {
      const result = await findDuplicates(files, {
        minSize,
        cache: db ? { get: (f) => db.cachedHash(f.path, f.size, f.mtime) } : null,
        isCancelled: () => token.cancelled,
        onProgress: progress(id),
      });
      let persisted = 0;
      if (db && persist && result.fresh.length) {
        try { db.saveHashes(result.fresh); persisted = result.fresh.length; } catch (err) { console.error(err); }
      }
      // copies of the same content in other cataloged folders (e.g. a backup on an external drive)
      const groups = result.groups.map((g) => ({
        ...g,
        elsewhere: db ? db.otherLocations(g.hash, root).map((r) => ({ path: r.path, root: r.root, mtime: r.mtime })) : [],
      }));
      return { value: { root, groups, stats: { ...result.stats, persisted }, catalog: !!db } };
    } finally {
      tokens.delete(id);
    }
  },

  close() {
    try { db?.close(); } catch { /* already closed */ }
    db = null;
    return { value: true };
  },
};

parentPort.on('message', async (m) => {
  if (m?.type === 'cancel') { const tk = tokens.get(m.id); if (tk) tk.cancelled = true; return; }
  if (m?.type !== 'call') return;
  try {
    const fn = handlers[m.method];
    if (!fn) throw new Error(`unknown method ${m.method}`);
    const out = await fn(m.id, ...(m.args || []));
    const { value, transfer } = m.method === 'db' ? { value: out } : out;
    parentPort.postMessage({ type: 'result', id: m.id, value }, transfer || []);
  } catch (err) {
    parentPort.postMessage({ type: 'result', id: m.id, error: String(err?.message || err) });
  }
});

process.on('uncaughtException', (err) => { console.error('[data worker]', err); });
