/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// End-to-end test: launches the app, analyzes a freshly created folder and exercises duplicates,
// deletion, organize, rename, undo and the catalog, checking the results on disk.
// Usage: E2E_FOLDER=<new or empty folder> E2E_OUT=<output folder> [E2E_THEME=light|dark] [E2E_LANG=en] electron tools/e2e.js
// The UI runs in English by default so the assertions are stable.
const path = require('path');
const fs = require('fs');
// Fail fast instead of showing an error dialog that would block a headless run.
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });
const { app, dialog, nativeTheme, shell } = require('electron');
const { createTestFolder } = require('./fixtures');

const folder = path.resolve(process.env.E2E_FOLDER || '');
const outDir = path.resolve(process.env.E2E_OUT || '.');
const theme = process.env.E2E_THEME || 'light';
if (!process.env.E2E_FOLDER) { console.error('Set E2E_FOLDER to a new or empty folder.'); process.exit(2); }
createTestFolder(folder); // refuses non-empty folders, so real data is never touched

app.commandLine.appendSwitch('lang', process.env.E2E_LANG || 'en-US');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(outDir, 'userdata-' + theme));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
nativeTheme.themeSource = theme;
// The system Recycle Bin may not exist in CI: simulate it by moving files to a local folder.
const trashDir = path.join(outDir, 'recycle-bin-' + theme);
fs.mkdirSync(trashDir, { recursive: true });
shell.trashItem = async (p) => fs.renameSync(p, path.join(trashDir, path.basename(p) + '-' + Date.now()));

