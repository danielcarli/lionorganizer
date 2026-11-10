/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Explorer" side bar: analysis controls and the folder tree with sizes.
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes, baseName } from '../../../base/common/format.js';
import { MAX_DEPTH } from '../../services/scan/browser/scanService.js';
import { t, tn } from '../../../base/common/nls.js';

const MAX_CHILDREN = 150;

export class SidebarPart {
  expanded = new Set(['']);

  constructor(services) {
    Object.assign(this, services);
    this.controls = h('div.sidebar-controls');
    this.treeBody = h('div.tree', { role: 'tree' });
    this.treeTitle = h('span.section-title-text', t('sidebar.folders'));
    this.treeNote = h('div.tree-note');

    this.element = h('aside.part.sidebar',
      h('div.sidebar-header', h('span', t('sidebar.title'))),
      this.#section(t('sidebar.analysis'), this.controls),
      this.#section(this.treeTitle, h('div.tree-wrap', this.treeBody, this.treeNote), { grow: true }),
      this.#sash());

    this.scan.onDidChangeState(() => this.renderControls());
    this.scan.onDidChangeSettings(() => this.renderControls());
    this.scan.onDidProgress(() => this.#renderProgress());
    this.analysis.onDidChangeData(() => {
      if (this.lastRoot !== this.analysis.root) { this.lastRoot = this.analysis.root; this.expanded = new Set(['']); }
      this.renderControls();
      this.renderTree();
    });
    this.analysis.onDidChangeFilter(() => this.renderTree());
    this.layout.onDidChangeSidebar((v) => { this.element.hidden = !v; });
    this.renderControls();
    this.renderTree();
  }

  #section(title, body, { grow = false } = {}) {
    const chevron = h('span.section-chevron', { html: icon('chevronDown', 14) });
    const section = h(`section.sidebar-section${grow ? '.grow' : ''}`,
      h('button.section-header', {
        onclick: () => { section.classList.toggle('collapsed'); },
      }, chevron, typeof title === 'string' ? h('span.section-title-text', title) : title),
      h('div.section-body', body));
    return section;
  }

  #sash() {
    const sash = h('div.sash', { title: t('sidebar.resize') });
    sash.addEventListener('pointerdown', (e) => {
      sash.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = this.element.getBoundingClientRect().width;
      const move = (ev) => { this.element.style.width = `${Math.min(520, Math.max(220, startW + ev.clientX - startX))}px`; };
      const up = () => { sash.removeEventListener('pointermove', move); sash.removeEventListener('pointerup', up); };
      sash.addEventListener('pointermove', move);
      sash.addEventListener('pointerup', up);
    });
    return sash;
  }

  // ---------------- controls ----------------
  renderControls() {
    const { scan } = this;
    const busy = scan.state === 'scanning';
    const { depth, unlimited } = scan.settings;

    const depthInput = h('input.depth-input', {
      type: 'number', min: '0', max: String(MAX_DEPTH), value: String(depth), disabled: busy || unlimited,
      'aria-label': t('sidebar.depthLabel'),
      onchange: (e) => scan.setDepth(e.target.value),
    });
    const step = (d) => h('button.stepper-btn', {
      disabled: busy || unlimited || (d < 0 ? depth <= 0 : depth >= MAX_DEPTH),
      onclick: () => scan.setDepth(depth + d), 'aria-label': d < 0 ? t('sidebar.depthDecrease') : t('sidebar.depthIncrease'),
    }, d < 0 ? '−' : '+');

    const hint = unlimited
      ? t('sidebar.hint.unlimited')
      : depth === 0
        ? t('sidebar.hint.none')
        : tn('sidebar.hint.depth', depth);

    const folderRow = scan.folder
      ? h('button.folder-field', { title: scan.folder, disabled: busy, onclick: () => this.actions.openFolderAndScan() },
          h('span.ff-icon', { html: icon('folderOpen', 16) }),
          h('span.ff-text', h('span.ff-name', baseName(scan.folder)), h('span.ff-path', scan.folder)))
      : null;

    const buttons = busy
      ? h('button.btn.btn-secondary.btn-block', { onclick: () => scan.cancel() }, h('span', { html: icon('stop', 14) }), t('sidebar.cancel', { key: 'Esc' }))
      : scan.folder
        ? h('div.btn-row',
            h('button.btn.btn-primary', { onclick: () => scan.scan() }, h('span', { html: icon('refresh', 14) }), this.analysis.hasData ? t('sidebar.rescan') : t('sidebar.scan')),
            h('button.btn.btn-secondary', { onclick: () => this.actions.openFolderAndScan(), title: t('sidebar.changeFolderTitle', { key: 'Ctrl+O' }) }, t('sidebar.changeFolder')))
        : h('button.btn.btn-primary.btn-block', { onclick: () => this.actions.openFolderAndScan() }, h('span', { html: icon('folderOpen', 14) }), t('sidebar.openFolder'));

    this.progressEl = h('div.scan-progress', { hidden: !busy });

    setChildren(this.controls, 
      folderRow,
      h('div.field',
        h('label.field-label', t('sidebar.depthLabel')),
        h('div.depth-row',
          h('div.stepper', step(-1), depthInput, step(+1)),
          h('label.checkbox', h('input', { type: 'checkbox', checked: unlimited, disabled: busy, onchange: (e) => scan.setUnlimited(e.target.checked) }), t('sidebar.unlimited'))),
        h('p.field-hint', hint)),
      h('label.checkbox.record-toggle', { title: t('sidebar.recordHint') },
        h('input', { type: 'checkbox', checked: scan.settings.record, disabled: busy, onchange: (e) => scan.setRecord(e.target.checked) }),
        t('sidebar.record')),
      buttons,
      this.progressEl,
      scan.error ? h('p.field-error', h('span', { html: icon('warning', 14) }), scan.error) : null);
    this.#renderProgress();
  }

