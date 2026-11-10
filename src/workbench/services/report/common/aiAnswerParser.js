/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Reads an AI's answer to the LionOrganizer report and finds the files it mentions, with the risk level it
// gave each one. Only paths that belong to the analysis on screen are recognized; nothing is deleted here.
// No DOM and no I/O: easy to test.

export const RISKS = ['low', 'medium', 'high'];
const RANK = { low: 1, medium: 2, high: 3 };
const MAX_UNMATCHED = 50;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

const clean = (s) => String(s).replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

/** "My Folder\\a.dwg", "./a.dwg", "**a.dwg**," … → "my folder/a.dwg" (lowercase, forward slashes) */
function normalize(candidate, rootNorm, rootName) {
  let c = String(candidate).trim()
    .replace(/^[\s"'“”‘’«»<([{*_]+/, '')
    .replace(/[\s"'“”‘’«»>)\]}*_]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  if (rootNorm && c.startsWith(rootNorm + '/')) c = c.slice(rootNorm.length + 1);
  else if (rootName && c.startsWith(rootName + '/')) c = c.slice(rootName.length + 1);
  return c.replace(/^\.?\/+/, '').replace(/\/{2,}/g, '/');
}

/** Candidates with trailing punctuation removed one step at a time ("a.dwg." → "a.dwg"). */
function variants(c) {
  const out = [c];
  let v = c;
  while (/[.,;:!?]$/.test(v)) { v = v.slice(0, -1); out.push(v); }
  return out;
}

function riskMatcher(riskWords) {
  const tests = RISKS.map((level) => {
    const words = (riskWords[level] || []).map((w) => w.trim().toLowerCase()).filter(Boolean);
    return {
      level,
      words,
      re: words.filter((w) => !CJK.test(w)).map((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu')),
      // a single CJK character ("中") is far too common in running text: only trusted as a whole table cell
      cjk: words.filter((w) => CJK.test(w) && w.length > 1),
    };
  });
  /** The highest risk mentioned in the text (conservative when a line says "low to medium"). */
  const inText = (text) => {
    const low = text.toLowerCase();
    let best = null;
    for (const tst of tests) {
      if (tst.re.some((re) => re.test(low)) || tst.cjk.some((w) => low.includes(w))) best = tst.level;
    }
    return best;
  };
  /** A table cell that is only a risk word ("Low", "**baixo**", "🟢 low"). */
  const asCell = (cell) => {
    const v = clean(cell).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    for (const tst of tests) if (tst.words.includes(v)) return tst.level;
    return null;
  };
  return { inText, asCell };
}

/**
 * @param {string} text the AI's answer (Markdown or plain text)
 * @param {{ files: {path:string, folder:string, name:string, size:number}[], root: string, sep: string,
 *           riskWords: Record<'low'|'medium'|'high', string[]> }} ctx
 * @returns {{ matches: { file: object, risk: 'low'|'medium'|'high'|null, reason: string }[],
 *             unmatched: string[], ambiguous: string[] }}
 */
export function parseAiAnswer(text, { files, root, sep, riskWords }) {
  const rootNorm = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const rootName = rootNorm.slice(rootNorm.lastIndexOf('/') + 1);
  const byRel = new Map();
  const byName = new Map();
  for (const f of files) {
    const rel = ((f.folder ? f.folder + sep : '') + f.name).replace(/\\/g, '/').toLowerCase();
    byRel.set(rel, f);
    const n = f.name.toLowerCase();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(f);
  }
  const risk = riskMatcher(riskWords);
  const found = new Map(); // path → { file, risk, reason }
  const unmatched = new Set();
  const ambiguous = new Set();
  let sectionRisk = null;

  const lookup = (raw) => {
    for (const v of variants(normalize(raw, rootNorm, rootName))) {
      if (!v) continue;
      const hit = byRel.get(v);
      if (hit) return { file: hit };
      if (!v.includes('/')) {
        const same = byName.get(v);
        if (same?.length === 1) return { file: same[0] };
        if (same?.length > 1) return { ambiguous: v };
      }
    }
    return null;
  };
  const looksLikePath = (raw) => {
    const n = normalize(raw, rootNorm, rootName);
    return n.length > 2 && n.length < 400 && (/\.[a-z0-9$~]{1,10}$/i.test(n) || n.includes('/'));
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // headings ("## Low risk") and bold-only lines set the risk of the items below them
    if (/^#{1,6}\s/.test(trimmed) || /^\*\*[^*]+\*\*:?$/.test(trimmed)) {
      sectionRisk = risk.inText(clean(trimmed));
      continue;
    }
    if (/^\|?\s*:?-{3,}/.test(trimmed)) continue; // table separator

    const candidates = [];
    for (const m of trimmed.matchAll(/`([^`]+)`/g)) candidates.push(m[1]);
    const cells = trimmed.includes('|') ? trimmed.split('|').map((c) => c.trim()).filter(Boolean) : [];
    if (!candidates.length) {
      candidates.push(...cells);
      for (const m of trimmed.matchAll(/[^\s`|*"'“”<>()[\]{}]+\.[A-Za-z0-9$~]{1,10}(?=$|[\s`|*"'“”<>()[\]{},;:!?]|\.(?:\s|$))/g)) candidates.push(m[0]);
    }

    let lineRisk = null;
    for (const c of cells) { const r = risk.asCell(c); if (r && (!lineRisk || RANK[r] > RANK[lineRisk])) lineRisk = r; }
    if (!lineRisk) {
      // the risk words are searched outside the paths (a file may be called "high-res.png")
      const prose = clean(trimmed.replace(/`[^`]*`/g, ' '));
      lineRisk = risk.inText(prose);
    }
    if (!lineRisk) lineRisk = sectionRisk;

    const hits = new Set();
    for (const c of candidates) {
      const res = lookup(c);
      if (res?.file) {
        if (hits.has(res.file.path)) continue;
        hits.add(res.file.path);
        const prev = found.get(res.file.path);
        const reason = clean(trimmed.replace(/^[-*+]\s+|^\d+[.)]\s+/, '')).slice(0, 220);
        if (!prev) found.set(res.file.path, { file: res.file, risk: lineRisk, reason });
        else if (lineRisk && (!prev.risk || RANK[lineRisk] > RANK[prev.risk])) prev.risk = lineRisk;
      } else if (res?.ambiguous) {
        ambiguous.add(res.ambiguous);
      } else if (unmatched.size < MAX_UNMATCHED && looksLikePath(c) && (!cells.includes(c) || /[\\/]/.test(c))) {
        unmatched.add(clean(c)); // table cells only count when they look like a path, not like "1.5 GB"
      }
    }
  }

  const matches = [...found.values()].sort((a, b) =>
    (RANK[a.risk] || 4) - (RANK[b.risk] || 4) || b.file.size - a.file.size);
  return { matches, unmatched: [...unmatched], ambiguous: [...ambiguous] };
}
