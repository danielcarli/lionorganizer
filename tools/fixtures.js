/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Disposable folders used by the end-to-end test and by the documentation screenshots.
// Large files are created as sparse files (no real disk usage); files that must be real
// duplicates get random content so the SHA-256 comparison has something to compare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const DAY = 86400000;

function ensureEmpty(root) {
  if (fs.existsSync(root) && fs.readdirSync(root).length) {
    throw new Error(`Refusing to use a non-empty folder: ${root}`);
  }
  fs.mkdirSync(root, { recursive: true });
}

function writer(root) {
  const put = (rel, data, ageDays = 0) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (typeof data === 'number') {
      const fd = fs.openSync(p, 'w');
      fs.ftruncateSync(fd, data); // sparse: apparent size only
      fs.closeSync(fd);
    } else {
      fs.writeFileSync(p, data);
    }
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(p, t, t);
  };
  return put;
}

const rnd = (n) => crypto.randomBytes(n);

/** Small, exact fixture for the end-to-end test (the assertions depend on these names). */
function createTestFolder(root) {
  ensureEmpty(root);
  const put = writer(root);
  const render = rnd(6 * MB);
  const plan = rnd(900 * KB);
  const photo = rnd(3 * MB);
  put('Theater/Renders/render-facade.png', render, 20);
  put('Theater/Renders/render-facade (1).png', render, 5); // identical copy
  put('Downloads/render-facade.png', render, 2); // another copy
  put('Theater/Plans/ground-floor.dwg', plan, 30);
  put('Backup/ground-floor-final.dwg', plan, 1); // same content, different name
  put('Theater/Plans/section.dwg', rnd(900 * KB), 30); // same size, different content
  const edges = rnd(2 * MB);
  put('Test/same-edges-A.bin', edges, 3);
  const b = Buffer.from(edges);
  b[MB] ^= 0xff; // same first/last 64 KB, different middle
  put('Test/same-edges-B.bin', b, 3);
  put('Photos/IMG_0001.jpg', photo, 400);
  put('Photos/Phone/IMG_0001.jpg', photo, 10);
  put('Documents/contract.pdf', rnd(200 * KB), 300);
  put('Video/walkthrough.mp4', rnd(12 * MB), 15);
  for (let i = 1; i <= 8; i++) put(`Loose/photo-${String(i).padStart(2, '0')}.jpg`, rnd((50 + i * 37) * KB), 50 + i);
  put('Loose/report.docx', rnd(80 * KB), 7);
  put('Loose/budget.xlsx', rnd(40 * KB), 7);
  put('Loose/model.skp', rnd(2 * MB), 4);
  put('Loose/model.skb', rnd(2 * MB), 4);
  put('Loose/song.mp3', rnd(1 * MB), 90);
  put('Loose/readme.txt', Buffer.from('hello'), 1);
  // 1.1.5: render caches, an empty file, empty folders, a folder the system "refuses" (see e2e.js), node_modules
  put('Renders/Lumion 2024/Cache/frame-0001.cache', rnd(310 * KB), 12);
  put('Renders/scene-light.vrmap', rnd(420 * KB), 12);
  put('Documents/empty-notes.txt', Buffer.alloc(0), 6);
  fs.mkdirSync(path.join(root, 'Empty', 'Deep', 'Deeper'), { recursive: true });
  fs.mkdirSync(path.join(root, 'EmptyOne'), { recursive: true });
  put('Locked/secret.txt', rnd(10 * KB), 3);
  put('Code/node_modules/left-pad/index.js', rnd(12 * KB), 8);
  put('Code/app.js', rnd(9 * KB), 8);
}

