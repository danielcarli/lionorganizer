/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// File actions shared by all views (show in Explorer, Recycle Bin, export).
// Moving to the Recycle Bin is delegated to OperationsService, which requires the confirmation code.
import { formatBytes, formatDate, joinPath } from '../../../../base/common/format.js';
import { CATEGORY_BY_ID } from '../../analysis/common/fileCategories.js';
import { t } from '../../../../base/common/nls.js';

export class FileActionsService {
  constructor({ host, analysis, scan, notifications, layout, operations }) {
    Object.assign(this, { host, analysis, scan, notifications, layout, operations });
  }

  get explorerName() {
    const p = this.host.platform;
    return t('common.explorer.' + (p === 'win32' || p === 'darwin' ? p : 'other'));
  }

  async openFolderAndScan() {
    const folder = await this.scan.pickFolder();
    if (folder) this.scan.scan(folder);
  }

  async reveal(path) {
    const ok = await this.host.reveal(path);
    if (!ok) this.notifications.warn(t('actions.revealFailed'));
  }

  revealFolder(rel) {
    return this.reveal(joinPath(this.analysis.root, rel));
  }

  /** Deletion: always goes through the code confirmation (OperationsService). */
  trash(files) {
    return this.operations.trash(files);
  }

  async exportCsv(files) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['name', 'folder', 'type', 'extension', 'sizeBytes', 'size', 'modified', 'fullPath'].map((k) => t('actions.csv.' + k));
    const rows = [header.map(esc).join(';')];
    for (const f of files) {
      rows.push([f.name, f.folder || '.', CATEGORY_BY_ID[f.cat].label, f.ext, f.size, formatBytes(f.size), formatDate(f.mtime), f.path].map(esc).join(';'));
    }
    const saved = await this.host.saveCsv(t('actions.csv.fileName'), rows.join('\r\n'));
    if (saved) this.notifications.info(t('actions.exported', { path: saved }));
  }
}
