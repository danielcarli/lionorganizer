/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Builds the release assets consumed by the lightweight installers (scripts/install.*):
//   lionorganizer-<version>.tar.gz / .zip  the app source bundle (no Electron, a few MB)
//   manifest.txt                           version, Electron version and bundle names
//   install.sh / install.ps1 / install.cmd the installers
//   SHA256SUMS                             checksums of everything above
// Archives are reproducible: sorted entries, fixed timestamps (SOURCE_DATE_EPOCH) and permissions.
// Usage: node tools/make-release.js [--tag vX.Y.Z] [--out dist-release]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const version = pkg.version;
const electron = lock.packages?.['node_modules/electron']?.version;
const tag = arg('--tag', `v${version}`);
const outDir = path.resolve(ROOT, arg('--out', 'dist-release'));
const epoch = Number(process.env.SOURCE_DATE_EPOCH || Date.UTC(2026, 0, 1) / 1000);

if (tag !== `v${version}`) fail(`Tag ${tag} does not match package.json version ${version}.`);
if (!/^\d+\.\d+\.\d+$/.test(electron || '')) fail('Exact Electron version not found in package-lock.json.');

// ------------------------------------------------------------------ files in the app bundle
const INCLUDE = ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'src', 'build/icon.ico', 'build/icons'];
function collect(rel, out = []) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) for (const name of fs.readdirSync(abs).sort()) collect(path.posix.join(rel, name), out);
  else out.push(rel);
  return out;
}
const files = INCLUDE.flatMap((r) => collect(r)).sort();
const prefix = `lionorganizer-${version}`;
const entries = files.map((rel) => ({ name: `${prefix}/${rel}`, data: fs.readFileSync(path.join(ROOT, rel)) }));

// ------------------------------------------------------------------ tar.gz (ustar)
function tarGz(list) {
  const blocks = [];
  const dirs = new Set();
  for (const e of list) {
    const parts = e.name.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/');
  }
  const all = [...[...dirs].sort().map((d) => ({ name: d, dir: true, data: Buffer.alloc(0) })), ...list].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of all) {
    const h = Buffer.alloc(512);
    let name = e.name;
    let pre = '';
    if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf('/', 154); pre = name.slice(0, cut); name = name.slice(cut + 1); }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(pre) > 155) fail(`Path too long for tar: ${e.name}`);
    h.write(name, 0);
    h.write(e.dir ? '0000755\0' : '0000644\0', 100);
    h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(e.data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(epoch.toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148);
    h.write(e.dir ? '5' : '0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    h.write('root', 265); h.write('root', 297);
    h.write(pre, 345);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h);
    if (!e.dir) { blocks.push(e.data); const pad = (512 - (e.data.length % 512)) % 512; if (pad) blocks.push(Buffer.alloc(pad)); }
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

// ------------------------------------------------------------------ zip (deflate)
function zip(list) {
  const d = new Date(epoch * 1000);
  const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of list) {
    const name = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = zlib.crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x0314, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ------------------------------------------------------------------ write the release
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const tarName = `lionorganizer-${version}.tar.gz`;
const zipName = `lionorganizer-${version}.zip`;
fs.writeFileSync(path.join(outDir, tarName), tarGz(entries));
fs.writeFileSync(path.join(outDir, zipName), zip(entries));
fs.writeFileSync(path.join(outDir, 'manifest.txt'), [
  'name=LionOrganizer',
  `version=${version}`,
  `tag=${tag}`,
  `electron=${electron}`,
  `source_tar=${tarName}`,
  `source_zip=${zipName}`,
  '',
].join('\n'));
for (const f of ['install.sh', 'install.ps1', 'install.cmd']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(outDir, f));
fs.chmodSync(path.join(outDir, 'install.sh'), 0o755);

const assets = fs.readdirSync(outDir).filter((f) => f !== 'SHA256SUMS').sort();
const sums = assets.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, f))).digest('hex')}  ${f}`);
fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), sums.join('\n') + '\n');

for (const f of [...assets, 'SHA256SUMS']) {
  const kb = (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(1);
  console.log(`${f.padEnd(34)} ${kb.padStart(9)} KB`);
}
console.log(`\nLionOrganizer ${version} · Electron ${electron} · ${entries.length} files → ${path.relative(ROOT, outDir)}`);

function fail(msg) { console.error(`make-release: ${msg}`); process.exit(1); }
