/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Duplicate detection by content (SHA-256). Only runs when the UI asks for it.
const { findDuplicates } = require('../node/duplicateFinder');
const { t } = require('../../nls/common/nls');

class HashMainService {
  constructor(scan, catalog) {
    this.scan = scan;
    this.catalog = catalog;
    this.token = null;
  }

  registerChannels(ipc) {
    ipc.handle('hash:find', (e, opts) => this.find(e.sender, opts || {}));
    ipc.handle('hash:cancel', () => { if (this.token) this.token.cancelled = true; return true; });
  }

  async find(sender, { minSize = 1, persist = true }) {
    if (!this.scan.currentRoot) throw new Error(t('main.hash.errors.noScan'));
    if (this.token) this.token.cancelled = true;
    const token = { cancelled: false };
    this.token = token;

    const db = this.catalog.available ? this.catalog.db : null;
    const files = [...this.scan.files.values()];
    const result = await findDuplicates(files, {
      minSize: Math.max(1, Number(minSize) || 1),
      cache: db ? { get: (f) => db.cachedHash(f.path, f.size, f.mtime) } : null,
      isCancelled: () => token.cancelled,
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('hash:progress', p); },
    });
    if (this.token === token) this.token = null;

    let persisted = 0;
    if (db && persist && result.fresh.length) {
      try { db.saveHashes(result.fresh); persisted = result.fresh.length; } catch (err) { console.error(err); }
    }

    // Copies of the same content in other cataloged folders (e.g. a backup on an external drive)
    const root = this.scan.currentRoot;
    const groups = result.groups.map((g) => ({
      ...g,
      elsewhere: db ? db.otherLocations(g.hash, root).map((r) => ({ path: r.path, root: r.root, mtime: r.mtime })) : [],
    }));
    return { root, groups, stats: { ...result.stats, persisted }, catalog: !!db };
  }
}

module.exports = { HashMainService };
