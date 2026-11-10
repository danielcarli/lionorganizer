/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Size of the disk (volume) that holds the analyzed folder: total, used and free, as the system reports
// them. Lets the UI compare "space analyzed" with "space used on the disk" and explain the difference.
const fs = require('fs');
const path = require('path');

/**
 * @param {string} root
 * @returns {Promise<{ total: number, used: number, free: number, isVolumeRoot: boolean, volume: string } | null>}
 */
async function diskInfo(root) {
  try {
    const st = await fs.promises.statfs(root);
    const total = Number(st.blocks) * Number(st.bsize);
    if (!total) return null;
    const used = (Number(st.blocks) - Number(st.bfree)) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    const top = path.parse(root).root;
    // the analyzed folder is the whole disk: a drive root (C:\, /) or a mount point (/Volumes/USB, /mnt/data)
    let isVolumeRoot = root === top;
    if (!isVolumeRoot) {
      const [a, b] = await Promise.all([fs.promises.stat(root), fs.promises.stat(path.dirname(root))]);
      isVolumeRoot = a.dev !== b.dev;
    }
    return { total, used, free, isVolumeRoot, volume: process.platform === 'win32' ? top : (isVolumeRoot ? root : '') };
  } catch {
    return null; // not available here (network drive without statfs, old system…): the UI just skips it
  }
}

module.exports = { diskInfo };
