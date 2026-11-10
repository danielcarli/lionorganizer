/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Catalog service in the main process: opens the database in userData and serves the UI.
const { app, shell, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { t, getLocale } = require('../../nls/common/nls');

const DB_FILE = 'catalog.sqlite';
const LEGACY_DB_FILE = 'catalogo.sqlite'; // name used by earlier versions
const DB_SIDECARS = ['-wal', '-shm'];

/**
 * Renames the legacy database (and its WAL/SHM files) to the new name so existing users keep
 * their data. Returns the path to open; falls back to the legacy file if the rename fails.
 */
function resolveDatabaseFile(dir) {
  const file = path.join(dir, DB_FILE);
  const legacy = path.join(dir, LEGACY_DB_FILE);
  if (fs.existsSync(file) || !fs.existsSync(legacy)) return file;
  const done = [];
  try {
    // Sidecars first, so the main file is only renamed once its journal is in place.
    for (const suffix of DB_SIDECARS) {
      if (fs.existsSync(legacy + suffix) && !fs.existsSync(file + suffix)) {
        fs.renameSync(legacy + suffix, file + suffix);
        done.push(suffix);
      }
    }
    fs.renameSync(legacy, file);
    return file;
  } catch (err) {
    console.error('Could not rename the legacy catalog file:', err);
    for (const suffix of done) {
      try { fs.renameSync(file + suffix, legacy + suffix); } catch { /* leave it as is */ }
    }
    return legacy;
  }
}

class CatalogMainService {
  constructor() {
    this.db = null;
    this.error = null;
    try {
      const { CatalogDatabase } = require('../node/catalogDatabase');
      this.db = new CatalogDatabase(resolveDatabaseFile(app.getPath('userData')));
    } catch (err) {
      this.error = String(err?.message || err);
      console.error('Catalog unavailable:', err);
    }
  }

  get available() { return !!this.db; }

  registerChannels(ipc) {
    const guard = (fn) => (...args) => {
      if (!this.db) throw new Error(t('main.catalog.errors.unavailable', { reason: this.error || t('main.catalog.errors.unknown') }));
      return fn(...args);
    };
    ipc.handle('catalog:status', () => ({ available: this.available, error: this.error }));
    ipc.handle('catalog:stats', guard(() => this.db.stats()));
    ipc.handle('catalog:search', guard((_e, opts) => this.db.search(sanitizeSearch(opts))));
    ipc.handle('catalog:history', guard((_e, root) => this.db.history(String(root))));
    ipc.handle('catalog:compare', guard((_e, scanId) => this.db.compare(Number(scanId))));
    ipc.handle('catalog:operations', guard(() => this.db.recentOperations(30)));
    ipc.handle('catalog:revealDb', guard(() => { shell.showItemInFolder(this.db.file); return true; }));
    ipc.handle('catalog:exportCsv', guard((e) => this.exportCsv(BrowserWindow.fromWebContents(e.sender))));
  }

  async exportCsv(win) {
    const res = await dialog.showSaveDialog(win, {
      title: t('main.catalog.export.title'),
      defaultPath: `lionorganizer-catalog-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: t('main.dialog.filters.csv'), extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const locale = getLocale();
    const present = t('main.catalog.csv.statusPresent');
    const missing = t('main.catalog.csv.statusMissing');
    const header = ['root', 'path', 'name', 'ext', 'size', 'modified', 'status', 'hash'].map((k) => t('main.catalog.csv.' + k));
    const lines = [header.map(esc).join(';')];
    for (const r of this.db.allFilesForExport()) {
      lines.push([r.root, r.path, r.name, r.ext, r.size, new Date(r.mtime).toLocaleString(locale), r.missing ? missing : present, r.hash || ''].map(esc).join(';'));
    }
    // BOM so Excel detects the UTF-8 encoding.
    await fs.promises.writeFile(res.filePath, '﻿' + lines.join('\r\n'), 'utf8');
    return res.filePath;
  }
}

function sanitizeSearch(o = {}) {
  return {
    query: typeof o.query === 'string' ? o.query.slice(0, 200) : '',
    ext: typeof o.ext === 'string' ? o.ext.slice(0, 20) : '',
    minSize: Number(o.minSize) > 0 ? Number(o.minSize) : 0,
    includeMissing: o.includeMissing !== false,
    limit: Math.min(500, Math.max(1, Number(o.limit) || 200)),
  };
}

module.exports = { CatalogMainService };
