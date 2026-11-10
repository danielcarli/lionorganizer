/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Generates the README screenshots from a realistic demo folder. Never deletes anything:
// the confirmation dialog is opened and then cancelled.
// Usage:
//   DOCS_FOLDER=<new or empty folder, e.g. C:\temp\Student Drive> DOCS_OUT=docs/screenshots [DOCS_LANG=en] [DOCS_THEME=light|dark] \
//   [DOCS_MODE=full|overview] electron tools/docs-screenshots.js
//   full     → overview, files, cleanup, duplicates, confirmation, organize, catalog
//   overview → only the overview, saved as overview-<lang>.png (used for the language gallery)
const path = require('path');
const fs = require('fs');
// Fail fast instead of showing an error dialog that would block a headless run.
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });
const { app, dialog, nativeTheme } = require('electron');
const { createDemoFolder } = require('./fixtures');

const folder = path.resolve(process.env.DOCS_FOLDER || '');
const outDir = path.resolve(process.env.DOCS_OUT || 'docs/screenshots');
const lang = process.env.DOCS_LANG || 'en';
const theme = process.env.DOCS_THEME || 'light';
const mode = process.env.DOCS_MODE || 'full';
if (!process.env.DOCS_FOLDER) { console.error('Set DOCS_FOLDER to a new or empty folder.'); process.exit(2); }
createDemoFolder(folder);
fs.mkdirSync(outDir, { recursive: true });

app.commandLine.appendSwitch('lang', lang);
app.disableHardwareAcceleration();
app.setPath('userData', path.join(folder + '-userdata'));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
nativeTheme.themeSource = theme;

require('../src/code/electron-main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (cond, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(150); } return false; };
    const key = (k) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true }))`);
    const click = (sel, text) => js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; el?.click(); return !!el; })()`);
    const shot = async (name) => {
      // park the pointer in a corner so no chart is captured in its hover state
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 895 });
      await wait(600);
      fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      console.log('[docs] saved', name);
    };
    try {
      win.setSize(1440, 900);
      await wait(700);
      await js(`document.querySelectorAll('.theme-option')[${theme === 'dark' ? 2 : 1}].click()`);
      await click('.welcome .btn-primary');
      await until(`!!document.querySelector('.view-overview:not([hidden]) .hero')`);
      // let the analysis settle, then record a second scan so the catalog has history
      if (mode === 'full') {
        fs.writeFileSync(path.join(folder, 'Documents', 'thesis-final.pdf'), Buffer.alloc(2 * 1024 * 1024, 7));
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }))`);
        await wait(1500);
        await until(`!!document.querySelector('.view-overview:not([hidden]) .hero')`);
      }
      await js(`document.querySelectorAll('.toast').forEach((t) => t.remove())`);
      await shot(mode === 'overview' ? `overview-${lang}` : `overview-${theme}`);
      if (mode !== 'full') { app.exit(0); return; }

      // Files: sorted by size, a few rows selected
      await key('2');
      await wait(300);
      await js(`[...document.querySelectorAll('tbody input[type=checkbox]')].slice(1, 4).forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); })`);
      await shot('files');
      await js(`(() => { const c = document.querySelector('thead input[type=checkbox]'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);

      // Cleanup
      await key('3');
      await shot('cleanup');

      // Duplicates (content check) and the typed confirmation code (cancelled)
      await key('4');
      await click('.dup-controls .btn-primary');
      await until(`!!document.querySelector('.dup-groups')`, 60000);
      await shot('duplicates');
      await click('.dup-actions-card .btn-danger');
      await until(`!!document.querySelector('.cm-dialog')`);
      await js(`(() => { const code = [...document.querySelectorAll('.cm-code span')].map((s) => s.textContent).join(''); const i = document.querySelector('.cm-input'); i.value = code.slice(0, 4); i.dispatchEvent(new Event('input')); })()`);
      await shot('confirmation');
      await click('.cm-actions .btn:first-child'); // Cancel
      await wait(300);

      // Organize: the messy folder + a batch rename preview of the sketches
      await key('2');
      await js(`(() => { const i = document.querySelector('.search-input'); i.value = 'sketch'; i.dispatchEvent(new Event('input')); })()`);
      await wait(500);
      await js(`(() => { const c = document.querySelector('thead input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
      await click('.tree-row .tree-label', 'Desktop dump');
      await key('5');
      await wait(300);
      await js(`(() => { const i = document.querySelector('.rn-form .text-input.mono'); i.value = '{date}-{n}-{name}'; i.dispatchEvent(new Event('input')); })()`);
      await wait(400);
      await shot('organize');

      // Catalog: search + history
      await click('.crumb');
      await key('6');
      await until(`!!document.querySelector('.cat-results tbody tr')`);
      await js(`(() => { const i = document.querySelector('.cat-section .search-input'); i.value = 'render'; i.dispatchEvent(new Event('input')); })()`);
      await wait(800);
      await shot('catalog');
    } catch (err) {
      console.error('[docs] error', err);
      app.exit(1);
      return;
    }
    app.exit(0);
  });
});
