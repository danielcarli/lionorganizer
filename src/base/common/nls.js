/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Native Language Support for the renderer (UI) — a small take on VS Code's vs/nls.
//
//   t('overview.hero.used')                    → plain message
//   t('common.showIn', { explorer: 'Explorer' }) → message with {placeholders}
//   tn('common.files', 3)                      → plural: picks "common.files.one" / ".other" (Intl.PluralRules)
//
// Messages live in src/nls/<locale>.json (flat "namespace.key": "text" objects).
// Missing keys fall back to English, then to the key itself.

const PREF_KEY = 'lionorganizer.locale';
const RESCAN_KEY = 'lionorganizer.rescanAfterReload';

let locale = 'en';
let messages = {};
let fallback = {};
let pluralRules = new Intl.PluralRules('en');
let numberFormat = new Intl.NumberFormat('en');
let locales = [];

/** Picks the best supported locale for a list of BCP 47 tags (e.g. navigator.languages). */
export function negotiateLocale(requested, supported = locales.map((l) => l.id)) {
  for (const raw of requested || []) {
    const tag = String(raw).toLowerCase();
    const exact = supported.find((s) => s.toLowerCase() === tag);
    if (exact) return exact;
    const [lang, region] = tag.split(/[-_]/);
    if (lang === 'pt') return region === 'br' ? 'pt-BR' : 'pt-PT';
    if (lang === 'zh') {
      // Traditional Chinese is not supported yet: only Simplified (mainland / Singapore / "Hans").
      if (!region || ['cn', 'sg', 'hans'].includes(region)) return 'zh-CN';
      continue;
    }
    const base = supported.find((s) => s.toLowerCase() === lang);
    if (base) return base;
  }
  return 'en';
}

/** Loads the catalogs and makes t()/tn() ready. Must run before the workbench modules are imported. */
export async function initNls(baseUrl) {
  locales = await (await fetch(new URL('locales.json', baseUrl))).json();
  const pref = getLocalePreference();
  locale = pref === 'auto' ? negotiateLocale(navigator.languages?.length ? navigator.languages : [navigator.language]) : pref;
  if (!locales.some((l) => l.id === locale)) locale = 'en';
  const load = async (id) => (await fetch(new URL(`${id}.json`, baseUrl))).json();
  [fallback, messages] = await Promise.all([load('en'), locale === 'en' ? Promise.resolve(null) : load(locale)]);
  messages = messages || fallback;
  pluralRules = new Intl.PluralRules(locale);
  numberFormat = new Intl.NumberFormat(locale);
  document.documentElement.lang = locale;
  return locale;
}

export const getLocale = () => locale;
export const getLocales = () => locales;

export function getLocalePreference() {
  try { return localStorage.getItem(PREF_KEY) || 'auto'; } catch { return 'auto'; }
}

/**
 * Saves the language choice and reloads the window (like VS Code, the UI is rebuilt in the new language).
 * The analysis on screen comes back from the catalog (saved analysis); nothing is analyzed again.
 * @param {string} pref 'auto' or a locale id
 */
export function setLocalePreference(pref) {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch { /* storage unavailable */ }
  // The window blocks navigations started by the page, so the reload is asked to the main process.
  if (globalThis.host?.reloadWindow) globalThis.host.reloadWindow();
  else location.reload();
}

/** Clears the flag older versions set before a language reload (they analyzed again after it). */
export function consumeRescanFlag() {
  try {
    const v = sessionStorage.getItem(RESCAN_KEY) === '1';
    sessionStorage.removeItem(RESCAN_KEY);
    return v;
  } catch { return false; }
}

function format(message, params) {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in params)) return m;
    const v = params[name];
    return typeof v === 'number' ? numberFormat.format(v) : String(v);
  });
}

/** Translates a key. Unknown keys return the English text, then the key itself. */
export function t(key, params) {
  return format(messages[key] ?? fallback[key] ?? key, params);
}

/** Plural-aware translation: uses `${key}.${rule}` (zero/one/two/few/many/other), falling back to `.other`. */
export function tn(key, count, params) {
  // CLDR puts 0 in the "one" category for Portuguese, but Brazilian usage prefers the plural for zero.
  const rule = count === 0 && locale === 'pt-BR' ? 'other' : pluralRules.select(count);
  const pick = (cat) => cat[`${key}.${rule}`] ?? cat[`${key}.other`];
  return format(pick(messages) ?? pick(fallback) ?? key, { count, ...params });
}
