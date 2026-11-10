/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Performance check with a large synthetic folder: how long each step takes and, above all, how long the
// window is blocked (main process event-loop stalls and renderer long tasks). Fails when a step goes over
// its budget, so the app does not silently become heavy again.
// Usage: PERF_FOLDER=<new or empty folder> PERF_OUT=<output folder> [PERF_FILES=200000] [PERF_STRICT=1] [PERF_SLACK=2]
//        electron tools/perf.js
// The files are sparse (they have a size but take almost no disk space).
const path = require('path');
const fs = require('fs');
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });
const { app, dialog, nativeTheme } = require('electron');

const folder = path.resolve(process.env.PERF_FOLDER || '');
const outDir = path.resolve(process.env.PERF_OUT || '.');
const COUNT = Number(process.env.PERF_FILES) || 200000;
if (!process.env.PERF_FOLDER) { console.error('Set PERF_FOLDER to a new or empty folder.'); process.exit(2); }

// Budgets in ms (generous: CI machines are slow). The point is catching freezes, not micro-timing.
// PERF_SLACK multiplies every budget (CI machines are slower than a desktop).
const scale = Math.max(0.5, COUNT / 1000000) * (Number(process.env.PERF_SLACK) || 1);
const BUDGET = {
  mainStall: 400 * (Number(process.env.PERF_SLACK) || 1), // longest time the main process could not answer
  longTask: 600 * scale,     // longest single block of the UI thread
  reopen: 8000 * scale,      // reopening the saved analysis, up to the data on screen
  interaction: 2000 * scale, // switching tabs, sorting, searching, zooming into a folder
};