  #renderProgress() {
    const p = this.scan.progress;
    if (!this.progressEl || this.scan.state !== 'scanning' || !p) return;
    this.progressEl.hidden = false;
    setChildren(this.progressEl, 
      h('div.progress-track', h('div.progress-indeterminate')),
      h('div.progress-stats', `${tn('common.files', p.files)} · ${formatBytes(p.bytes)}`),
      h('div.progress-path', { title: p.current }, p.current));
  }

  // ---------------- tree ----------------
  renderTree() {
    const { analysis } = this;
    clear(this.treeBody);
    clear(this.treeNote);
    if (!analysis.hasData) {
      this.treeBody.append(h('p.empty-hint', t('sidebar.emptyTree')));
      return;
    }
    const tree = analysis.tree;
    this.#renderNode(tree, 0, tree.size || 1, true);

    const skipped = analysis.result.skippedDirs.length;
    if (skipped) {
      this.treeNote.append(
        h('span', { html: icon('layers', 14) }),
        h('span', tn('sidebar.skipped', skipped)),
        h('button.link', { onclick: () => { this.scan.setDepth(this.scan.settings.depth + 2); this.scan.scan(); } }, t('sidebar.readMore')));
    }
  }

  #renderNode(node, level, parentSize, isRoot = false) {
    const { analysis } = this;
    const children = [...node.children.values()].sort((a, b) => b.size - a.size);
    const hasChildren = children.length > 0;
    const open = this.expanded.has(node.rel);
    const selected = analysis.filter.folder === node.rel;
    const pct = Math.round((node.size / parentSize) * 100);

    const row = h('div.tree-row', {
      role: 'treeitem', 'aria-expanded': hasChildren ? String(open) : undefined, 'aria-selected': String(selected),
      style: { paddingLeft: `${8 + level * 12}px` },
      title: `${isRoot ? node.name : node.rel}\n${formatBytes(node.size)} · ${tn('common.files', node.count)}`,
      onclick: () => { if (hasChildren) this.expanded.add(node.rel); analysis.setFilter({ folder: node.rel }); },
      ondblclick: () => this.#toggle(node.rel),
    },
      h('span.tree-twistie', {
        html: hasChildren ? icon(open ? 'chevronDown' : 'chevronRight', 14) : '',
        onclick: (e) => { e.stopPropagation(); this.#toggle(node.rel); },
      }),
      h('span.tree-icon', { html: icon(open && hasChildren ? 'folderOpen' : 'folder', 15) }),
      h('span.tree-label', isRoot ? baseName(node.name) : node.name),
      h('span.tree-size', formatBytes(node.size)),
      h('button.tree-action.icon-button', {
        title: t('common.showIn', { explorer: this.actions.explorerName }), html: icon('reveal', 14),
        onclick: (e) => { e.stopPropagation(); this.actions.revealFolder(node.rel); },
      }),
      pct >= 2 ? h('span.tree-bar', { style: { width: `${pct}%` } }) : null);
    row.classList.toggle('selected', selected);
    this.treeBody.append(row);

    if (open) {
      children.slice(0, MAX_CHILDREN).forEach((c) => this.#renderNode(c, level + 1, node.size || 1));
      if (children.length > MAX_CHILDREN) {
        this.treeBody.append(h('div.tree-more', { style: { paddingLeft: `${28 + (level + 1) * 12}px` } },
          tn('sidebar.moreFolders', children.length - MAX_CHILDREN)));
      }
    }
  }

  #toggle(rel) {
    this.expanded.has(rel) ? this.expanded.delete(rel) : this.expanded.add(rel);
    this.renderTree();
  }
}
