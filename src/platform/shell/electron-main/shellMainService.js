/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// System integration: show in Explorer, and check which files no longer exist.
// Only accepts paths inside the analyzed folder or recorded in the catalog.
// (Deletions go through OperationsMainService, which requires the confirmation code.)
const { shell, clipboard } = require('electron');
const fs = require('fs');

const MAX_CHECK = 5000;
/** True only when the file or one of its folders is really gone (not for "access denied"). */
async function isGone(p) {
  try { await fs.promises.lstat(p); return false; } catch (err) { return err.code === 'ENOENT' || err.code === 'ENOTDIR'; }
}

class ShellMainService {
  constructor(scan, catalog) {
    this.scan = scan;
    this.catalog = catalog;
  }

  registerChannels(ipc) {
    ipc.handle('shell:reveal', (e, p) => this.reveal(p));
    ipc.handle('shell:missing', (e, paths) => this.missing(paths));
    ipc.handle('shell:copyText', async (e, text) => {
      if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) return false;
      await clipboard.writeText(text); // asynchronous in recent Electron versions
      return true;
    });
  }

  #allowed(p) {
    if (typeof p !== 'string') return false;
    if (p === this.scan.currentRoot || this.scan.isInsideRoot(p)) return true;
    return this.catalog.available && this.catalog.db.hasPath(p);
  }

  /** @returns {Promise<'ok'|'missing'|'failed'>} */
  async reveal(p) {
    if (!this.#allowed(p)) return 'failed';
    const st = await fs.promises.stat(p).catch(() => null);
    if (!st) return (await isGone(p)) ? 'missing' : 'failed';
    if (st.isDirectory()) {
      const err = await shell.openPath(p); // opens the folder itself
      return err === '' ? 'ok' : 'failed';
    }
    shell.showItemInFolder(p); // opens the containing folder with the file selected
    return 'ok';
  }

  /** Which of these paths no longer exist (deleted, moved, or their folder is gone). */
  async missing(paths) {
    if (!Array.isArray(paths)) return [];
    const list = [...new Set(paths)].slice(0, MAX_CHECK).filter((p) => this.#allowed(p));
    const gone = await Promise.all(list.map((p) => isGone(p)));
    return list.filter((_, i) => gone[i]);
  }
}

module.exports = { ShellMainService };
