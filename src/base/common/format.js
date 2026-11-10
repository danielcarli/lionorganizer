/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Locale-aware formatting for the UI (sizes use base 1024, like Windows Explorer).
// Formatters are created lazily from the active locale (see ./nls.js).
import { getLocale, t } from './nls.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
let cache = { locale: null };

function fmt() {
  const locale = getLocale();
  if (cache.locale !== locale) {
    cache = {
      locale,
      nf: new Intl.NumberFormat(locale),
      nf1: new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
      df: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      sec: new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }),
      min: new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }),
      ms: new Intl.NumberFormat(locale, { style: 'unit', unit: 'millisecond', unitDisplay: 'short' }),
    };
  }
  return cache;
}

function scale(bytes) {
  let i = 0;
  let v = bytes || 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return { v, i };
}

export function formatBytes(bytes) {
  const { nf, nf1 } = fmt();
  const { v, i } = scale(bytes);
  const n = i === 0 ? nf.format(v) : v >= 100 ? nf.format(Math.round(v)) : nf1.format(v);
  return `${n} ${t('units.' + UNITS[i])}`;
}

/** Parts for hero numbers: "48" + ",2" + "GB" (the decimal part is rendered dimmed). */
export function bytesParts(bytes) {
  const { nf, nf1 } = fmt();
  const { v, i } = scale(bytes);
  const parts = (i === 0 || v >= 100 ? nf : nf1).formatToParts(i === 0 ? v : v >= 100 ? Math.round(v) : v);
  const cut = parts.findIndex((p) => p.type === 'decimal');
  const join = (arr) => arr.map((p) => p.value).join('');
  return {
    int: join(cut < 0 ? parts : parts.slice(0, cut)),
    dec: cut < 0 ? '' : join(parts.slice(cut)),
    unit: t('units.' + UNITS[i]),
  };
}

export const formatNumber = (n) => fmt().nf.format(n);
export const formatDate = (ms) => (ms ? fmt().df.format(new Date(ms)) : '—');
/** Date and time, e.g. "5 Nov 2026, 14:32" in the user's language. */
export const formatDateTime = (ms) => (ms ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '—');
export const formatPercent = (part, total) =>
  new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(total ? part / total : 0);

export function formatDuration(ms) {
  const f = fmt();
  if (ms < 1000) return f.ms.format(Math.round(ms));
  const s = ms / 1000;
  return s < 60 ? f.sec.format(s) : `${f.min.format(Math.floor(s / 60))} ${f.sec.format(Math.round(s % 60))}`;
}

export function pathSep(p) {
  return p.includes('\\') ? '\\' : '/';
}

export function joinPath(root, rel) {
  if (!rel) return root;
  const sep = pathSep(root);
  return root.replace(/[\\/]+$/, '') + sep + rel;
}

export function baseName(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** Splits a relative path ("a\\b\\c") into segments. */
export const splitRel = (rel) => (rel ? rel.split(/[\\/]/).filter(Boolean) : []);
