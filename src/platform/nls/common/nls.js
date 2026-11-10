/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Native Language Support for the main process (CommonJS twin of src/base/common/nls.js).
// The UI tells the main process which locale it is using (IPC "nls:setLocale"); until then
// the operating system locale is used. Always call t()/tn() at call time — the locale can change.
const fs = require('fs');
const path = require('path');

const NLS_DIR = path.join(__dirname, '..', '..', '..', 'nls');
const LOCALES = JSON.parse(fs.readFileSync(path.join(NLS_DIR, 'locales.json'), 'utf8')).map((l) => l.id);

let locale = 'en';
let messages = {};
let fallback = {};
let pluralRules = new Intl.PluralRules('en');
let numberFormat = new Intl.NumberFormat('en');

function load(id) {
  try { return JSON.parse(fs.readFileSync(path.join(NLS_DIR, `${id}.json`), 'utf8')); } catch { return {}; }
}

function negotiateLocale(requested) {
  for (const raw of requested || []) {
    const tag = String(raw).toLowerCase();
    const exact = LOCALES.find((s) => s.toLowerCase() === tag);
    if (exact) return exact;
    const [lang, region] = tag.split(/[-_]/);
    if (lang === 'pt') return region === 'br' ? 'pt-BR' : 'pt-PT';
    if (lang === 'zh') {
      if (!region || ['cn', 'sg', 'hans'].includes(region)) return 'zh-CN';
      continue;
    }
    const base = LOCALES.find((s) => s.toLowerCase() === lang);
    if (base) return base;
  }
  return 'en';
}

function setLocale(requested) {
  const next = LOCALES.includes(requested) ? requested : negotiateLocale([requested]);
  locale = next;
  fallback = load('en');
  messages = next === 'en' ? fallback : load(next);
  pluralRules = new Intl.PluralRules(next);
  numberFormat = new Intl.NumberFormat(next);
  return locale;
}

function format(message, params) {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in params)) return m;
    const v = params[name];
    return typeof v === 'number' ? numberFormat.format(v) : String(v);
  });
}

function t(key, params) {
  return format(messages[key] ?? fallback[key] ?? key, params);
}

function tn(key, count, params) {
  // CLDR puts 0 in the "one" category for Portuguese, but Brazilian usage prefers the plural for zero.
  const rule = count === 0 && locale === 'pt-BR' ? 'other' : pluralRules.select(count);
  const pick = (cat) => cat[`${key}.${rule}`] ?? cat[`${key}.other`];
  return format(pick(messages) ?? pick(fallback) ?? key, { count, ...params });
}

/** Byte sizes with the locale's number format and unit names (e.g. French "Mo"). */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const n = i === 0 ? numberFormat.format(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: v >= 100 ? 0 : 1, minimumFractionDigits: v >= 100 ? 0 : 1 }).format(v);
  return `${n} ${t('units.' + units[i])}`;
}

const getLocale = () => locale;

setLocale('en');

module.exports = { t, tn, setLocale, getLocale, negotiateLocale, formatBytes, LOCALES };