require('../src/code/electron-main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);
let failures = 0;
const check = (ok, msg) => { if (ok) log('OK  ', msg); else { failures++; log('FAIL', msg); } };
const exists = (rel) => fs.existsSync(path.join(folder, rel));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => {
    const level = ev.level ?? ev.params?.level;
    const msg = ev.message ?? ev.params?.message;
    if (level === 'error' || level === 3) { failures++; log('CONSOLE ERROR', msg); }
  });
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => {
      await wait(450);
      fs.writeFileSync(path.join(outDir, `${name}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const key = (k) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true }))`);
    const click = (sel, text) => js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return false; el.click(); return true; })()`);
    const until = async (cond, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(150); } return false; };
    const confirmWithCode = async (shotName) => {
      check(await until(`!!document.querySelector('.cm-dialog')`), 'confirmation dialog opened');
      if (shotName) await shot(shotName);
      check(await js(`document.querySelector('.cm-actions .btn:last-child').disabled`), 'confirm button starts disabled');
      await js(`(() => { const i = document.querySelector('.cm-input'); i.value = 'XXXXXX'; i.dispatchEvent(new Event('input')); })()`);
      check(await js(`document.querySelector('.cm-actions .btn:last-child').disabled`), 'a wrong code keeps it disabled');
      await js(`(() => { const code = [...document.querySelectorAll('.cm-code span')].map((s) => s.textContent).join(''); const i = document.querySelector('.cm-input'); i.value = code.toLowerCase(); i.dispatchEvent(new Event('input')); })()`);
      check(!(await js(`document.querySelector('.cm-actions .btn:last-child').disabled`)), 'the right code (lower case) unlocks it');
      await click('.cm-actions .btn:last-child');
      check(await until(`!document.querySelector('.cm-dialog')`), 'operation finished and the dialog closed');
      await wait(400);
    };
    try {
      win.setSize(1440, 960);
      await wait(600);
      // theme switch: [auto, light, dark]
      await js(`document.querySelectorAll('.theme-option')[${theme === 'dark' ? 2 : 1}].click()`);
      check(await js(`document.documentElement.lang`) === (process.env.E2E_LANG || 'en'), 'UI language');

      // ---- About dialog: credits and license
      await click('.activity-bottom .activity-item:last-child');
      check(await until(`!!document.querySelector('.about-dialog')`), 'About dialog opened');
      const about = await js(`document.querySelector('.about-dialog').textContent`);
      check(/Daniel Michelon De Carli/.test(about) && /LionOrganizer Team/.test(about) && /1\.0\.0/.test(about), 'About shows the creator, the team and version 1.0.0');
      await shot('05-about');
      await click('.about-dialog .btn-primary');

      // ---- the main process rejects a wrong code (independent of the UI)
      await click('.welcome .btn-primary');
      check(await until(`!!document.querySelector('.view-overview:not([hidden])')`), 'analysis finished');
      const srv = await js(`(async () => {
        const files = await window.host.catalog.search({ query: 'song' });
        const v = await window.host.ops.prepare('trash', { paths: [files.rows[0].path] });
        const bad = await window.host.ops.commit(v.id, 'AAAAAA');
        await window.host.ops.cancel(v.id);
        const gone = await window.host.ops.commit(v.id, v.code);
        return { bad, gone };
      })()`);
      check(srv.bad.ok === false && !!srv.bad.error, 'main process rejects a wrong code');
      check(srv.gone.ok === false, 'a cancelled confirmation cannot be reused');
      check(exists('Loose/song.mp3'), 'file untouched after invalid attempts');
      const outside = await js(`window.host.ops.prepare('trash', { paths: [${JSON.stringify(path.join(outDir, 'nope.txt'))}] }).then(() => 'accepted', () => 'rejected')`);
      check(outside === 'rejected', 'deleting outside the analyzed folder is rejected');

      // ---- duplicates
      await key('4');
      await shot('10-duplicates-before');
      await click('.dup-controls .btn-primary');
      check(await until(`!!document.querySelector('.dup-groups')`, 20000), 'duplicate check finished');
      const groups = await js(`document.querySelectorAll('.dup-group').length`);
      check(groups === 3, `3 groups of identical copies (found ${groups})`);
      await shot('11-duplicates');
      await click('.dup-actions-card .btn-danger');
      await confirmWithCode('12-confirmation-code');
      check(exists('Theater/Renders/render-facade.png') && !exists('Downloads/render-facade.png') && !exists('Theater/Renders/render-facade (1).png'), 'kept the oldest copy and deleted the extras');
      check(exists('Theater/Plans/section.dwg'), 'same size but different content was not touched');

      // ---- organize by type (folder "Loose")
      await click('.tree-row .tree-label', 'Loose');
      await key('5');
      await wait(300);
      await shot('20-organize');
      await click('.org-card .org-foot .btn-primary');
      await confirmWithCode();
      check(exists('Loose/Images/photo-01.jpg') && exists('Loose/Documents/report.docx') && exists('Loose/CAD and 3D/model.skp'), 'files moved into subfolders by type');

      // ---- batch rename: select the photos in the Files view
      await key('2');
      await js(`(() => { const i = document.querySelector('.search-input'); i.value = 'photo-0'; i.dispatchEvent(new Event('input')); })()`);
      await wait(500);
      await js(`(() => { const c = document.querySelector('thead input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
      await key('5');
      await wait(300);
      await js(`(() => { const i = document.querySelector('.rn-form .text-input.mono'); i.value = 'theater-{n}'; i.dispatchEvent(new Event('input')); })()`);
      await wait(400);
      await shot('21-rename');
      await click('.rn-preview .org-foot .btn-primary');
      await confirmWithCode();
      check(exists('Loose/Images/theater-01.jpg') && !exists('Loose/Images/photo-01.jpg'), 'files renamed with the pattern');

      // ---- catalog + undo the rename
      await key('6');
      await until(`!!document.querySelector('.op-row .btn')`);
      await wait(600);
      await shot('30-catalog');
      await click('.op-row .btn');
      await confirmWithCode();
      check(exists('Loose/Images/photo-01.jpg') && !exists('Loose/Images/theater-01.jpg'), 'undo restored the original names');
      await js(`(() => { const i = document.querySelector('.cat-section .search-input'); i.value = 'floor'; i.dispatchEvent(new Event('input')); })()`);
      await wait(600);
      const found = await js(`document.querySelectorAll('.cat-results tbody tr').length`);
      check(found >= 2, `catalog search found ${found} "floor" files`);

      // ---- second analysis: history records the changes
      fs.writeFileSync(path.join(folder, 'Documents', 'new-report.pdf'), Buffer.alloc(300000, 1));
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }))`);
      await wait(1500);
      await key('6');
      await until(`!!document.querySelector('.cmp-chips')`);
      await wait(500);
      const newCount = await js(`document.querySelector('.cmp-chip.new strong')?.textContent`);
      check(newCount === '1', `history shows 1 new file (showed ${newCount})`);
      const removedCount = await js(`document.querySelector('.cmp-chip.removed strong')?.textContent`);
      check(removedCount === '4', `history counts the 4 deleted copies as removed (showed ${removedCount})`);
      await shot('32-history');

      await key('3');
      await wait(400);
      await shot('40-cleanup');
    } catch (err) {
      failures++;
      log('ERROR', err.stack || err);
    }
    log(failures ? `${failures} FAILURE(S)` : 'ALL GOOD');
    app.exit(failures ? 1 : 0);
  });
});
