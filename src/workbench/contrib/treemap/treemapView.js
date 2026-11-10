/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Space map (WinDirStat style): every file is a block whose area is its size, nested inside its folders and
// colored by type. Click a block to zoom into its folder, go up with the button, Backspace or a right-click.
// It is heavy for big analyses, so nothing is computed until the person turns it on (each session): the
// index it needs is then built in small slices, without freezing the window, with a progress bar.
// Drawn on a canvas, so it stays fast with hundreds of thousands of files.
import { ViewPane } from '../../browser/viewPane.js';
import { h, setChildren, cssVar } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes, formatDate, formatNumber, splitRel, baseName } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { CATEGORIES, CATEGORY_BY_ID } from '../../services/analysis/common/fileCategories.js';
import { categoryColor } from '../../browser/chartTheme.js';

const MIN_AREA = 3;        // px²: smaller blocks are merged into one "N smaller files" block
const HEADER = 15;         // px: folder name strip, when the folder is big enough
const MAX_LEVELS = 14;

export class TreemapView extends ViewPane {
  constructor(services) {
    super(services, 'treemap');
    this.canvas = h('canvas.tmv-canvas', { role: 'img' });
    this.tooltip = h('div.chart-tooltip.tmv-tooltip', { hidden: true });
    this.stage = h('div.tmv-stage', this.canvas, this.tooltip);
    this.toolbar = h('div.tmv-toolbar');
    this.legend = h('div.tmv-legend');
    this.gate = h('div.tmv-gate');
    this.element.append(this.gate, this.toolbar, this.stage, this.legend);
    this.blocks = [];
    this.hover = null;
    /** off: not turned on in this session · building: index in progress · ready: drawn */
    this.state = 'off';
    this.progress = { done: 0, total: 0, phase: 'group' };

    // new data: the index is rebuilt (only if the map is on, and only once it is visible)
    this.analysis.onDidChangeData(() => {
      this.#cancelBuild();
      this.#index = null;
      if (this.state !== 'off') this.state = 'stale';
      this.invalidate();
    });
    this.analysis.onDidChangeFilter(() => { if (this.lastFolder !== this.analysis.filter.folder) this.invalidate(); });
    this.layout.onDidChangeTheme(() => this.invalidate());
    new ResizeObserver(() => { if (this.visible && this.state === 'ready') this.#draw(); }).observe(this.stage);
    document.addEventListener('fullscreenchange', () => { if (this.visible) this.render(); });

    this.canvas.addEventListener('pointermove', (e) => this.#onMove(e));
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.tooltip.hidden = true; this.#paint(); });
    this.canvas.addEventListener('click', (e) => this.#onClick(e));
    this.canvas.addEventListener('dblclick', (e) => this.#onDoubleClick(e));
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.#up(); });
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.defaultPrevented || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      if (document.querySelector('.cm-overlay')) return;
      if (e.key === 'Backspace' && this.state === 'ready') { e.preventDefault(); this.#up(); }
    });
  }

  #index = null;    // relative folder path → { files: sorted by size (largest first), dirs: sorted subfolders }
  #buildToken = null;

  #cancelBuild() {
    if (this.#buildToken) this.#buildToken.cancelled = true;
    this.#buildToken = null;
  }

  /** Turns the map on for this session and builds its index in the background. */
  activate() {
    if (!this.analysis.hasData) return;
    this.state = 'stale';
    this.render();
  }

  /**
   * Groups the files by folder and sorts every folder's files and subfolders by size, a slice at a time
   * (about 12 ms of work, then the window gets the turn back), reporting progress. Cancellable.
   */
  async #build() {
    this.#cancelBuild();
    const token = (this.#buildToken = { cancelled: false });
    const files = this.analysis.files;
    const folders = new Map();
    const total = files.length;
    this.state = 'building';
    this.progress = { done: 0, total, phase: 'group' };
    this.#renderProgress();
    const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
    let t0 = performance.now();
    const slice = async (done, phase, count) => {
      if (performance.now() - t0 < 12) return true;
      this.progress = { done, total: count, phase };
      this.#renderProgress();
      await yieldNow();
      t0 = performance.now();
      return !token.cancelled;
    };
    // 1) files by folder
    for (let i = 0; i < total; i++) {
      const f = files[i];
      let entry = folders.get(f.folder);
      if (!entry) folders.set(f.folder, (entry = { files: [], dirs: null }));
      if (f.size > 0) entry.files.push(f);
      if ((i & 1023) === 0 && !(await slice(i, 'group', total))) return;
    }
    // 2) every folder sorted, largest first (subfolders come from the analysis tree)
    const nodes = [];
    const walk = (node) => { nodes.push(node); for (const c of node.children.values()) walk(c); };
    walk(this.analysis.tree);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      let entry = folders.get(node.rel);
      if (!entry) folders.set(node.rel, (entry = { files: [], dirs: null }));
      entry.files.sort((a, b) => b.size - a.size);
      entry.dirs = [...node.children.values()].filter((c) => c.size > 0).sort((a, b) => b.size - a.size);
      if ((i & 255) === 0 && !(await slice(i, 'sort', nodes.length))) return;
    }
    if (token.cancelled) return;
    this.#buildToken = null;
    this.#index = folders;
    this.state = 'ready';
    if (this.visible) this.render();
  }

  #renderProgress() {
    if (!this.visible) return;
    const { done, total, phase } = this.progress;
    const pct = total ? Math.min(99, Math.round((phase === 'group' ? done / total * 0.8 : 0.8 + done / total * 0.2) * 100)) : 0;
    let bar = this.gate.querySelector('.tmv-progress-fill');
    if (!bar) {
      setChildren(this.gate,
        h('div.tmv-gate-card.tmv-building', { role: 'status', 'aria-live': 'polite' },
          h('span.tmv-gate-icon', { html: icon('map', 28) }),
          h('h2', t('treemap.building.title')),
          h('div.tmv-progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div.tmv-progress-fill')),
          h('p.tmv-progress-text'),
          h('p.muted.small', t('treemap.building.note')),
          h('button.btn.btn-secondary.btn-sm.tmv-cancel', { onclick: () => { this.#cancelBuild(); this.state = 'off'; this.render(); } }, t('common.cancel'))));
      bar = this.gate.querySelector('.tmv-progress-fill');
    }
    bar.style.width = `${pct}%`;
    this.gate.querySelector('.tmv-progress').setAttribute('aria-valuenow', String(pct));
    this.gate.querySelector('.tmv-progress-text').textContent = phase === 'group'
      ? t('treemap.building.group', { pct, done: formatNumber(done), total: formatNumber(total) })
      : t('treemap.building.sort', { pct, done: formatNumber(done), total: formatNumber(total) });
  }

  #renderGate() {
    const files = this.analysis.files.length;
    setChildren(this.gate,
      h('div.tmv-gate-card',
        h('span.tmv-gate-icon', { html: icon('map', 28) }),
        h('h2', t('treemap.gate.title')),
        h('p', t('treemap.gate.text')),
        h('p.tmv-gate-warn', h('span', { html: icon('warning', 15) }), h('span', tn('treemap.gate.heavy', files))),
        h('button.btn.btn-primary.tmv-activate', { onclick: () => this.activate() }, h('span', { html: icon('map', 15) }), t('treemap.gate.activate')),
        h('p.muted.small', t('treemap.gate.session'))));
  }

  #node(rel) {
    let node = this.analysis.tree;
    for (const s of splitRel(rel)) { node = node?.children.get(s); if (!node) return null; }
    return node;
  }

  #up() {
    const segs = splitRel(this.analysis.filter.folder);
    if (!segs.length) return;
    const sep = this.analysis.root.includes('\\') ? '\\' : '/';
    this.analysis.setFilter({ folder: segs.slice(0, -1).join(sep) });
  }

  render() {
    const { analysis } = this;
    if (!analysis.hasData) return;
    this.lastFolder = analysis.filter.folder;
    const ready = this.state === 'ready';
    this.gate.hidden = ready;
    this.toolbar.hidden = this.stage.hidden = this.legend.hidden = !ready;
    if (this.state === 'off') { this.#renderGate(); return; }
    if (this.state === 'stale') { setChildren(this.gate); this.#build(); return; }
    if (this.state === 'building') { this.#renderProgress(); return; }
    const node = this.#node(analysis.filter.folder) || analysis.tree;
    const isRoot = !analysis.filter.folder;
    const full = document.fullscreenElement === this.element;
    setChildren(this.toolbar,
      h('button.btn.btn-secondary.btn-sm.tmv-up', { disabled: isRoot, onclick: () => this.#up(), title: t('treemap.upTitle') },
        h('span', { html: icon('arrowUp', 14) }), t('treemap.up')),
      h('div.tmv-title',
        h('strong', isRoot ? baseName(analysis.root) : node.name),
        h('span.muted', `${formatBytes(node.size)} · ${tn('common.files', node.count)}`)),
      h('span.tmv-hint.muted', t('treemap.hint')),
      h('div.toolbar-spacer'),
      h('button.btn.btn-secondary.btn-sm.tmv-full', {
        title: full ? t('treemap.exitFullScreen') : t('treemap.fullScreenTitle'),
        onclick: () => (full ? document.exitFullscreen() : this.element.requestFullscreen()).catch(() => {}),
      }, h('span', { html: icon(full ? 'close' : 'arrowUpRight', 14) }), full ? t('treemap.exitFullScreen') : t('treemap.fullScreen')));
    const present = new Set(analysis.summary().byCategory.map((c) => c.id));
    setChildren(this.legend, CATEGORIES.filter((c) => present.has(c.id)).map((c) =>
      h('span.tmv-legend-item', h('span.swatch', { style: { background: categoryColor(c.id) } }), c.label)));
    this.canvas.setAttribute('aria-label', t('treemap.ariaLabel', { folder: isRoot ? baseName(analysis.root) : node.name }));
    this.#draw();
  }

  // ---------------------------------------------------------------- layout
  #draw() {
    const { analysis } = this;
    if (!analysis.hasData || this.state !== 'ready' || !this.#index) return;
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.dpr = dpr;
    this.colors = {
      bg: cssVar('--bg-editor'), frame: cssVar('--border-strong'), header: cssVar('--bg-subtle'),
      text: cssVar('--text-secondary'), rest: cssVar('--tile-muted'), missing: cssVar('--tile'), hover: cssVar('--text-primary'),
      cat: Object.fromEntries(CATEGORIES.map((c) => [c.id, categoryColor(c.id)])),
    };
    const node = this.#node(analysis.filter.folder) || analysis.tree;
    this.blocks = [];
    this.#layoutFolder(node, { x: 0, y: 0, w: W, h: H }, 0, null);
    this.#paint();
  }

  /** Lays out a folder's subfolders and files inside rect. top: the block of the first level (for zooming). */
  #layoutFolder(node, rect, level, top) {
    const entry = this.#index.get(node.rel);
    if (!entry || node.size <= 0) return;
    const { files, dirs } = entry;
    const total = node.size;
    const scale = (rect.w * rect.h) / total;
    // merge the two sorted lists, largest first, until blocks get too small to see
    const list = [];
    let fi = 0, di = 0, taken = 0;
    while (fi < files.length || di < dirs.length) {
      const f = files[fi], d = dirs[di];
      const useDir = d && (!f || d.size >= f.size);
      const value = useDir ? d.size : f.size;
      if (list.length && value * scale < MIN_AREA) break;
      list.push(useDir ? { kind: 'folder', node: d, value } : { kind: 'file', file: f, value });
      taken += value;
      if (useDir) di++; else fi++;
    }
    const restCount = (files.length - fi) + (dirs.length - di);
    if (restCount && total - taken > 0) list.push({ kind: 'rest', value: total - taken, count: restCount, folder: node });
    for (const r of squarify(list, rect, scale)) {
      const it = r.item;
      const block = { x: r.x, y: r.y, w: r.w, h: r.h, kind: it.kind, level, top: null, file: it.file, node: it.node, count: it.count, value: it.value, parent: node };
      block.top = top || block;
      this.blocks.push(block);
      if (it.kind === 'folder' && level < MAX_LEVELS && r.w > 4 && r.h > 4) {
        const head = r.w > 48 && r.h > HEADER * 2 ? HEADER : 1;
        block.header = head > 1;
        this.#layoutFolder(it.node, { x: r.x + 1, y: r.y + head, w: r.w - 2, h: r.h - head - 1 }, level + 1, block.top);
      }
    }
  }

  // ---------------------------------------------------------------- painting
  #paint() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.colors) return;
    const { colors: c, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    ctx.font = `600 10.5px ${cssVar('--font-ui') || 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    for (const b of this.blocks) {
      if (b.kind === 'folder') {
        ctx.fillStyle = c.header;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = c.frame;
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, Math.max(0, b.w - 1), Math.max(0, b.h - 1));
        if (b.header) {
          ctx.fillStyle = c.text;
          ctx.save();
          ctx.beginPath(); ctx.rect(b.x + 3, b.y, b.w - 6, HEADER); ctx.clip();
          ctx.fillText(`${b.node.name}  ${formatBytes(b.value)}`, b.x + 4, b.y + HEADER / 2 + 0.5);
          ctx.restore();
        }
      } else {
        const missing = b.kind === 'file' && this.analysis.isMissing(b.file.path);
        ctx.fillStyle = b.kind === 'rest' ? c.rest : missing ? c.missing : c.cat[b.file.cat] || c.rest;
        const gap = b.w > 3 && b.h > 3 ? 0.5 : 0;
        ctx.fillRect(b.x + gap, b.y + gap, Math.max(0.5, b.w - gap * 2), Math.max(0.5, b.h - gap * 2));
      }
    }
    if (this.hover) {
      const b = this.hover.top;
      ctx.strokeStyle = c.hover;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 1, b.y + 1, Math.max(0, b.w - 2), Math.max(0, b.h - 2));
      if (this.hover !== b) {
        const f = this.hover;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(f.x + 0.75, f.y + 0.75, Math.max(0, f.w - 1.5), Math.max(0, f.h - 1.5));
      }
    }
  }

  // ---------------------------------------------------------------- interaction
  #hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
    }
    return null;
  }

  #onMove(e) {
    const b = this.#hit(e);
    if (b !== this.hover) { this.hover = b; this.#paint(); }
    if (!b) { this.tooltip.hidden = true; this.canvas.style.cursor = ''; return; }
    this.canvas.style.cursor = b.top.kind === 'folder' ? 'zoom-in' : 'default';
    const sep = this.analysis.root.includes('\\') ? '\\' : '/';
    let title, lines, color;
    if (b.kind === 'file') {
      const f = b.file;
      title = f.name;
      color = this.colors.cat[f.cat];
      lines = [`${formatBytes(f.size)} · ${CATEGORY_BY_ID[f.cat]?.label || ''}`, f.folder || t('common.rootFolder'), t('treemap.modified', { date: formatDate(f.mtime) })];
      if (this.analysis.isMissing(f.path)) lines.push(t('files.missing.title'));
    } else if (b.kind === 'rest') {
      title = tn('treemap.smaller', b.count);
      lines = [formatBytes(b.value), (b.parent.rel || baseName(this.analysis.root))];
    } else {
      title = b.node.name;
      lines = [`${formatBytes(b.node.size)} · ${tn('common.files', b.node.count)}`, b.node.rel.split(sep).join(' › ')];
    }
    if (b.top.kind === 'folder') lines.push(t('treemap.clickToZoom', { folder: b.top.node.name }));
    else if (b.kind === 'file') lines.push(t('treemap.doubleClickToReveal', { explorer: this.actions.explorerName }));
    setChildren(this.tooltip,
      h('div.ct-title', color ? h('span.ct-swatch', { style: { background: color } }) : null, title),
      ...lines.map((l) => h('div.ct-line', l)));
    this.tooltip.hidden = false;
    const sr = this.stage.getBoundingClientRect();
    const tr = this.tooltip.getBoundingClientRect();
    let x = e.clientX - sr.left + 14;
    let y = e.clientY - sr.top + 14;
    if (x + tr.width > sr.width - 6) x = e.clientX - sr.left - tr.width - 14;
    if (y + tr.height > sr.height - 6) y = e.clientY - sr.top - tr.height - 14;
    this.tooltip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }

  #onClick(e) {
    const b = this.#hit(e);
    if (b?.top.kind === 'folder') {
      this.hover = null;
      this.tooltip.hidden = true;
      this.analysis.setFilter({ folder: b.top.node.rel });
    }
  }

  #onDoubleClick(e) {
    const b = this.#hit(e);
    if (b?.kind === 'file' && b.top === b) this.actions.reveal(b.file.path);
  }
}

/** Squarified treemap (Bruls et al.) with running sums: linear in the number of blocks. */
function squarify(items, rect, scale) {
  const out = [];
  let { x, y, w, h: hh } = rect;
  let i = 0;
  while (i < items.length && w > 0 && hh > 0) {
    const side = Math.min(w, hh);
    let sum = 0, min = Infinity, max = 0, worst = Infinity;
    let j = i;
    while (j < items.length) {
      const a = items[j].value * scale;
      const s2 = sum + a;
      const mn = Math.min(min, a), mx = Math.max(max, a);
      const wr = Math.max((side * side * mx) / (s2 * s2), (s2 * s2) / (side * side * mn));
      if (j > i && wr > worst) break;
      sum = s2; min = mn; max = mx; worst = wr; j++;
    }
    if (w >= hh) {
      const cw = sum / hh;
      let cy = y;
      for (let k = i; k < j; k++) { const rh = (items[k].value * scale) / cw; out.push({ item: items[k], x, y: cy, w: cw, h: rh }); cy += rh; }
      x += cw; w -= cw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (let k = i; k < j; k++) { const rw = (items[k].value * scale) / rh; out.push({ item: items[k], x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; hh -= rh;
    }
    i = j;
  }
  return out;
}
