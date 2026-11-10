/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Duplicate detection by content (SHA-256). Only runs when the UI asks for it, in the background worker
// (it reads the files and the cached hashes there); the main process only picks the candidates.
const { t } = require('../../nls/common/nls');

class HashMainService {
  constructor(scan, catalog) {
    this.scan = scan;
    this.catalog = catalog;
    this.callId = null;
  }

  registerChannels(ipc) {
    ipc.handle('hash:find', (e, opts) => this.find(e.sender, opts || {}));
    ipc.handle('hash:cancel', () => { if (this.callId) this.catalog.worker.cancel(this.callId); return true; });
  }

  async find(sender, { minSize = 1, persist = true }) {
    if (!this.scan.currentRoot) throw new Error(t('main.hash.errors.noScan'));
    if (this.callId) this.catalog.worker.cancel(this.callId);
    await this.catalog.ready;
    const min = Math.max(1, Number(minSize) || 1);
    const files = this.scan.hashCandidates(min);
    let id = null;
    const res = await this.catalog.worker.call('hash', [{ files, minSize: min, persist: persist !== false, root: this.scan.currentRoot }], {
      onId: (i) => { id = i; this.callId = i; },
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('hash:progress', p); },
    });
    if (this.callId === id) this.callId = null;
    return res;
  }
}

module.exports = { HashMainService };
