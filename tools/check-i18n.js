/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Checks the message catalogs:
//  • every literal key used in t('…') / tn('…') exists in en.json (plurals need .one/.other)
//  • every locale has the same keys as en.json and keeps the same {placeholders}
//  • reports keys in en.json that no code references (informational)
// Usage: node tools/check-i18n.js   (exit code 1 when something is wrong)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NLS = path.join(ROOT, 'src', 'nls');
const en = JSON.parse(fs.readFileSync(path.join(NLS, 'en.json'), 'utf8'));
const locales = JSON.parse(fs.readFileSync(path.join(NLS, 'locales.json'), 'utf8')).map((l) => l.id);
let problems = 0;
const report = (msg) => { problems++; console.log('✗', msg); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// 1) keys used in code
const used = new Set();
const prefixes = new Set();
for (const file of walk(path.join(ROOT, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\b(tn?)\(\s*'([^']+)'(\s*\+)?/g)) {
    const [, fn, key, concat] = m;
    if (concat) { prefixes.add(key); continue; }
    used.add(key);
    if (fn === 'tn') {
      if (!(`${key}.other` in en)) report(`${path.relative(ROOT, file)}: plural key "${key}" has no ".other"`);
      if (!(`${key}.one` in en)) report(`${path.relative(ROOT, file)}: plural key "${key}" has no ".one"`);
    } else if (!(key in en)) {
      report(`${path.relative(ROOT, file)}: missing key "${key}"`);
    }
  }
  // template-literal keys: t(`ns.${x}`)
  for (const m of src.matchAll(/\btn?\(\s*`([^`$]+)\$\{/g)) prefixes.add(m[1]);
}

// 2) locales: same keys, same placeholders
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const pluralBase = (k) => k.replace(/\.(zero|one|two|few|many|other)$/, '');
for (const id of locales.filter((l) => l !== 'en')) {
  const file = path.join(NLS, `${id}.json`);
  if (!fs.existsSync(file)) { report(`${id}.json does not exist`); continue; }
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(en)) {
    const isPlural = /\.(one|other)$/.test(k);
    if (!(k in cat)) {
      // CJK and other languages without a "one" form may legitimately omit ".one"
      if (isPlural && k.endsWith('.one') && `${pluralBase(k)}.other` in cat && new Intl.PluralRules(id).resolvedOptions().pluralCategories.indexOf('one') < 0) continue;
      report(`${id}: missing "${k}"`);
      continue;
    }
    // plural variants may omit {count}; everything else must keep the same placeholders
    const a = placeholders(en[k]).split(',').filter((p) => !(isPlural && p === 'count')).join(',');
    const b = placeholders(cat[k]).split(',').filter((p) => !(isPlural && p === 'count')).join(',');
    if (a !== b) report(`${id}: placeholders differ in "${k}" (en: {${a}} · ${id}: {${b}})`);
  }
  for (const k of Object.keys(cat)) {
    if (!(k in en) && !(`${pluralBase(k)}.other` in en)) report(`${id}: extra key "${k}"`);
  }
}

// 3) unused (informational)
const unused = Object.keys(en).filter((k) => !used.has(k) && !used.has(pluralBase(k)) && ![...prefixes].some((p) => k.startsWith(p)));
console.log(`${Object.keys(en).length} keys in en.json · ${locales.length} locales · ${unused.length} keys not referenced literally`);
if (unused.length) console.log('  (dynamic or unused):', unused.slice(0, 40).join(', '), unused.length > 40 ? '…' : '');
console.log(problems ? `${problems} problem(s)` : 'i18n OK');
process.exit(problems ? 1 : 0);
