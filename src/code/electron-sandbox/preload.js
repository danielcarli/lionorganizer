/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Secure bridge between the UI (no Node access) and the main process.
// Runs sandboxed: exposes only these functions, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, p) => cb(p);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  platform: process.platform,
  pathSep: process.platform === 'win32' ? '\\' : '/',
  setTheme: (dark) => ipcRenderer.send('window:setTheme', !!dark),
  setLocale: (locale) => ipcRenderer.send('nls:setLocale', locale),
  appInfo: () => ipcRenderer.invoke('app:info'),

  // folder and scan
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  saveCsv: (name, content) => ipcRenderer.invoke('dialog:saveCsv', name, content),
  startScan: (root, depth, record) => ipcRenderer.invoke('scan:start', root, depth, !!record),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: on('scan:progress'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),

  // duplicates by hash
  findDuplicates: (opts) => ipcRenderer.invoke('hash:find', opts),
  cancelDuplicates: () => ipcRenderer.invoke('hash:cancel'),
  onHashProgress: on('hash:progress'),

  // catalog
  catalog: {
    status: () => ipcRenderer.invoke('catalog:status'),
    stats: () => ipcRenderer.invoke('catalog:stats'),
    search: (opts) => ipcRenderer.invoke('catalog:search', opts),
    history: (root) => ipcRenderer.invoke('catalog:history', root),
    compare: (scanId) => ipcRenderer.invoke('catalog:compare', scanId),
    operations: () => ipcRenderer.invoke('catalog:operations'),
    exportCsv: () => ipcRenderer.invoke('catalog:exportCsv'),
    revealDb: () => ipcRenderer.invoke('catalog:revealDb'),
  },

  // operations with a confirmation code (Recycle Bin, organize, rename, undo, clear catalog)
  ops: {
    prepare: (kind, payload) => ipcRenderer.invoke('ops:prepare', kind, payload),
    commit: (id, code) => ipcRenderer.invoke('ops:commit', id, code),
    cancel: (id) => ipcRenderer.invoke('ops:cancel', id),
  },
});
