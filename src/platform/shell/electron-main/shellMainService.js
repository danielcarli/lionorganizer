/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// System integration: show in Explorer.
// Only accepts paths inside the analyzed folder or recorded in the catalog.
// (Deletions go through OperationsMainService, which requires the confirmation code.)
const { shell } = require('electron');
const fs = require('fs');

class ShellMainService {
  constructor(scan, catalog) {
    this.scan = scan;
    this.catalog = catalog;
  }

  registerChannels(ipc) {
    ipc.handle('shell:reveal', (e, p) => this.reveal(p));
  }

  #allowed(p) {
    if (typeof p !== 'string') return false;
    if (p === this.scan.currentRoot || this.scan.isInsideRoot(p)) return true;
    return this.catalog.available && this.catalog.db.hasPath(p);
  }

  async reveal(p) {
    if (!this.#allowed(p)) return false;
    const st = await fs.promises.stat(p).catch(() => null);
    if (!st) return false;
    if (st.isDirectory()) {
      const err = await shell.openPath(p); // opens the folder itself
      return err === '';
    }
    shell.showItemInFolder(p); // opens the containing folder with the file selected
    return true;
  }
}

module.exports = { ShellMainService };