function createFolder() {
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) {
    const marker = path.join(folder, '.lionorganizer-perf');
    if (!fs.existsSync(marker)) { console.error('PERF_FOLDER must be new or empty.'); process.exit(2); }
    if (Number(fs.readFileSync(marker, 'utf8')) === COUNT) return; // reuse the same synthetic folder
    console.error('PERF_FOLDER was made for another PERF_FILES; use a new folder.'); process.exit(2);
  }
  fs.mkdirSync(folder, { recursive: true });
  const exts = ['jpg', 'png', 'pdf', 'docx', 'dwg', 'skp', 'rvt', 'mp4', 'zip', 'js', 'json', 'txt', 'log', 'tmp', 'bak', 'psd', 'xlsx', 'exe'];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const PER_DIR = 40;
  let made = 0;
  const t0 = Date.now();
  for (let d = 0; made < COUNT; d++) {
    // folders 1–5 levels deep: a/b/c…
    const depth = 1 + (d % 5);
    const segs = [];
    let n = d;
    for (let i = 0; i < depth; i++) { segs.push(`dir${n % 37}`); n = Math.floor(n / 7) + i; }
    segs.push(`leaf${d}`);
    const dir = path.join(folder, ...segs);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < PER_DIR && made < COUNT; i++, made++) {
      const ext = exts[Math.floor(rnd() * exts.length)];
      const file = path.join(dir, `file-${made}.${ext}`);
      fs.writeFileSync(file, '');
      fs.truncateSync(file, Math.floor(rnd() ** 3 * 50e6)); // sparse: size without disk space
    }
  }
  fs.writeFileSync(path.join(folder, '.lionorganizer-perf'), String(COUNT));
  console.log(`[perf] created ${COUNT} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

createFolder();
app.commandLine.appendSwitch('lang', 'en-US');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(outDir, 'userdata-perf'));
fs.rmSync(path.join(outDir, 'userdata-perf'), { recursive: true, force: true });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
// files "deleted" by the test go to a local folder instead of the system Recycle Bin
const { shell } = require('electron');
const bin = path.join(outDir, 'perf-recycle-bin');
fs.mkdirSync(bin, { recursive: true });
shell.trashItem = async (p) => fs.renameSync(p, path.join(bin, path.basename(p) + '-' + Date.now()));
nativeTheme.themeSource = 'dark';

// main process stalls: a timer that should fire every 20 ms
let stall = 0;
let last = performance.now();
setInterval(() => { const now = performance.now(); stall = Math.max(stall, now - last - 20); last = now; }, 20).unref();
const takeStall = () => { const s = stall; stall = 0; return Math.round(s); };

require('../src/code/electron-main/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
const record = (step, ms, extra = {}) => {
  const row = { step, ms: Math.round(ms), mainStall: takeStall(), ...extra };
  results.push(row);
  console.log('[perf]', JSON.stringify(row));
};

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => {
    const level = ev.level ?? ev.params?.level;
    if (level === 'error' || level === 3) console.log('[perf] CONSOLE ERROR', ev.message ?? ev.params?.message);
    if (process.env.PERF_DEBUG && (level === 'warning' || level === 2)) console.log('[perf] debug', ev.message ?? ev.params?.message);
  });
  let loads = 0;
  win.webContents.on('did-finish-load', async () => {
    loads++;
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (cond, timeout = 600000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await js(`!!(${cond})`).catch(() => false)) return true; await wait(25); }
      return false;
    };
    // renderer long tasks (blocks of the UI thread over 50 ms)
    const watchLongTasks = () => js(`(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); })()`);
    const takeLongTasks = () => js(`(() => { const a = window.__lt || []; window.__lt = []; return { longest: Math.round(Math.max(0, ...a)), total: Math.round(a.reduce((s, x) => s + x, 0)) }; })()`);
    /** Runs an action in the page and waits until the UI has painted the result. */
    const timed = async (step, action, cond, budget) => {
      await takeLongTasks();
      takeStall();
      const t0 = Date.now();
      await js(action);
      const ok = await until(cond);
      await js('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))');
      const ms = Date.now() - t0;
      const lt = await takeLongTasks();
      record(step, ms, { longestTask: lt.longest, ok });
      if (!ok) { failures++; console.log('[perf] FAIL', step, 'did not finish'); }
      if (budget && ms > budget) { failures++; console.log(`[perf] FAIL ${step}: ${Math.round(ms)} ms > ${Math.round(budget)} ms`); }
      if (lt.longest > BUDGET.longTask) { failures++; console.log(`[perf] FAIL ${step}: UI blocked ${lt.longest} ms > ${Math.round(BUDGET.longTask)} ms`); }
      return ms;
    };
    try {
      await wait(500);
      await watchLongTasks();
      if (loads === 1) {
        await timed('scan + catalog + first screen', `document.querySelector('.welcome .btn-primary').click()`,
          `document.querySelector('.view-overview:not([hidden]) .hero') && !document.querySelector('.statusbar.busy')`);
        await timed('Files tab', `window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }))`, `document.querySelector('.view-files:not([hidden]) tbody tr')`, BUDGET.interaction);
        await timed('sort by name', `document.querySelector('.view-files th.col-name .th-button').click()`, `!document.querySelector('.toolbar-sorting')`, BUDGET.interaction);
        // the order made by the worker is right: names ascending, numbers in natural order
        const names = await js(`[...document.querySelectorAll('.view-files tbody tr .col-name .cell-text')].map((c) => c.textContent.trim())`);
        const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
        const sorted = names.length > 10 && names.every((n, i) => i === 0 || coll.compare(names[i - 1], n) <= 0);
        console.log('[perf]', sorted ? 'OK  ' : 'FAIL', 'the list is sorted by name (natural order)', names.slice(0, 3).join(' · '));
        if (!sorted) failures++;
        await js(`document.querySelector('.view-files th.col-size .th-button').click()`);
        await until(`!document.querySelector('.toolbar-sorting')`);
        await js(`window.__count = document.querySelector('.view-files .toolbar-count').textContent`);
        await timed('search', `(() => { const i = document.querySelector('.view-files .search-input'); i.value = 'file-12'; i.dispatchEvent(new Event('input')); })()`, `document.querySelector('.view-files .toolbar-count').textContent !== window.__count`, BUDGET.interaction);
        await js(`(() => { const i = document.querySelector('.view-files .search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
        await timed('Cleanup tab', `window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))`, `document.querySelector('.view-cleanup:not([hidden]) .cleanup-card')`, BUDGET.interaction);
        // deleting in a large analysis: the main process checks the file against the analysis (lazy index)
        const victim = await js(`(() => { const b = document.querySelector('.view-cleanup .cleanup-card .cleanup-preview li .cp-name'); return b ? b.getAttribute('title') || b.textContent : null; })()`);
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }))`);
        await until(`document.querySelector('.view-files:not([hidden]) tbody tr input[type=checkbox]')`);
        await js(`(() => { const c = document.querySelector('.view-files tbody tr input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
        const target = await js(`document.querySelector('.view-files tbody tr .col-name .cell-text').textContent.trim()`);
        takeStall();
        const tTrash = Date.now();
        await js(`[...document.querySelectorAll('.selection-bar .btn-danger')].pop().click()`);
        const dialog = await until(`!!document.querySelector('.cm-dialog .cm-code')`, 30000);
        await js(`(() => { const code = [...document.querySelectorAll('.cm-code span')].map((s) => s.textContent).join(''); const i = document.querySelector('.cm-input'); i.value = code; i.dispatchEvent(new Event('input')); })()`);
        await js(`document.querySelector('.cm-actions .btn:last-child').click()`);
        const gone = dialog && (await until(`!document.querySelector('.cm-dialog') && ![...document.querySelectorAll('.view-files tbody tr .col-name .cell-text')].some((c) => c.textContent.trim() === ${JSON.stringify(target)})`, 30000));
        record('delete one file (code)', Date.now() - tTrash, { ok: !!gone });
        console.log('[perf]', gone ? 'OK  ' : 'FAIL', `deleting "${target}" asks for the code and removes it from the list`, victim ? '' : '');
        if (!gone) failures++;
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))`);
        await timed('zoom into a folder', `document.querySelectorAll('.tree-row')[1].click()`, `document.querySelectorAll('.breadcrumbs .crumb').length === 2`, BUDGET.interaction);
        await timed('back to the whole folder', `document.querySelector('.breadcrumbs .crumb').click()`, `document.querySelectorAll('.breadcrumbs .crumb').length === 1`, BUDGET.interaction);
        await timed('Overview tab', `window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))`, `document.querySelector('.view-overview:not([hidden]) .hero')`, BUDGET.interaction);
        await timed('space map', `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '7', ctrlKey: true })); document.querySelector('.tmv-activate').click(); })()`,
          `document.querySelector('.view-treemap canvas').width > 300 && document.querySelector('.tmv-gate').hidden`, BUDGET.interaction * 3);
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))`);
        await wait(300);
        takeStall();
        // reopen: reload the window, the saved analysis comes back from the catalog
        win.webContents.reload();
        return;
      }
      // second load: reopening the saved analysis
      const t0 = Date.now();
      const ok = await until(`document.querySelector('.view-overview:not([hidden]) .hero') && !document.getElementById('boot')`);
      const lt = await takeLongTasks();
      const ms = Date.now() - t0;
      record('reopen saved analysis', ms, { longestTask: lt.longest, ok });
      if (!ok || ms > BUDGET.reopen) { failures++; console.log(`[perf] FAIL reopen: ${ms} ms > ${Math.round(BUDGET.reopen)} ms`); }
      const worstStall = Math.max(...results.map((r) => r.mainStall));
      console.log(`[perf] worst main-process stall: ${worstStall} ms (budget ${BUDGET.mainStall} ms)`);
      if (worstStall > BUDGET.mainStall) { failures++; console.log('[perf] FAIL main process stalled'); }
      fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify({ files: COUNT, results }, null, 2));
      const strict = process.env.PERF_STRICT === '1';
      console.log(failures ? `[perf] ${failures} over budget${strict ? '' : ' (not strict: reported only)'}` : '[perf] ALL WITHIN BUDGET');
      app.exit(strict && failures ? 1 : 0);
    } catch (err) {
      console.error('[perf] ERROR', err);
      app.exit(1);
    }
  });
});
