/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Test tool: opens the app, analyzes a folder and saves screenshots.
// Usage: SHOT_FOLDER=<folder> SHOT_OUT=<output> SHOT_THEME=light|dark electron tools/screenshot.js
const path = require('path');
const { app, dialog, BrowserWindow, nativeTheme } = require('electron');

// Parameters via environment variables: SHOT_FOLDER, SHOT_OUT, SHOT_THEME
const folder = process.env.SHOT_FOLDER;
const outDir = process.env.SHOT_OUT;
const theme = process.env.SHOT_THEME || 'light';
app.disableHardwareAcceleration();
console.log('screenshot tool', folder, outDir, theme);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.resolve(folder)] });
nativeTheme.themeSource = theme;

require('../src/code/electron-main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, ...args) => {
    const msg = typeof args[0] === 'object' ? args[0].message : args[1];
    console.log('[renderer]', msg);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const js = (code) => win.webContents.executeJavaScript(code);
      const shot = async (name) => {
        await wait(500);
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(path.join(outDir, `${name}-${theme}.png`), img.toPNG());
      };
      win.setSize(1440, 960);
      await wait(800);
      await js(`document.querySelectorAll('.theme-option')[${theme === 'dark' ? 2 : 1}].click()`);
      await shot('0-welcome');
      await js(`document.querySelector('.welcome .btn-primary').click()`);
      for (let i = 0; i < 50; i++) { await wait(200); if (await js(`!!document.querySelector('.view-overview:not([hidden])')`)) break; }
      await shot('1-overview');
      await js(`document.querySelector('.view-overview').scrollTop = 900`);
      await shot('2-overview-scrolled');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }))`);
      await shot('3-files');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))`);
      await shot('4-cleanup');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))`);
      await js(`document.querySelectorAll('.theme-option')[${theme === 'dark' ? 1 : 2}].click()`);
      await shot('5-theme-switched');
    } catch (err) {
      console.error(err);
    }
    app.exit(0);
  });
});
