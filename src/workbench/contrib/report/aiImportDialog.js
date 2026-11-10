/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Import the AI's answer": the person pastes what the AI answered, LionOrganizer recognizes the files of
// this analysis it mentions, with the risk the AI gave them, and lists them to review. Only the low-risk
// ones start checked. Deleting goes through the Recycle Bin and always asks for the typed code.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes, pathSep } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { categoryColor } from '../../browser/chartTheme.js';
import { parseAiAnswer, RISKS } from '../../services/report/common/aiAnswerParser.js';

/** Words the AI may use for each risk level: the user's language, plus English. */
function riskWords() {
  const out = {};
  for (const r of RISKS) {
    const local = t('aiImport.riskWords.' + r).split(',');
    out[r] = [...new Set([...local, r].map((w) => w.trim()).filter(Boolean))];
  }
  return out;
}

/** @param {{ analysis: any, host: any, notifications: any, actions: any }} services */
export function showAiImportDialog({ analysis, host, notifications, actions }) {
  if (!analysis.hasData || document.querySelector('.ai-import-dialog')) return;
  const body = h('div.ai-import-body');
  const footer = h('footer.cm-actions');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  let lastText = '';

  const pasteStep = () => {
    const area = h('textarea.ai-import-textarea', { rows: 12, spellcheck: false, placeholder: t('aiImport.placeholder'), 'aria-label': t('aiImport.textLabel') });
    area.value = lastText;
    const find = () => { lastText = area.value; resultStep(); };
    const paste = async () => {
      const text = await host.readText().catch(() => '');
      if (text) { area.value = text; area.focus(); } else notifications.warn(t('aiImport.clipboardEmpty'));
    };
    setChildren(body,
      h('p', t('aiImport.text')),
      area);
    setChildren(footer,
      h('button.btn.btn-secondary', { onclick: paste }, h('span', { html: icon('copy', 14) }), t('aiImport.paste')),
      h('span.cm-spacer'),
      h('button.btn.btn-secondary', { onclick: close }, t('common.cancel')),
      h('button.btn.btn-primary.ai-import-find', { onclick: find }, h('span', { html: icon('search', 14) }), t('aiImport.find')));
    requestAnimationFrame(() => area.focus());
  };

  const resultStep = () => {
    const files = analysis.files.filter((f) => !analysis.isMissing(f.path));
    const { matches, unmatched, ambiguous } = parseAiAnswer(lastText, { files, root: analysis.root, sep: pathSep(analysis.root), riskWords: riskWords() });
    const checked = new Set(matches.filter((m) => m.risk === 'low').map((m) => m.file.path));
    const summary = h('p.ai-import-summary');
    const trashBtn = h('button.btn.btn-danger.ai-import-trash');
    const refresh = () => {
      const sel = matches.filter((m) => checked.has(m.file.path));
      const bytes = sel.reduce((n, m) => n + m.file.size, 0);
      setChildren(summary, tn('aiImport.selected', sel.length, { size: formatBytes(bytes) }));
      trashBtn.disabled = !sel.length;
      setChildren(trashBtn, h('span', { html: icon('trash', 14) }), tn('aiImport.trash', sel.length));
    };
    const row = (m) => {
      const box = h('input', {
        type: 'checkbox', checked: checked.has(m.file.path), 'aria-label': m.file.name,
        onchange: (e) => { e.target.checked ? checked.add(m.file.path) : checked.delete(m.file.path); refresh(); },
      });
      const risk = m.risk || 'unknown';
      return h('li.ai-import-row', { title: m.reason },
        h('label.ai-import-check', box,
          h('span.swatch', { style: { background: categoryColor(m.file.cat) } }),
          h('span.ai-import-name', m.file.name),
          h('span.ai-import-folder.muted', m.file.folder || t('common.rootFolder'))),
        h(`span.risk-chip.risk-${risk}`, t('aiImport.risk.' + risk)),
        h('span.ai-import-size', formatBytes(m.file.size)));
    };
    const setAll = (pred) => { checked.clear(); for (const m of matches) if (pred(m)) checked.add(m.file.path); render(); };
    const render = () => {
      setChildren(body,
        matches.length
          ? [
              h('p', tn('aiImport.found', matches.length)),
              h('div.ai-import-quick',
                h('button.link', { onclick: () => setAll((m) => m.risk === 'low') }, t('aiImport.selectLow')),
                h('button.link', { onclick: () => setAll(() => true) }, t('aiImport.selectAll')),
                h('button.link', { onclick: () => setAll(() => false) }, t('aiImport.selectNone'))),
              h('ul.ai-import-list', matches.map(row)),
              h('p.muted.small', t('aiImport.reviewNote')),
            ]
          : h('div.empty-state.compact', h('span', { html: icon('search', 24) }), h('p', t('aiImport.noneFound'))),
        unmatched.length ? h('details.ai-import-unmatched',
          h('summary', tn('aiImport.unmatched', unmatched.length)),
          h('ul', unmatched.map((u) => h('li', h('code', u))))) : null,
        ambiguous.length ? h('p.muted.small', tn('aiImport.ambiguous', ambiguous.length, { names: ambiguous.slice(0, 3).join(', ') })) : null);
      refresh();
    };
    trashBtn.onclick = async () => {
      const sel = matches.filter((m) => checked.has(m.file.path)).map((m) => m.file);
      if (!sel.length) return;
      close();
      await actions.trash(sel); // typed code, always
    };
    setChildren(footer,
      h('button.btn.btn-secondary', { onclick: pasteStep }, t('aiImport.back')),
      summary,
      h('span.cm-spacer'),
      h('button.btn.btn-secondary', { onclick: close }, t('common.close')),
      matches.length ? trashBtn : null);
    render();
  };

  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.ai-import-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ai-import-title' },
      h('header.update-head', h('span.update-icon.is-brand', { html: icon('import', 20) }), h('h2#ai-import-title', t('aiImport.title'))),
      body,
      footer));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  pasteStep();
}
