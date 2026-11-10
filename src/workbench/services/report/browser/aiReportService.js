/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Report for an AI: a Markdown document, in the user's language, with instructions for the AI and the data
// it needs to suggest which files are probably the safest to delete (largest files, cleanup suggestions,
// duplicates confirmed by SHA-256). It contains names, sizes, dates and paths relative to the analyzed
// folder — never file contents. The app sends it nowhere: the user copies or saves it and decides.
import { formatBytes, formatDate, formatPercent, baseName, pathSep } from '../../../../base/common/format.js';
import { CATEGORY_BY_ID } from '../../analysis/common/fileCategories.js';
import { t, tn, getLocale, getLocales } from '../../../../base/common/nls.js';

export const REPORT_SIZES = [100, 300, 1000];
export const DEFAULT_REPORT_SIZE = 300;
const RULES = 6;
const PER_GROUP = 40;
const MAX_DUP_GROUPS = 50;
const SUBFOLDERS = 15;

/** The word the AI should use for a risk level, in the user's language ("low", "baixo"…). */
const firstWord = (level) => t('aiImport.riskWords.' + level).split(',')[0].trim();

/** Text safe inside a Markdown table cell or inline code. */
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const code = (v) => '`' + String(v).replace(/`/g, "'").replace(/[\r\n]+/g, ' ') + '`';

export class AiReportService {
  constructor({ host, analysis, duplicates, update }) {
    Object.assign(this, { host, analysis, duplicates, update });
  }

  /** @returns {{ text: string, files: number }} */
  build(maxFiles = DEFAULT_REPORT_SIZE) {
    const a = this.analysis;
    const s = a.summary();
    const sep = pathSep(a.root);
    const folderName = baseName(a.root) || a.root;
    const live = (f) => !a.isMissing(f.path);
    const rel = (f) => (f.folder ? f.folder + sep : '') + f.name;
    const language = getLocales().find((l) => l.id === getLocale())?.label || getLocale();
    const out = [];
    const line = (...l) => out.push(...l);

    // ---- instructions for the AI
    line(`# ${t('report.ai.title')}`, '');
    line(`## ${t('report.ai.instructions.heading')}`, '', t('report.ai.instructions.intro', { folder: folderName }), '');
    for (let i = 1; i <= RULES; i++) line(`${i}. ${t('report.ai.instructions.rule' + i)}`);
    // so the answer can be pasted back into LionOrganizer ("Import AI answer")
    line(`${RULES + 1}. ${t('report.ai.instructions.format', { low: firstWord('low'), medium: firstWord('medium'), high: firstWord('high') })}`);
    line('', t('report.ai.instructions.answerIn', { language }), '', t('report.ai.instructions.deleteNote'), '');

    // ---- summary
    line(`## ${t('report.ai.summary.heading')}`, '');
    line(`- ${t('report.ai.summary.folder', { folder: folderName })}`);
    if (a.filter.folder) line(`- ${t('report.ai.summary.scope', { folder: a.filter.folder })}`);
    line(`- ${t('report.ai.summary.totals', { size: formatBytes(s.bytes), files: tn('common.files', s.count) })}`);
    line(`- ${t('report.ai.summary.generated', { date: new Date().toLocaleString(getLocale()) })}`, '');
    line(`### ${t('report.ai.summary.byType')}`, '');
    for (const c of s.byCategory) line(`- ${CATEGORY_BY_ID[c.id].label}: ${formatBytes(c.size)} (${formatPercent(c.size, s.bytes)}) · ${tn('common.files', c.count)}`);
    line('', `### ${t('report.ai.summary.subfolders')}`, '');
    for (const sub of s.bySubfolder.slice(0, SUBFOLDERS)) {
      line(`- ${sub.name ? code(sub.rel) : t('report.ai.summary.looseFiles')}: ${formatBytes(sub.size)} (${formatPercent(sub.size, s.bytes)}) · ${tn('common.files', sub.count)}`);
    }

    // ---- cleanup suggestions found by the app
    const groups = a.cleanupGroups().map((g) => ({ ...g, files: g.files.filter(live) })).filter((g) => g.files.length);
    const hints = new Map(); // path → labels of the suggestions it appears in
    for (const g of groups) for (const f of g.files) hints.set(f.path, [...(hints.get(f.path) || []), g.label]);
    line('', `## ${t('report.ai.cleanup.heading')}`, '', t('report.ai.cleanup.intro'), '');
    if (!groups.length) line(t('report.ai.cleanup.none'));
    for (const g of groups) {
      line(`### ${g.label} — ${formatBytes(g.files.reduce((n, f) => n + f.size, 0))} · ${tn('common.files', g.files.length)}`, '', g.desc, '');
      for (const f of g.files.slice(0, PER_GROUP)) line(`- ${code(rel(f))} · ${formatBytes(f.size)} · ${formatDate(f.mtime)}`);
      if (g.files.length > PER_GROUP) line(`- ${tn('report.ai.more', g.files.length - PER_GROUP)}`);
      line('');
    }

    // ---- duplicates confirmed by content (SHA-256)
    line(`## ${t('report.ai.duplicates.heading')}`, '');
    const dupGroups = (this.duplicates?.groups || []).map((g) => ({ ...g, files: g.files.filter(live) })).filter((g) => g.files.length > 1);
    if (!dupGroups.length) {
      line(t(this.duplicates?.status === 'done' ? 'report.ai.duplicates.none' : 'report.ai.duplicates.notChecked'), '');
    } else {
      line(t('report.ai.duplicates.intro'), '');
      for (const g of dupGroups.slice(0, MAX_DUP_GROUPS)) {
        line(`### ${tn('report.ai.duplicates.group', g.files.length, { size: formatBytes(g.size) })}`, '');
        for (const f of g.files) line(`- ${code(rel(f))} · ${formatDate(f.mtime)}${f.path === g.keep ? ` — ${t('report.ai.duplicates.keep')}` : ''}`);
        line('');
      }
      if (dupGroups.length > MAX_DUP_GROUPS) line(tn('report.ai.duplicates.moreGroups', dupGroups.length - MAX_DUP_GROUPS), '');
    }

    // ---- largest files
    const files = a.scopeFiles().filter(live).sort((x, y) => y.size - x.size).slice(0, maxFiles);
    line(`## ${tn('report.ai.largest.heading', files.length)}`, '');
    line(`| # | ${t('report.ai.col.path')} | ${t('report.ai.col.size')} | ${t('report.ai.col.modified')} | ${t('report.ai.col.type')} | ${t('report.ai.col.hints')} |`);
    line('|---:|---|---:|---|---|---|');
    files.forEach((f, i) => {
      line(`| ${i + 1} | ${cell(rel(f))} | ${formatBytes(f.size)} | ${formatDate(f.mtime)} | ${cell(CATEGORY_BY_ID[f.cat].label)} | ${cell((hints.get(f.path) || []).join('; '))} |`);
    });
    line('', '---', t('report.ai.footer', { version: this.update?.version || '' }), '');
    return { text: out.join('\n'), files: files.length };
  }

  /** Default file name, e.g. "lionorganizer-ai-report-Projects.md" in the user's language. */
  fileName() {
    const folder = (baseName(this.analysis.root) || 'folder').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'folder';
    return `${t('report.ai.fileName', { folder })}.md`;
  }
}
