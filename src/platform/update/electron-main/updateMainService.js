/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// New versions: the only network access of the app.
//  - check(): reads manifest.txt of the latest GitHub release (the same small file the installers use) and
//    compares its version with this one. Nothing about the user or their files is sent.
//  - install(): hands the update over to the installer the app was installed with. The installers verify
//    every download (SHA-256, Electron's checksums); the app never runs anything downloaded by itself.
// The renderer only asks "check" or "install": URLs, paths and commands are fixed here.
const { app, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'danielcarli/lionorganizer';
const RELEASES = `https://github.com/${REPO}/releases`;
const LATEST_PAGE = `${RELEASES}/latest`;
const MANIFEST = `${RELEASES}/latest/download/manifest.txt`;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
const TIMEOUT_MS = 15000;

/** Semantic version comparison: 1.0.10 > 1.0.9, and 1.1.0 > 1.1.0-beta.1. */
function compareVersions(a, b) {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;  // a release is newer than its pre-releases
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

class UpdateMainService {
  constructor(appRoot) {
    this.version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
  }

  registerChannels(ipc) {
    ipc.handle('update:check', () => this.check());
    ipc.handle('update:install', () => this.install());
    ipc.handle('update:openReleasePage', () => shell.openExternal(LATEST_PAGE).then(() => true, () => false));
  }

  /** Tests may point the check to a local server; never in normal use. */
  get manifestUrl() {
    const url = process.env.LIONORGANIZER_UPDATE_URL;
    if (url && process.env.LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) return url;
    return MANIFEST;
  }

  async check() {
    const base = { current: this.version, method: this.method().kind, checkedAt: Date.now() };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await net.fetch(this.manifestUrl, { signal: controller.signal, headers: { 'User-Agent': `LionOrganizer/${this.version}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).slice(0, 4096);
      const latest = /^version=(.+)$/m.exec(text)?.[1].trim();
      if (!latest || !VERSION_RE.test(latest)) throw new Error('unexpected manifest');
      return { ...base, ok: true, latest, available: compareVersions(latest, this.version) > 0 };
    } catch (err) {
      return { ...base, ok: false, error: err.name === 'AbortError' ? 'timeout' : String(err.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * How this copy can be updated:
   *  - 'installer': installed with LionOrganizer-Setup.exe (Windows): its copy runs again in update mode;
   *  - 'script': installed with install.ps1 for the current user (Windows): the copy kept next to the app;
   *  - 'download': anything else (macOS, Linux packages, AppImage, running from source): the download page.
   */
  method() {
    if (process.platform === 'win32' && app.isPackaged) {
      const exeDir = path.dirname(process.execPath);
      const local = process.env.LOCALAPPDATA || '';
      const setup = path.join(local, 'LionOrganizer-Installer', 'LionOrganizer-Setup.exe');
      const inUserPrograms = local && exeDir.toLowerCase() === path.join(local, 'Programs', 'LionOrganizer').toLowerCase();
      if (inUserPrograms && isFile(setup) && isFile(path.join(exeDir, 'unins000.exe'))) return { kind: 'installer', file: setup };
      const script = path.join(exeDir, 'install.ps1');
      let scope = '';
      try { scope = /^scope=(\w+)/m.exec(fs.readFileSync(path.join(exeDir, 'lionorganizer-install.txt'), 'utf8'))?.[1] || ''; } catch { /* no marker */ }
      if (isFile(script) && scope === 'User') return { kind: 'script', file: script };
    }
    return { kind: 'download' };
  }

  async install() {
    const m = this.method();
    if (m.kind === 'download') {
      await shell.openExternal(LATEST_PAGE);
      return { ok: true, action: 'download' };
    }
    const [cmd, args] = m.kind === 'installer'
      ? [m.file, ['/UPDATE']]
      : [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', m.file, '-Yes']];
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => { /* reported below if it fails right away */ });
      child.unref();
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    // The installer replaces the app's files: quit so nothing is in use.
    setTimeout(() => app.quit(), 600);
    return { ok: true, action: m.kind };
  }
}

module.exports = { UpdateMainService, compareVersions };
