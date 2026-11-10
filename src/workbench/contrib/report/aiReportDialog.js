/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Export for AI analysis" dialog: explains what the report contains, lets the user choose how many files
// it lists, and copies it to the clipboard or saves it as a .md file. The report is in the user's language.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatBytes } from '../../../base/common/format.js';
import { t, tn } from '../../../base/common/nls.js';
import { REPORT_SIZES, DEFAULT_REPORT_SIZE } from '../../services/report/browser/aiReportService.js';

const SIZE_KEY = 'lionorganizer.aiReport.size';

/** @param {{ report: import('../../services/report/browser/aiReportService.js').AiReportService, host: any, notifications: any, analysis: any }} services */
export function showAiReportDialog({ report, host, notifications, analysis }) {
  if (!analysis.hasData || document.querySelector('.ai-report-dialog')) return;
  let size = DEFAULT_REPORT_SIZE;
  try { size = Number(localStorage.getItem(SIZE_KEY)) || DEFAULT_REPORT_SIZE; } catch { /* storage unavailable */ }
  if (!REPORT_SIZES.includes(size)) size = DEFAULT_REPORT_SIZE;
  let built = report.build(size);

  const preview = h('p.muted.small.ai-report-preview');
  const updatePreview = () => setChildren(preview, t('report.dialog.preview', {
    files: tn('common.files', built.files),
    size: formatBytes(new TextEncoder().encode(built.text).length),
  }));
  const select = h('select.select', {
    'aria-label': t('report.dialog.count'),
    onchange: (e) => {
      size = Number(e.target.value);
      try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* storage unavailable */ }
      built = report.build(size);
      updatePreview();
    },
  }, REPORT_SIZES.map((n) => h('option', { value: String(n), selected: n === size }, tn('report.dialog.countOption', n))));
  updatePreview();

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const copy = async () => {
    const ok = await host.copyText(built.text).catch(() => false);
    if (ok) { notifications.info(t('report.copied'), 9000); close(); } else notifications.warn(t('report.copyFailed'));
  };
  const save = async () => {
    const saved = await host.saveReport(report.fileName(), built.text).catch(() => null);
    if (saved) { notifications.info(t('report.saved', { path: saved }), 9000); close(); }
  };
  const copyBtn = h('button.btn.btn-primary', { onclick: copy }, h('span', { html: icon('copy', 14) }), t('report.dialog.copy'));
  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.ai-report-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ai-report-title' },
      h('header.update-head', h('span.update-icon.is-brand', { html: icon('sparkle', 20) }), h('h2#ai-report-title', t('report.dialog.title'))),
      h('p', t('report.dialog.text')),
      h('ul.ai-report-list',
        h('li', t('report.dialog.includes')),
        h('li', t('report.dialog.privacy')),
        h('li', t('report.dialog.howTo'))),
      h('label.ai-report-count', h('span', t('report.dialog.count')), select),
      preview,
      h('footer.cm-actions',
        h('button.btn.btn-secondary', { onclick: close }, t('common.close')),
        h('button.btn.btn-secondary', { onclick: save }, h('span', { html: icon('download', 14) }), t('report.dialog.save')),
        copyBtn)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  requestAnimationFrame(() => copyBtn.focus());
}
