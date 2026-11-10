/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// File classification by type and detection of likely disposable files.
// Each type has a fixed color (it follows the type, not the position in the ranking).
// The slot order was validated for color blindness (neighbors stay distinguishable in light and dark).
import { t } from '../../../../base/common/nls.js';
import { formatBytes } from '../../../../base/common/format.js';

export const CATEGORIES = [
  { id: 'cad', get label() { return t('categories.cad'); }, slot: 1, exts: 'dwg dxf dwf dwfx dgn skp rvt rfa rte rft rvz ifc 3dm 3ds max blend fbx obj stl dae gltf glb pln pla tpl vwx lcf plt ctb stb pat lin c4d ma mb usd usdz usdc 3mf step stp iges igs sat ls lsf' },
  { id: 'image', get label() { return t('categories.image'); }, slot: 2, exts: 'jpg jpeg png gif bmp tif tiff webp heic heif raw cr2 cr3 nef arw dng orf rw2 psd psb ai svg ico eps exr hdr tga indd afdesign afphoto xcf' },
  { id: 'doc', get label() { return t('categories.doc'); }, slot: 3, exts: 'pdf doc docx odt rtf txt md xls xlsx xlsm xlsb ods csv ppt pptx odp pages key numbers epub one msg eml' },
  { id: 'archive', get label() { return t('categories.archive'); }, slot: 4, exts: 'zip rar 7z tar gz bz2 xz tgz zst cab' },
  { id: 'program', get label() { return t('categories.program'); }, slot: 5, exts: 'exe msi dll iso img dmg apk sys bin msix appx vhd vhdx pak' },
  { id: 'video', get label() { return t('categories.video'); }, slot: 6, exts: 'mp4 mov avi mkv wmv flv webm m4v mpg mpeg 3gp mts m2ts vob prproj aep veg' },
  { id: 'audio', get label() { return t('categories.audio'); }, slot: 7, exts: 'mp3 wav flac aac ogg m4a wma aiff aif opus mid midi' },
  { id: 'other', get label() { return t('categories.other'); }, slot: 0, exts: '' },
];

const EXT_TO_CAT = new Map();
for (const c of CATEGORIES) for (const e of c.exts.split(' ').filter(Boolean)) EXT_TO_CAT.set(e, c.id);

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const categorize = (ext) => EXT_TO_CAT.get(ext) || 'other';

// Cleanup groups: each one has a rule and a text explaining why.
const DAY = 86400000;
const OLD_LARGE_MIN = 100 * 1024 * 1024;
export const CLEANUP_RULES = [
  {
    id: 'skb', get label() { return t('cleanupRules.skb.label'); }, badge: '.skb',
    get desc() { return t('cleanupRules.skb.desc'); },
    test: (f) => f.ext === 'skb' || /~\.skp$/i.test(f.name),
  },
  {
    id: 'revit', get label() { return t('cleanupRules.revit.label'); }, badge: '.0001.rvt',
    get desc() { return t('cleanupRules.revit.desc'); },
    test: (f) => /\.\d{4}\.(rvt|rfa|rte|rft)$/i.test(f.name),
  },
  {
    id: 'cad', get label() { return t('cleanupRules.cad.label'); }, badge: '.bak .sv$ .dwl',
    get desc() { return t('cleanupRules.cad.desc'); },
    test: (f) => ['sv$', 'dwl', 'dwl2', 'ac$', 'bak', 'bpn', 'old'].includes(f.ext),
  },
  {
    id: 'temp', get label() { return t('cleanupRules.temp.label'); }, badge: '.tmp ~$',
    get desc() { return t('cleanupRules.temp.desc'); },
    test: (f) => ['tmp', 'temp', 'chk', 'gid', 'thumbs'].includes(f.ext) || f.name.startsWith('~$') || /^thumbs\.db$/i.test(f.name),
  },
  {
    id: 'logs', get label() { return t('cleanupRules.logs.label'); }, badge: '.log .dmp',
    get desc() { return t('cleanupRules.logs.desc'); },
    test: (f) => ['log', 'dmp', 'mdmp', 'etl'].includes(f.ext),
  },
  {
    id: 'partial', get label() { return t('cleanupRules.partial.label'); }, badge: '.crdownload .part',
    get desc() { return t('cleanupRules.partial.desc'); },
    test: (f) => ['crdownload', 'part', 'partial', 'download', '!ut'].includes(f.ext),
  },
  {
    id: 'installers', get label() { return t('cleanupRules.installers.label'); }, badge: '.exe .msi .iso',
    get desc() { return t('cleanupRules.installers.desc'); },
    test: (f) => ['exe', 'msi', 'iso', 'dmg', 'msix'].includes(f.ext),
  },
  {
    id: 'oldLarge', get label() { return t('cleanupRules.oldLarge.label'); }, get badge() { return t('cleanupRules.oldLarge.badge', { size: formatBytes(OLD_LARGE_MIN) }); },
    get desc() { return t('cleanupRules.oldLarge.desc', { size: formatBytes(OLD_LARGE_MIN) }); },
    test: (f, now) => f.size > OLD_LARGE_MIN && now - f.mtime > 365 * DAY,
  },
];

/** Possible duplicates: same name and same size in different folders. Keeps the oldest one. */
export function findDuplicates(files) {
  const groups = new Map();
  for (const f of files) {
    if (f.size < 1024) continue; // ignore tiny files
    const key = f.name.toLowerCase() + '|' + f.size;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(f);
  }
  const extras = [];
  let groupCount = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    groupCount++;
    g.sort((a, b) => a.mtime - b.mtime);
    extras.push(...g.slice(1)); // the first (oldest) copy is left out
  }
  return { extras, groupCount };
}
