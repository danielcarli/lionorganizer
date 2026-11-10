/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Main process entry point (equivalent to VS Code's src/vs/code/electron-main).
// Creates the window, registers the app:// protocol that serves the UI and instantiates the services.
const { app, BrowserWindow, protocol, nativeTheme, ipcMain } = require('electron');

app.setName('LionOrganizer');
if (process.platform === 'win32') app.setAppUserModelId('br.dmdc.lionorganizer');
const path = require('path');
const fs = require('fs');

const { DialogMainService } = require('../../platform/dialogs/electron-main/dialogMainService');
const { CatalogMainService } = require('../../platform/catalog/electron-main/catalogMainService');
const { HashMainService } = require('../../platform/catalog/electron-main/hashMainService');
const { ScanMainService } = require('../../platform/files/electron-main/scanMainService');
const { ShellMainService } = require('../../platform/shell/electron-main/shellMainService');
const { OperationsMainService } = require('../../platform/operations/electron-main/operationsMainService');
const { UpdateMainService } = require('../../platform/update/electron-main/updateMainService');
const { setLocale } = require('../../platform/nls/common/nls');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEME = 'app';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ');

// Only files inside these folders may be served to the UI.
const SERVABLE = [path.join(APP_ROOT, 'src')];

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const filePath = path.normalize(path.join(APP_ROOT, decodeURIComponent(url.pathname)));
    if (!SERVABLE.some((dir) => filePath.startsWith(dir + path.sep))) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'content-security-policy': CSP,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const TITLEBAR_HEIGHT = 36;
function overlayColors(dark) {
  return dark
    ? { color: '#141113', symbolColor: '#c9bfb4', height: TITLEBAR_HEIGHT }
    : { color: '#f4f0e9', symbolColor: '#5a524c', height: TITLEBAR_HEIGHT };
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'LionOrganizer',
    icon: path.join(APP_ROOT, 'src', 'workbench', 'browser', 'media', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1619' : '#fbf8f3',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 12, y: 11 } } : { titleBarOverlay: overlayColors(nativeTheme.shouldUseDarkColors) }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron-sandbox', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links never open inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://bundle/src/workbench/browser/workbench.html`);
  return win;
}

app.whenReady().then(() => {
  // OS locale until the UI reports the language it is using.
  setLocale(app.getLocale());
  ipcMain.on('nls:setLocale', (_e, locale) => setLocale(String(locale)));
  // Read the version from package.json so it is right however the app is launched (e.g. by the test tools).
  ipcMain.handle('app:info', () => ({ version: require(path.join(APP_ROOT, 'package.json')).version, electron: process.versions.electron }));
  registerAppProtocol();

  // "--scan=<folder>": analyze this folder at startup (used when reopening as administrator on Windows).
  let initialScan = null;
  const scanArg = process.argv.find((a) => a.startsWith('--scan='));
  if (scanArg) {
    const folder = path.resolve(scanArg.slice('--scan='.length));
    try { if (fs.statSync(folder).isDirectory()) initialScan = folder; } catch { /* not a folder: ignored */ }
  }
  ipcMain.handle('app:takeInitialScan', () => { const f = initialScan; initialScan = null; return f; });

  const dialogs = new DialogMainService();
  const catalog = new CatalogMainService();
  const scan = new ScanMainService(catalog);
  const hash = new HashMainService(scan, catalog);
  const shell = new ShellMainService(scan, catalog);
  const operations = new OperationsMainService(scan, catalog);
  const update = new UpdateMainService(APP_ROOT);
  [dialogs, catalog, scan, hash, shell, operations, update].forEach((s) => s.registerChannels(ipcMain));
  app.on('will-quit', () => catalog.db?.close());

  // Reload asked by the UI (e.g. after changing the language). Done here because the window blocks every
  // navigation started by the page (will-navigate), and recent Electron versions treat location.reload() as one.
  ipcMain.on('window:reload', (event) => event.sender.reload());

  // The UI reports the chosen theme (light/dark) so the window buttons match.
  ipcMain.on('window:setTheme', (event, dark) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && process.platform !== 'darwin') {
      try { win.setTitleBarOverlay(overlayColors(!!dark)); } catch { /* platform without overlay */ }
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