/** Realistic folder for the README screenshots: an architecture student's drive. */
function createDemoFolder(root) {
  ensureEmpty(root);
  const put = writer(root);
  let n = 7; // keeps sparse sizes unique so they never look like duplicates
  const big = (bytes) => Math.round(bytes) + (n += 4093);

  // Projects
  put('Projects/Theater Studio/Video/walkthrough-final.mp4', big(2.4 * GB), 15);
  put('Projects/Theater Studio/Video/walkthrough-draft.mp4', big(1.9 * GB), 60);
  put('Projects/Theater Studio/Video/drone-site.mov', big(1.2 * GB), 120);
  for (let i = 1; i <= 6; i++) put(`Projects/Theater Studio/Renders/render-${String(i).padStart(2, '0')}.png`, big((38 + i * 6) * MB), 20 + i);
  put('Projects/Theater Studio/Renders/render-facade.psd', big(860 * MB), 18);
  put('Projects/Theater Studio/Model/theater.skp', big(420 * MB), 4);
  put('Projects/Theater Studio/Model/theater.skb', big(418 * MB), 4);
  put('Projects/Theater Studio/Model/theater~.skp', big(401 * MB), 30);
  put('Projects/Theater Studio/Revit/theater.rvt', big(610 * MB), 3);
  for (let i = 1; i <= 5; i++) put(`Projects/Theater Studio/Revit/theater.000${i}.rvt`, big((560 + i * 8) * MB), 40 - i * 6);
  put('Projects/Theater Studio/Drawings/site-plan.dwg', big(48 * MB), 25);
  put('Projects/Theater Studio/Drawings/site-plan.bak', big(47 * MB), 25);
  put('Projects/Theater Studio/Drawings/site-plan_1_1_6281.sv$', big(46 * MB), 25);
  for (let i = 1; i <= 4; i++) put(`Projects/Theater Studio/Boards/board-0${i}.pdf`, big((90 + i * 12) * MB), 6);
  put('Projects/Housing Competition/model.3dm', big(780 * MB), 200);
  put('Projects/Housing Competition/model.ifc', big(330 * MB), 210);
  for (let i = 1; i <= 8; i++) put(`Projects/Housing Competition/Renders/view-${i}.jpg`, big((22 + i * 3) * MB), 190);
  put('Projects/Housing Competition/presentation.pptx', big(240 * MB), 185);
  put('Projects/Urban Studio/survey.dwg', big(96 * MB), 400);
  put('Projects/Urban Studio/maps.zip', big(1.4 * GB), 420);

  // Real duplicates (random content, a few MB each)
  const render = rnd(7 * MB);
  put('Projects/Theater Studio/Renders/render-hero.png', render, 21);
  put('Backups/Theater/render-hero.png', render, 5);
  put('Downloads/render-hero (1).png', render, 2);
  const board = rnd(5 * MB);
  put('Projects/Theater Studio/Boards/final-board.pdf', board, 6);
  put('Desktop dump/final-board (copy).pdf', board, 3);
  const photo = rnd(4 * MB);
  put('Photos/Lisbon 2024/IMG_2041.jpg', photo, 600);
  put('Photos/Phone backup/IMG_2041.jpg', photo, 90);
  const dwg = rnd(3 * MB);
  put('Projects/Urban Studio/base-map.dwg', dwg, 380);
  put('Backups/Urban/base-map-v2.dwg', dwg, 200);

  // Photos
  for (let i = 1; i <= 40; i++) put(`Photos/Lisbon 2024/IMG_${2000 + i}.jpg`, big((3 + (i % 5)) * MB), 600 - i);
  put('Photos/Lisbon 2024/timelapse.mp4', big(3.1 * GB), 590);
  for (let i = 1; i <= 25; i++) put(`Photos/Phone backup/VID_${1000 + i}.mp4`, big((60 + i * 9) * MB), 80);

  // Downloads
  put('Downloads/AutoCAD_2026_Setup.exe', big(2.2 * GB), 400);
  put('Downloads/V-Ray_7_installer.msi', big(780 * MB), 350);
  put('Downloads/Windows_ISO.iso', big(5.4 * GB), 700);
  put('Downloads/textures-pack.zip', big(1.6 * GB), 300);
  put('Downloads/lecture-recording.mp4.crdownload', big(640 * MB), 120);
  put('Downloads/references.pdf', big(34 * MB), 40);

  // Backups, music, documents
  put('Backups/university-2024.zip', big(6.8 * GB), 500);
  put('Backups/Theater/theater-backup.skp', big(410 * MB), 45);
  for (let i = 1; i <= 30; i++) put(`Music/Playlist/track-${String(i).padStart(2, '0')}.mp3`, big((6 + (i % 7)) * MB), 900);
  put('Documents/thesis-draft.docx', big(18 * MB), 12);
  put('Documents/budget.xlsx', big(2 * MB), 30);
  put('Documents/portfolio.pdf', big(160 * MB), 50);
  put('Documents/debug.log', big(90 * MB), 2);
  put('Documents/~$thesis-draft.docx', big(162), 1);

  // A messy folder for "Organize by type" and batch rename
  for (let i = 1; i <= 9; i++) put(`Desktop dump/sketch ${i}.jpg`, rnd((120 + i * 20) * KB), 30 + i * 4);
  put('Desktop dump/meeting notes.docx', rnd(60 * KB), 9);
  put('Desktop dump/area-calc.xlsx', rnd(45 * KB), 8);
  put('Desktop dump/facade-study.skp', rnd(1 * MB), 5);
  put('Desktop dump/facade-study.dwg', rnd(800 * KB), 5);
  put('Desktop dump/ambient.mp3', rnd(900 * KB), 50);
  put('Desktop dump/site-visit.mp4', big(310 * MB), 14);
  put('Desktop dump/references.zip', big(120 * MB), 20);
}

module.exports = { createTestFolder, createDemoFolder };
