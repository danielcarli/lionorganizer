/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// LionOrganizer's own catalog: a SQLite database (node:sqlite, built into Electron).
// Stores the name, size, date and hash of every analyzed file, the scan history,
// the changes between scans, per-folder totals and the operation log (for undo).
const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  first_scan_at INTEGER,
  last_scan_at INTEGER
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  max_depth INTEGER,            -- NULL = no limit
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS scans_root ON scans(root_id, id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  root_id INTEGER REFERENCES roots(id) ON DELETE SET NULL,
  folder TEXT NOT NULL,         -- folder relative to the root of the last scan
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  first_seen_scan INTEGER,
  last_seen_scan INTEGER,
  missing INTEGER NOT NULL DEFAULT 0,  -- 0 present · 1 missing · 2 deleted by the app (the next scan counts it as removed)
  hash TEXT,                    -- SHA-256 of the content (valid for hash_size/hash_mtime)
  hash_size INTEGER,
  hash_mtime INTEGER,
  hashed_at INTEGER
);
CREATE INDEX IF NOT EXISTS files_name ON files(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS files_hash ON files(hash);
CREATE INDEX IF NOT EXISTS files_root ON files(root_id);

CREATE TABLE IF NOT EXISTS scan_changes (
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,           -- new | removed | grew | shrank
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  prev_size INTEGER
);
CREATE INDEX IF NOT EXISTS changes_scan ON scan_changes(scan_id, kind);

CREATE TABLE IF NOT EXISTS scan_folders (
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,           -- top-level subfolder ('' = loose files in the root)
  bytes INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_scan ON scan_folders(scan_id);

-- what a scan found besides the files (errors, empty and ignored folders…), to reopen it as it was
CREATE TABLE IF NOT EXISTS scan_extras (
  scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  data TEXT NOT NULL            -- JSON
);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,           -- trash | organize | rename | undo
  created_at INTEGER NOT NULL,
  root TEXT,
  summary TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  undoable INTEGER NOT NULL DEFAULT 0,
  undone_at INTEGER
);
CREATE TABLE IF NOT EXISTS operation_items (
  op_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  src TEXT NOT NULL,
  dst TEXT,
  created_dir INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS op_items ON operation_items(op_id);
`;

/** LIKE prefix with % and _ escaped */
function likePrefix(dir) {
  const withSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return withSep.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

class CatalogDatabase {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
    this.#prepare();
  }

  #prepare() {
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      rootByPath: p('SELECT * FROM roots WHERE path = ?'),
      insertRoot: p('INSERT INTO roots(path, first_scan_at, last_scan_at) VALUES (?, ?, ?)'),
      touchRoot: p('UPDATE roots SET last_scan_at = ? WHERE id = ?'),
      lastScan: p('SELECT * FROM scans WHERE root_id = ? ORDER BY id DESC LIMIT 1'),
      insertScan: p('INSERT INTO scans(root_id, started_at, finished_at, max_depth, file_count, total_bytes, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      filesUnder: p("SELECT id, path, folder, size, mtime, missing FROM files WHERE path LIKE ? ESCAPE '\\'"),
      insertFile: p('INSERT INTO files(path, root_id, folder, name, ext, size, mtime, first_seen_scan, last_seen_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      updateFile: p('UPDATE files SET root_id = ?, folder = ?, size = ?, mtime = ?, last_seen_scan = ?, missing = 0 WHERE id = ?'),
      markMissing: p('UPDATE files SET missing = 1 WHERE id = ?'),
      insertChange: p('INSERT INTO scan_changes(scan_id, kind, path, size, prev_size) VALUES (?, ?, ?, ?, ?)'),
      insertFolder: p('INSERT INTO scan_folders(scan_id, name, bytes, count) VALUES (?, ?, ?, ?)'),
      hashFor: p('SELECT hash FROM files WHERE path = ? AND hash IS NOT NULL AND hash_size = ? AND hash_mtime = ?'),
      setHash: p('UPDATE files SET hash = ?, hash_size = ?, hash_mtime = ?, hashed_at = ? WHERE path = ?'),
      otherLocations: p('SELECT f.path, f.size, f.mtime, r.path AS root FROM files f LEFT JOIN roots r ON r.id = f.root_id WHERE f.hash = ? AND f.missing = 0 LIMIT 12'),
      hasPath: p('SELECT 1 FROM files WHERE path = ?'),
      movePath: p('UPDATE files SET path = ?, folder = ?, name = ?, ext = ? WHERE path = ?'),
      deletePath: p('DELETE FROM files WHERE path = ?'),
      setMissingByPath: p('UPDATE files SET missing = 2 WHERE path = ?'),
      insertOp: p('INSERT INTO operations(kind, created_at, root, summary, item_count, bytes, undoable) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      insertOpItem: p('INSERT INTO operation_items(op_id, src, dst, created_dir) VALUES (?, ?, ?, ?)'),
      opById: p('SELECT * FROM operations WHERE id = ?'),
      opItems: p('SELECT src, dst, created_dir FROM operation_items WHERE op_id = ?'),
      markUndone: p('UPDATE operations SET undone_at = ? WHERE id = ?'),
      saveExtras: p('INSERT OR REPLACE INTO scan_extras(scan_id, data) VALUES (?, ?)'),
      extrasOf: p('SELECT data FROM scan_extras WHERE scan_id = ?'),
      snapshotFiles: p("SELECT path, name, ext, size, mtime FROM files WHERE path LIKE ? ESCAPE '\\' AND missing = 0 AND last_seen_scan >= ?"),
    };
  }

  #tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ------------------------------------------------------------------ scans
  /**
   * Records a scan: updates files, detects new/removed/changed ones
   * and stores totals per top-level subfolder.
   */
  recordScan(result, startedAt) {
    const now = Date.now();
    const root = result.root;
    return this.#tx(() => {
      let rootRow = this.q.rootByPath.get(root);
      if (!rootRow) {
        const r = this.q.insertRoot.run(root, now, now);
        rootRow = { id: Number(r.lastInsertRowid) };
      } else {
        this.q.touchRoot.run(now, rootRow.id);
      }
      const prev = this.q.lastScan.get(rootRow.id) || null;
      const scanRes = this.q.insertScan.run(rootRow.id, startedAt, now, result.maxDepth ?? null,
        result.files.length, result.bytes, result.cancelled ? 1 : 0);
      const scanId = Number(scanRes.lastInsertRowid);
      const track = !!prev; // on the first scan we don't list everything as "new"

      const existing = new Map();
      for (const row of this.q.filesUnder.all(likePrefix(root))) existing.set(row.path, row);
      const counts = { new: 0, removed: 0, grew: 0, shrank: 0 };

      for (const f of result.files) {
        const mtime = Math.round(f.mtime);
        const row = existing.get(f.path);
        if (!row) {
          this.q.insertFile.run(f.path, rootRow.id, f.folder, f.name, f.ext, f.size, mtime, scanId, scanId);
          if (track) { this.q.insertChange.run(scanId, 'new', f.path, f.size, null); counts.new++; }
          continue;
        }
        existing.delete(f.path);
        this.q.updateFile.run(rootRow.id, f.folder, f.size, mtime, scanId, row.id);
        if (!track) continue;
        if (row.missing) { this.q.insertChange.run(scanId, 'new', f.path, f.size, null); counts.new++; }
        else if (f.size > row.size) { this.q.insertChange.run(scanId, 'grew', f.path, f.size, row.size); counts.grew++; }
        else if (f.size < row.size) { this.q.insertChange.run(scanId, 'shrank', f.path, f.size, row.size); counts.shrank++; }
      }

      // Removed: only in folders actually read in this scan (respects the depth limit).
      if (!result.cancelled) {
        const read = new Set(result.readDirs || []);
        for (const row of existing.values()) {
          if (row.missing === 1) continue;
          const rel = path.relative(root, path.dirname(row.path));
          if (!read.has(rel)) continue;
          this.q.markMissing.run(row.id);
          if (track) { this.q.insertChange.run(scanId, 'removed', row.path, row.size, null); counts.removed++; }
        }
      }

      // Totals per top-level subfolder
      const totals = new Map();
      for (const f of result.files) {
        const top = f.folder ? f.folder.split(/[\\/]/)[0] : '';
        const t = totals.get(top) || { bytes: 0, count: 0 };
        t.bytes += f.size; t.count++;
        totals.set(top, t);
      }
      for (const [name, t] of totals) this.q.insertFolder.run(scanId, name, t.bytes, t.count);

      return { scanId, previousScanId: prev ? prev.id : null, changes: counts };
    });
  }

  saveExtras(scanId, extras) {
    this.q.saveExtras.run(scanId, JSON.stringify(extras));
  }

  /**
   * The last analysis of a folder, rebuilt from the catalog: the files it saw that are still present
   * (files seen again by later scans of a subfolder count too), within its depth limit and ignore list.
   * @param {string} root
   * @param {(patterns: string[]) => ((rel: string, name: string) => boolean) | null} compileIgnore
   * @param {(p: { phase: 'restore', done: number, total: number }) => void} [onProgress]
   */
  lastSnapshot(root, compileIgnore, onProgress) {
    const rootRow = this.q.rootByPath.get(root);
    if (!rootRow) return null;
    const scan = this.q.lastScan.get(rootRow.id);
    if (!scan) return null;
    let extras = {};
    try { extras = JSON.parse(this.q.extrasOf.get(scan.id)?.data || '{}'); } catch { extras = {}; }
    const isIgnored = compileIgnore ? compileIgnore(extras.ignore || []) : null;
    const maxDepth = scan.max_depth;
    const files = [];
    let bytes = 0;
    const total = scan.file_count || 0;
    let done = 0;
    let lastReport = Date.now();
    const rows = typeof this.q.snapshotFiles.iterate === 'function'
      ? this.q.snapshotFiles.iterate(likePrefix(root), scan.id)
      : this.q.snapshotFiles.all(likePrefix(root), scan.id);
    for (const row of rows) {
      if (onProgress && (++done & 4095) === 0 && Date.now() - lastReport > 100) {
        lastReport = Date.now();
        onProgress({ phase: 'restore', done, total });
      }
      const folder = path.relative(root, path.dirname(row.path));
      if (folder.startsWith('..') || path.isAbsolute(folder)) continue;
      const segs = folder ? folder.split(path.sep) : [];
      if (maxDepth !== null && segs.length > maxDepth) continue;
      if (isIgnored && segs.some((name, i) => isIgnored(segs.slice(0, i + 1).join(path.sep), name))) continue;
      files.push({ path: row.path, name: row.name, ext: row.ext, size: row.size, mtime: row.mtime, folder, depth: segs.length });
      bytes += row.size;
    }
    return {
      root,
      maxDepth,
      files,
      bytes,
      dirsRead: extras.dirsRead ?? 0,
      durationMs: extras.durationMs ?? scan.finished_at - scan.started_at,
      errors: extras.errors || [],
      errorCount: extras.errorCount ?? (extras.errors || []).length,
      skippedDirs: extras.skippedDirs || [],
      skippedCount: extras.skippedCount ?? (extras.skippedDirs || []).length,
      emptyDirs: extras.emptyDirs || [],
      emptyDirCount: extras.emptyDirCount ?? (extras.emptyDirs || []).length,
      ignoredDirs: extras.ignoredDirs || [],
      ignoredCount: extras.ignoredCount ?? 0,
      ignore: extras.ignore || [],
      cancelled: !!scan.cancelled,
      restored: { scanId: scan.id, at: scan.finished_at },
      catalog: { recorded: true, scanId: scan.id },
    };
  }

  history(root, limit = 30) {
    const rootRow = this.q.rootByPath.get(root);
    if (!rootRow) return { root, scans: [] };
    const scans = this.db.prepare(`
      SELECT s.*,
        (SELECT count(*) FROM scan_changes c WHERE c.scan_id = s.id AND c.kind = 'new') AS new_count,
        (SELECT count(*) FROM scan_changes c WHERE c.scan_id = s.id AND c.kind = 'removed') AS removed_count,
        (SELECT count(*) FROM scan_changes c WHERE c.scan_id = s.id AND c.kind IN ('grew','shrank')) AS changed_count
      FROM scans s WHERE s.root_id = ? ORDER BY s.id DESC LIMIT ?`).all(rootRow.id, limit);
    return { root, firstScanAt: rootRow.first_scan_at, scans };
  }

  /** Changes in a scan compared with the previous scan of the same folder. */
  compare(scanId, limit = 12) {
    const scan = this.db.prepare('SELECT * FROM scans WHERE id = ?').get(scanId);
    if (!scan) return null;
    const prev = this.db.prepare('SELECT * FROM scans WHERE root_id = ? AND id < ? ORDER BY id DESC LIMIT 1').get(scan.root_id, scanId) || null;
    const summary = this.db.prepare(`SELECT kind, count(*) AS count, sum(size) AS bytes, sum(coalesce(prev_size, 0)) AS prev_bytes
      FROM scan_changes WHERE scan_id = ? GROUP BY kind`).all(scanId);
    const top = (kind, order) => this.db.prepare(`SELECT path, size, prev_size FROM scan_changes WHERE scan_id = ? AND kind = ? ORDER BY ${order} DESC LIMIT ?`).all(scanId, kind, limit);
    const folders = (id) => (id ? this.db.prepare('SELECT name, bytes, count FROM scan_folders WHERE scan_id = ?').all(id) : []);
    const now = new Map(folders(scanId).map((f) => [f.name, f]));
    const before = new Map(folders(prev?.id).map((f) => [f.name, f]));
    const folderDelta = [...new Set([...now.keys(), ...before.keys()])].map((name) => ({
      name,
      bytes: now.get(name)?.bytes ?? 0,
      prevBytes: before.get(name)?.bytes ?? 0,
    })).map((f) => ({ ...f, delta: f.bytes - f.prevBytes })).filter((f) => f.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
    return {
      scan, prev, summary,
      newFiles: top('new', 'size'),
      removedFiles: top('removed', 'size'),
      grewFiles: top('grew', 'size - prev_size'),
      folderDelta,
    };
  }

  // ------------------------------------------------------------------ search and statistics
  stats() {
    const one = (sql) => this.db.prepare(sql).get();
    const roots = this.db.prepare(`SELECT r.path, r.last_scan_at,
      (SELECT count(*) FROM files f WHERE f.root_id = r.id AND f.missing = 0) AS files,
      (SELECT coalesce(sum(size), 0) FROM files f WHERE f.root_id = r.id AND f.missing = 0) AS bytes,
      (SELECT count(*) FROM scans s WHERE s.root_id = r.id) AS scans
      FROM roots r ORDER BY r.last_scan_at DESC`).all();
    let dbBytes = 0;
    for (const suffix of ['', '-wal']) {
      try { dbBytes += fs.statSync(this.file + suffix).size; } catch { /* no file */ }
    }
    return {
      file: this.file,
      dbBytes,
      files: one('SELECT count(*) AS n FROM files WHERE missing = 0').n,
      missing: one('SELECT count(*) AS n FROM files WHERE missing <> 0').n,
      hashed: one('SELECT count(*) AS n FROM files WHERE hash IS NOT NULL').n,
      scans: one('SELECT count(*) AS n FROM scans').n,
      roots,
    };
  }

  search({ query = '', ext = '', minSize = 0, includeMissing = true, limit = 200 } = {}) {
    const q = String(query).trim();
    const where = [];
    const args = [];
    if (q) {
      for (const term of q.split(/\s+/).slice(0, 5)) {
        where.push("(f.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\')");
        const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
        args.push(like, like);
      }
    }
    if (ext) { where.push('f.ext = ?'); args.push(String(ext).toLowerCase().replace(/^\./, '')); }
    if (minSize > 0) { where.push('f.size >= ?'); args.push(Math.floor(minSize)); }
    if (!includeMissing) where.push('f.missing = 0');
    const sql = `SELECT f.path, f.name, f.ext, f.size, f.mtime, f.missing, f.hash, r.path AS root
      FROM files f LEFT JOIN roots r ON r.id = f.root_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY f.size DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, Math.min(1000, Math.max(1, limit)));
    const total = this.db.prepare(`SELECT count(*) AS n, coalesce(sum(f.size),0) AS bytes FROM files f ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args);
    return { rows, total: total.n, totalBytes: total.bytes };
  }

  allFilesForExport() {
    return this.db.prepare(`SELECT f.path, f.name, f.ext, f.size, f.mtime, f.missing, f.hash, r.path AS root
      FROM files f LEFT JOIN roots r ON r.id = f.root_id ORDER BY r.path, f.path`).all();
  }

  hasPath(p) { return !!this.q.hasPath.get(p); }

  // ------------------------------------------------------------------ hashes
  cachedHash(p, size, mtime) {
    return this.q.hashFor.get(p, size, Math.round(mtime))?.hash || null;
  }

  saveHashes(entries) {
    const now = Date.now();
    this.#tx(() => { for (const e of entries) this.q.setHash.run(e.hash, e.size, Math.round(e.mtime), now, e.path); });
  }

  otherLocations(hash, excludeRoot) {
    return this.q.otherLocations.all(hash).filter((r) => !excludeRoot || !isInside(excludeRoot, r.path));
  }

  // ------------------------------------------------------------------ operations
  applyMoves(moves, root) {
    this.#tx(() => {
      for (const m of moves) {
        const name = path.basename(m.dst);
        const dot = name.lastIndexOf('.');
        const folder = root ? path.relative(root, path.dirname(m.dst)) : path.dirname(m.dst);
        this.q.deletePath.run(m.dst); // stale record with the same path (rare)
        this.q.movePath.run(m.dst, folder, name, dot > 0 ? name.slice(dot + 1).toLowerCase() : '', m.src);
      }
    });
  }

  markTrashed(paths) {
    this.#tx(() => { for (const p of paths) this.q.setMissingByPath.run(p); });
  }

  logOperation({ kind, root, summary, bytes = 0, items = [], undoable = false }) {
    return this.#tx(() => {
      const r = this.q.insertOp.run(kind, Date.now(), root || null, summary, items.length, bytes, undoable ? 1 : 0);
      const id = Number(r.lastInsertRowid);
      for (const it of items) this.q.insertOpItem.run(id, it.src, it.dst ?? null, it.createdDir ? 1 : 0);
      return id;
    });
  }

  operation(id) {
    const op = this.q.opById.get(id);
    if (!op) return null;
    return { ...op, items: this.q.opItems.all(id) };
  }

  markUndone(id) { this.q.markUndone.run(Date.now(), id); }

  recentOperations(limit = 20) {
    return this.db.prepare('SELECT * FROM operations ORDER BY id DESC LIMIT ?').all(limit);
  }

  clear() {
    this.#tx(() => {
      for (const t of ['operation_items', 'operations', 'scan_extras', 'scan_changes', 'scan_folders', 'files', 'scans', 'roots']) this.db.exec(`DELETE FROM ${t}`);
    });
    this.db.exec('VACUUM');
  }

  close() { try { this.db.close(); } catch { /* already closed */ } }
}

function isInside(root, p) {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { CatalogDatabase, isInside };
