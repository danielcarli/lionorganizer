/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Loaded by the background worker only during the end-to-end test (see platform/worker/node/dataWorker.js):
// the folder "Locked" cannot be read, as a protected folder; while the file named by E2E_SLOW_FLAG exists,
// every folder takes a little longer to read, so a background refresh can be watched.
const fs = require('fs');
const path = require('path');

const realOpendir = fs.promises.opendir;
fs.promises.opendir = async (dir, ...rest) => {
  if (path.basename(String(dir)) === 'Locked') throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  if (process.env.E2E_SLOW_FLAG && fs.existsSync(process.env.E2E_SLOW_FLAG)) await new Promise((r) => setTimeout(r, 250));
  return realOpendir.call(fs.promises, dir, ...rest);
};
