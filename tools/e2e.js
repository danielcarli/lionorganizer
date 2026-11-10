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
const http = require('http');
const { app, dialog, nativeTheme, shell, clipboard } = require('electron');
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
// Links opened in the browser are recorded instead.
const opened = [];
shell.openExternal = async (url) => { opened.push(url); };

// A local "latest release" for the update check (the app reads manifest.txt from it).
const APP_VERSION = require('../package.json').version;
let publishedVersion = '9.9.9';
const releases = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`name=LionOrganizer\nversion=${publishedVersion}\n`); });
releases.listen(0, '127.0.0.1', () => {
  process.env.LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS = '1';
  process.env.LIONORGANIZER_UPDATE_URL = `http://127.0.0.1:${releases.address().port}/manifest.txt`;
});

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
      const version = require('../package.json').version;
      check(/Daniel Michelon De Carli/.test(about) && /LionOrganizer Team/.test(about) && about.includes(version), `About shows the creator, the team and version ${version}`);
      await shot('05-about');
      await click('.about-dialog .btn-primary');

      // ---- version indicator (bottom-right corner) and update dialog
      check(await until(`!!document.querySelector('.status-version.update-available')`, 20000), 'the version indicator shows that a new version is available');
      check(await js(`document.querySelector('.status-version').textContent.includes('9.9.9') && !!document.querySelector('.status-right-wrap > .status-version:last-child')`), 'it shows the new version, in the bottom-right corner');
      await click('.status-version');
      check(await until(`!!document.querySelector('.update-dialog')`), 'clicking it opens the update dialog');
      const upd = await js(`document.querySelector('.update-dialog').textContent`);
      check(upd.includes('9.9.9') && upd.includes(APP_VERSION) && upd.includes('Do you want to update now?'), 'it shows both versions and asks whether to update');
      await shot('06-update');
      await click('.update-dialog .cm-actions .btn-primary');
      check(await until(`!document.querySelector('.update-dialog')`), 'confirming closes the dialog');
      check(opened.includes('https://github.com/danielcarli/lionorganizer/releases/latest'), 'running from source, the update opens the download page');
      publishedVersion = APP_VERSION;
      await click('.status-version');
      await until(`!!document.querySelector('.update-dialog')`);
      await click('.update-dialog .cm-actions .btn', 'Check again');
      check(await until(`document.querySelector('.update-dialog')?.textContent.includes('up to date')`), 'after a new check it says the app is up to date');
      check(await js(`!document.querySelector('.status-version.update-available') && document.querySelector('.status-version').textContent.includes('v' + ${JSON.stringify(APP_VERSION)})`), 'the indicator shows the current version again');
      await click('.update-dialog .cm-actions .btn-primary');

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

      // ---- export for AI analysis (in the UI language), with the confirmed duplicates
      await key('3');
      await wait(400);
      await click('.ai-report-button');
      check(await until(`!!document.querySelector('.ai-report-dialog')`), 'the "Export for AI" dialog opens');
      await shot('13-ai-report');
      await clipboard.writeText('');
      await click('.ai-report-dialog .cm-actions .btn-primary');
      check(await until(`!document.querySelector('.ai-report-dialog')`), 'copying closes the dialog');
      const report = await clipboard.readText(); // asynchronous in recent Electron versions
      check(report.startsWith('# LionOrganizer report') && report.includes('## Instructions for the AI') && report.includes('Answer in English'), 'the report has the instructions for the AI, in the UI language');
      check(report.includes('## Exact duplicates (confirmed by SHA-256)') && report.includes('suggested to keep') && report.includes('render-facade.png'), 'it lists the confirmed duplicates and the files');
      check(!report.includes(folder), 'it has no absolute paths (only paths relative to the analyzed folder)');
      check(await until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Report copied'))`), 'a notice confirms the copy');
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

      // ---- files deleted outside the app (a file, and a whole folder): gray, notice, remove from list
      await key('1');
      await wait(600);
      fs.unlinkSync(path.join(folder, 'Video', 'walkthrough.mp4'));
      fs.rmSync(path.join(folder, 'Test'), { recursive: true }); // its folder is gone: same-edges-A.bin and -B.bin
      await js(`window.dispatchEvent(new Event('focus'))`); // back to the window → files on screen are checked again
      check(await until(`document.querySelectorAll('.file-item.is-missing').length === 3`), 'the 3 files deleted outside the app (one by one and with their folder) are shown in gray');
      check(await js(`[...document.querySelectorAll('.file-item.is-missing .missing-badge')].every((b) => b.textContent.includes('Not found'))`), 'they are marked "Not found"');
      check(await until(`[...document.querySelectorAll('.toast-warning')].some((x) => /3 files were not found/.test(x.textContent) && /Remove from list/.test(x.textContent))`), 'a notice explains it and offers "Remove from list"');
      check(await js(`document.querySelectorAll('.file-item.is-missing .icon-button.danger').length === 0`), 'no Recycle Bin button for files that no longer exist');
      await shot('50-missing');
      await key('2');
      await wait(500);
      check(await js(`[...document.querySelectorAll('tr.is-missing')].some((r) => r.textContent.includes('walkthrough.mp4')) && document.querySelector('tr.is-missing input[type=checkbox]').disabled`), 'Files view: gray row, cannot be selected');
      await key('1');
      await wait(400);
      await click('.file-item.is-missing .missing-remove');
      check(await until(`document.querySelectorAll('.file-item.is-missing').length === 2`), '"Remove from list" removes one file from the interface');
      check(exists('Theater/Renders/render-facade.png') && exists('Theater/Plans/ground-floor.dwg'), 'removing from the list did not touch any file on disk');

      // a file deleted outside the app, then sent to the Recycle Bin: no confirmation code, just gray
      fs.unlinkSync(path.join(folder, 'Theater', 'Plans', 'section.dwg'));
      await key('2');
      await wait(400);
      await js(`(() => { const i = document.querySelector('.search-input'); i.value = 'section'; i.dispatchEvent(new Event('input')); })()`);
      await wait(500);
      await click('tr[data-path$="section.dwg"] .icon-button.danger');
      await wait(1000);
      check(await js(`!document.querySelector('.cm-dialog')`), 'no confirmation code asked for a file that no longer exists');
      check(await until(`!!document.querySelector('tr.is-missing[data-path$="section.dwg"]')`), 'the file is shown in gray instead');
      await js(`(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
      await click('.toast-warning .btn', 'Remove from list');
      check(await until(`document.querySelectorAll('tr.is-missing').length === 0`), 'the notice\'s "Remove from list" removes all missing files');

      // ---- changing the language in the status bar reloads the UI in the new language
      await js(`(() => { const s = document.querySelector('.status-select'); s.value = 'pt-BR'; s.dispatchEvent(new Event('change')); })()`);
      check(await until(`document.documentElement.lang === 'pt-BR' && document.body.textContent.includes('Visão geral')`, 20000), 'switching the language in the status bar reloads the UI in Portuguese');
    } catch (err) {
      failures++;
      log('ERROR', err.stack || err);
    }
    log(failures ? `${failures} FAILURE(S)` : 'ALL GOOD');
    app.exit(failures ? 1 : 0);
  });
});
