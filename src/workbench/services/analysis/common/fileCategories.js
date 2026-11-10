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

// Render and CAD caches: files the programs rebuild by themselves when needed.
const CACHE_EXTS = new Set(['vrmap', 'vrlmap', 'vrst', 'uhdcache', 'ddp', 'udd']); // V-Ray, Corona, Unreal/Twinmotion
const CACHE_DIRS = new Set(['deriveddatacache', 'media cache files', 'media cache', 'peak files', 'collaborationcache', 'paccache', 'shadercache']);
const CACHE_APPS = /twinmotion|lumion|enscape|v-?ray|chaos|corona|d5 ?render|revit|autodesk|adobe|premiere|after effects|unreal|3ds ?max|sketchup/i;
const GENERIC_CACHE = /^(cache|caches|.* cache|cache files|temp|tmp)$/i;
const REVIT_JOURNAL = /^journal\.\d{4}\.(txt|log)$/i;

/** True if the file is a cache of a render/CAD program (by name, or by a cache folder of one of them). */
export function isRenderCache(f) {
  if (CACHE_EXTS.has(f.ext) || REVIT_JOURNAL.test(f.name)) return true;
  if (!f.folder) return false;
  // the folder part only depends on the folder: checked once per folder, not once per file
  let hit = cacheFolders.get(f.folder);
  if (hit === undefined) {
    if (cacheFolders.size > 500000) cacheFolders.clear();
    hit = isCacheFolder(f.folder);
    cacheFolders.set(f.folder, hit);
  }
  return hit;
}

const cacheFolders = new Map();

function isCacheFolder(folder) {
  const segs = folder.split(/[\\/]/);
  let app = false;
  for (const seg of segs) {
    const low = seg.toLowerCase();
    if (CACHE_DIRS.has(low)) return true;
    if (CACHE_APPS.test(seg)) app = true;
    if (app && (GENERIC_CACHE.test(seg) || low === 'journals')) return true; // e.g. Lumion 2024/Cache, Revit/Journals
  }
  return false;
}

// 0-byte files that are markers some tools need (kept out of the "empty files" group).
const EMPTY_MARKERS = new Set(['.gitkeep', '.keep', '.nomedia', '__init__.py', '.gitignore', '.npmignore', '.placeholder', '.metadata_never_index']);
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
    id: 'renderCache', get label() { return t('cleanupRules.renderCache.label'); }, badge: 'Twinmotion · V-Ray · Adobe',
    get desc() { return t('cleanupRules.renderCache.desc'); },
    test: (f) => isRenderCache(f),
  },
  {
    id: 'emptyFiles', get label() { return t('cleanupRules.emptyFiles.label'); }, badge: '0 B',
    get desc() { return t('cleanupRules.emptyFiles.desc'); },
    test: (f) => f.size === 0 && !EMPTY_MARKERS.has(f.name.toLowerCase()) && !f.name.startsWith('~$'),
  },
  {
    id: 'oldLarge', get label() { return t('cleanupRules.oldLarge.label'); }, get badge() { return t('cleanupRules.oldLarge.badge', { size: formatBytes(OLD_LARGE_MIN) }); },
    get desc() { return t('cleanupRules.oldLarge.desc', { size: formatBytes(OLD_LARGE_MIN) }); },
    test: (f, now) => f.size > OLD_LARGE_MIN && now - f.mtime > 365 * DAY,
  },
];

/** Possible duplicates: same name and same size in different folders. Keeps the oldest one. */
/** Same as findDuplicates, pausing when `pause()` asks (returns null if it was stopped). */
export async function findDuplicatesSliced(files, pause) {
  const bySize = new Map();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.size >= 1024) {
      const g = bySize.get(f.size);
      if (g === undefined) bySize.set(f.size, f);
      else if (Array.isArray(g)) g.push(f);
      else bySize.set(f.size, [g, f]);
    }
    if ((i & 4095) === 0 && !(await pause())) return null;
  }
  const extras = [];
  let groupCount = 0;
  let k = 0;
  for (const g of bySize.values()) {
    if ((++k & 1023) === 0 && !(await pause())) return null;
    if (!Array.isArray(g)) continue;
    const byName = new Map();
    for (const f of g) {
      const key = f.name.toLowerCase();
      let n = byName.get(key);
      if (!n) byName.set(key, (n = []));
      n.push(f);
    }
    for (const n of byName.values()) {
      if (n.length < 2) continue;
      groupCount++;
      n.sort((a, b) => a.mtime - b.mtime);
      for (let i = 1; i < n.length; i++) extras.push(n[i]);
    }
  }
  return { extras, groupCount };
}

export function findDuplicates(files) {
  // same size first (numbers: cheap), then same name only among those — most files have a unique size
  const bySize = new Map();
  for (const f of files) {
    if (f.size < 1024) continue; // ignore tiny files
    const g = bySize.get(f.size);
    if (g === undefined) bySize.set(f.size, f);
    else if (Array.isArray(g)) g.push(f);
    else bySize.set(f.size, [g, f]);
  }
  const extras = [];
  let groupCount = 0;
  for (const g of bySize.values()) {
    if (!Array.isArray(g)) continue;
    const byName = new Map();
    for (const f of g) {
      const key = f.name.toLowerCase();
      let n = byName.get(key);
      if (!n) byName.set(key, (n = []));
      n.push(f);
    }
    for (const n of byName.values()) {
      if (n.length < 2) continue;
      groupCount++;
      n.sort((a, b) => a.mtime - b.mtime);
      for (let i = 1; i < n.length; i++) extras.push(n[i]); // the first (oldest) copy is left out
    }
  }
  return { extras, groupCount };
}
