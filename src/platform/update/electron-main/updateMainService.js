/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// New versions: the only network access of the app.
//  - check(): reads manifest.txt of the latest GitHub release (the same small file the installers use) and
//    compares its version with this one. Nothing about the user or their files is sent.
//  - install(): hands the update over to the installer the app was installed with. The installers verify
//    every download (SHA-256, Electron's checksums).
//  - when a new version is found and the app was installed with the setup wizard, the release's wizard
//    (LionOrganizer-Setup.exe, about 2 MB) is fetched in the background if it differs from the copy kept
//    for updates, and only kept if its SHA-256 matches the release's SHA256SUMS - the same check the
//    installers make. That copy cannot replace itself, so without this every update would run the first
//    installer ever downloaded. Nothing else downloaded is ever run.
// The renderer only asks "check" or "install": URLs, paths and commands are fixed here.
const { app, net, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'danielcarli/lionorganizer';
const RELEASES = `https://github.com/${REPO}/releases`;
const LATEST_PAGE = `${RELEASES}/latest`;
const MANIFEST = `${RELEASES}/latest/download/manifest.txt`;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
const TIMEOUT_MS = 15000;
const QUIT_AFTER_SPAWN_MS = 100;
const SETUP_NAME = 'LionOrganizer-Setup.exe';
const SETUP_MAX_BYTES = 64 * 1024 * 1024;

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The SHA-256 published for one file in a SHA256SUMS text ("<hash>  <name>"), or ''. */
function publishedSum(sums, name) {
  for (const line of sums.split(/\r?\n/)) {
    const [hash, file] = line.trim().split(/\s+/, 2);
    if (file && file.replace(/^\*/, '') === name && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
  }
  return '';
}

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

/**
 * The setup kept for updates cannot replace itself while it runs. During an update it downloads the
 * release's setup (verified against SHA256SUMS) next to itself as LionOrganizer-Setup.new.exe; here,
 * while nothing runs it, that one takes its place. Returns the setup to start.
 */
function useNewestSetup(setup) {
  const next = setup.replace(/\.exe$/i, '.new.exe');
  if (!isFile(next)) return setup;
  const old = setup.replace(/\.exe$/i, '.old.exe');
  try {
    fs.rmSync(old, { force: true });
    if (isFile(setup)) fs.renameSync(setup, old);
  } catch { return next; }
  try { fs.renameSync(next, setup); } catch {
    try { fs.renameSync(old, setup); } catch { /* the new one is started instead */ }
    return next;
  }
  fs.rm(old, { force: true }, () => {});
  return setup;
}

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
      const available = compareVersions(latest, this.version) > 0;
      if (available && base.method === 'installer') this.prefetchSetup(latest).catch(() => { /* the kept copy is used */ });
      return { ...base, ok: true, latest, available };
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

  /** Network GET with the usual timeout and a size limit. */
  async #get(url, maxBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 4);
    try {
      const res = await net.fetch(url, { signal: controller.signal, headers: { 'User-Agent': `LionOrganizer/${this.version}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Number(res.headers.get('content-length') || 0) > maxBytes) throw new Error('too large');
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) throw new Error('too large');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches the release's setup next to the kept copy (as LionOrganizer-Setup.new.exe, see useNewestSetup)
   * when the copy is not that one. Runs in the background after a check, so the click on "Update now" never
   * waits for it; kept only if it matches the SHA-256 published with the release.
   */
  async prefetchSetup(latest) {
    if (this.prefetching || !VERSION_RE.test(latest)) return;
    const m = this.method();
    if (m.kind !== 'installer') return;
    this.prefetching = true;
    try {
      const sums = (await this.#get(`${RELEASES}/download/v${latest}/SHA256SUMS`, 64 * 1024)).toString('utf8');
      const expected = publishedSum(sums, SETUP_NAME);
      if (!expected) return;
      const next = m.file.replace(/\.exe$/i, '.new.exe');
      if (sha256(m.file) === expected) { fs.rmSync(next, { force: true }); return; } // already the latest
      if (isFile(next) && sha256(next) === expected) return;
      const data = await this.#get(`${RELEASES}/download/v${latest}/${SETUP_NAME}`, SETUP_MAX_BYTES);
      if (crypto.createHash('sha256').update(data).digest('hex') !== expected) throw new Error('checksum mismatch');
      const part = `${next}.part`;
      fs.writeFileSync(part, data);
      fs.renameSync(part, next);
    } finally {
      this.prefetching = false;
    }
  }

  async install() {
    const m = this.method();
    if (m.kind === 'download') {
      await shell.openExternal(LATEST_PAGE);
      return { ok: true, action: 'download' };
    }
    const [cmd, args] = m.kind === 'installer'
      ? [useNewestSetup(m.file), ['/UPDATE']]
      : [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', m.file, '-Yes']];
    // Waits only for the installer process to exist ('spawn'), not for a fixed time, then quits at once
    // (the installer replaces the app's files, so nothing may stay in use). If it cannot start, the app
    // stays open and says why.
    const started = await new Promise((resolve) => {
      let child;
      try { child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }); } catch (err) { resolve(String(err.message || err)); return; }
      child.once('spawn', () => { child.unref(); resolve(''); });
      child.once('error', (err) => resolve(String(err.message || err)));
    });
    if (started) return { ok: false, error: started };
    setTimeout(() => app.quit(), QUIT_AFTER_SPAWN_MS); // just enough for this answer to reach the window
    return { ok: true, action: m.kind };
  }
}

module.exports = { UpdateMainService, compareVersions, useNewestSetup, publishedSum };
