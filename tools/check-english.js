/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Keeps code, comments and commit messages in English (see CONTRIBUTING.md). Text the user sees in
// other languages belongs in src/nls/*.json (and the installer's own translations), never in code.
//
//   node tools/check-english.js                 scans the source files
//   node tools/check-english.js --message FILE  checks one commit message (used by .githooks/commit-msg)
//   node tools/check-english.js --messages-env  checks the JSON list of messages in $COMMIT_MESSAGES (CI)
//
// A line that must keep another language (a test of the Portuguese UI, a legacy alias) ends with the
// marker "lang-ok" in a comment.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN = ['src', 'tools', 'scripts', '.github', 'installer', 'build', 'package.json', 'start.bat', 'build-installer.bat'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-installer', 'nls', 'info', 'icons', 'screenshots']);
const EXTS = new Set(['.js', '.mjs', '.cjs', '.json', '.css', '.html', '.sh', '.ps1', '.cmd', '.bat', '.yml', '.yaml', '.iss', '.nsh', '.plist']);

// letters used by Portuguese, Spanish, French, Italian and German, but not by English
const ACCENTS = /[áàâãäéèêëíìîïóòôõöúùûüçñœß]/i; // lang-ok
// words that are common in Portuguese (the project's other working language) and never English
const WORDS = /\b(n[ãa]o|voc[êe]|tamb[ée]m|arquivos?|pastas?|usu[áa]rios?|vers[ãa]o|corre[çc][ãa]o|adiciona(?:do|da|r)?|corrige|corrigido|atualiza(?:do|da|r|[çc][ãa]o)|funcionalidades?|melhorias?|ajustes?|exclus[ãa]o|instalador|lixeira|limpeza|quando|porque|ent[ãa]o|tamb[ée]m|para|uma|pelo|pela|seja|isso|esse|essa|est[áa])\b/i; // lang-ok
const MARKER = /lang-ok/;

/** Messages translated into the installer's languages: `brazilianportuguese.Name=...` lines of the .iss. */
const isInstallerTranslation = (file, line) => file.endsWith('.iss') && /^\s*[a-z]+\.[A-Za-z0-9]+=/.test(line);

function problems(text, { file = '', code = true } = {}) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (MARKER.test(line) || (code && isInstallerTranslation(file, line))) return;
    // in code, URLs and file names carry no language
    const plain = code ? line.replace(/https?:\/\/\S+/g, '') : line;
    const m = ACCENTS.exec(plain) || WORDS.exec(plain);
    if (m) out.push({ line: i + 1, word: m[0], text: line.trim().slice(0, 140) });
  });
  return out;
}

function walk(rel, list) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(rel))) return;
    for (const name of fs.readdirSync(full)) walk(path.join(rel, name), list);
  } else if (EXTS.has(path.extname(rel).toLowerCase()) && !rel.includes('package-lock')) list.push(rel);
}

function report(found, what) {
  for (const { where, line, word, text } of found) console.error(`✗ ${where}:${line}  "${word}"  ${text}`);
  if (found.length) {
    console.error(`\n${found.length} line(s) of ${what} are not in English. Write them in English (user-facing text goes in src/nls),`);
    console.error('or, when another language is really needed there, end the line with a "lang-ok" comment.');
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--message') {
  const msg = fs.readFileSync(args[1], 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
  report(problems(msg, { code: false }).map((p) => ({ where: 'commit message', ...p })), 'the commit message');
  console.log('✓ commit message in English');
} else if (args[0] === '--messages-env') {
  let list = [];
  try { list = JSON.parse(process.env.COMMIT_MESSAGES || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = []; // not a push (pull request, release): nothing to check
  const found = [];
  list.filter(Boolean).forEach((msg, k) => {
    for (const p of problems(String(msg), { code: false })) found.push({ where: `commit ${k + 1}`, ...p });
  });
  report(found, 'the commit messages');
  console.log(`✓ ${list.length} commit message(s) in English`);
} else {
  const files = [];
  for (const r of SCAN) walk(r, files);
  const found = [];
  for (const rel of files) {
    for (const p of problems(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { file: rel })) found.push({ where: rel.split(path.sep).join('/'), ...p });
  }
  report(found, 'code or comments');
  console.log(`✓ ${files.length} files: code and comments in English`);
}
