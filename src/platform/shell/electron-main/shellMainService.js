/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// System integration: show in Explorer, check which files no longer exist, clipboard, and the ways to read
// protected folders (run as administrator on Windows, Full Disk Access on macOS).
// Only accepts paths inside the analyzed folder or recorded in the catalog.
// (Deletions go through OperationsMainService, which requires the confirmation code.)
const { app, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
    ipc.handle('shell:readText', async () => String((await clipboard.readText()) || '').slice(0, 5 * 1024 * 1024));
    ipc.handle('shell:relaunchAsAdmin', (e, folder) => this.relaunchAsAdmin(folder));
    ipc.handle('shell:openPrivacySettings', () => this.openPrivacySettings());
  }

  /**
   * Windows: opens LionOrganizer again as administrator (the system asks for permission, UAC) to analyze
   * the same folder, then closes this window. Nothing happens if the person says no.
   */
  async relaunchAsAdmin(folder) {
    if (process.platform !== 'win32' || typeof folder !== 'string') return { ok: false };
    folder = path.resolve(folder);
    const st = await fs.promises.stat(folder).catch(() => null);
    if (!st?.isDirectory()) return { ok: false };
    // Windows argument quoting: a backslash right before the closing quote must be doubled ("C:\\").
    const quote = (a) => `"${a.replace(/"/g, '').replace(/\\+$/, (m) => m + m)}"`;
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), `--scan=${folder}`].map(quote).join(' ');
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // Only one LionOrganizer runs at a time: let go of that, or the new window would close at once.
    app.releaseSingleInstanceLock();
    // The paths go through environment variables, never inside the command text.
    const code = await new Promise((resolve) => {
      const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:LO_EXE -ArgumentList $env:LO_ARGS -Verb RunAs -ErrorAction Stop'], {
        env: { ...process.env, LO_EXE: process.execPath, LO_ARGS: args }, windowsHide: true, stdio: 'ignore',
      });
      child.on('error', () => resolve(-1));
      child.on('exit', (c) => resolve(c));
    });
    if (code !== 0) {
      app.requestSingleInstanceLock(); // still the only one
      return { ok: false, declined: true };
    }
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  }

  /** macOS: opens Privacy & Security → Full Disk Access, where the person can allow LionOrganizer. */
  async openPrivacySettings() {
    if (process.platform !== 'darwin') return false;
    return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles').then(() => true, () => false);
  }

  async #allowed(p) {
    if (typeof p !== 'string') return false;
    if (p === this.scan.currentRoot || this.scan.isInsideRoot(p)) return true;
    return this.catalog.available && !!(await this.catalog.db.hasPath(p).catch(() => false));
  }

  /** @returns {Promise<'ok'|'missing'|'failed'>} */
  async reveal(p) {
    if (!(await this.#allowed(p))) return 'failed';
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
    const candidates = [...new Set(paths)].slice(0, MAX_CHECK);
    const ok = await Promise.all(candidates.map((p) => this.#allowed(p)));
    const list = candidates.filter((_, i) => ok[i]);
    const gone = await Promise.all(list.map((p) => isGone(p)));
    return list.filter((_, i) => gone[i]);
  }
}

module.exports = { ShellMainService };
