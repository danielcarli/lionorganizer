/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Native dialogs (open folder, save CSV, save the AI report). They run in the main process.
// Delete confirmations use the typed code instead (OperationsMainService).
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { t } = require('../../nls/common/nls');

class DialogMainService {
  registerChannels(ipc) {
    ipc.handle('dialog:pickFolder', (e) => this.pickFolder(BrowserWindow.fromWebContents(e.sender)));
    ipc.handle('dialog:saveCsv', (e, suggestedName, content) =>
      this.saveCsv(BrowserWindow.fromWebContents(e.sender), suggestedName, content));
    ipc.handle('dialog:saveReport', (e, suggestedName, content) =>
      this.saveReport(BrowserWindow.fromWebContents(e.sender), suggestedName, content));
  }

  async pickFolder(win) {
    const res = await dialog.showOpenDialog(win, {
      title: t('main.dialog.pickFolder.title'),
      properties: ['openDirectory'],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  }

  async saveCsv(win, suggestedName, content) {
    if (typeof content !== 'string') return null;
    const res = await dialog.showSaveDialog(win, {
      title: t('main.dialog.saveCsv.title'),
      defaultPath: String(suggestedName || 'files.csv'),
      filters: [{ name: t('main.dialog.filters.csv'), extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    // BOM so Excel detects the UTF-8 encoding (accented characters).
    await fs.promises.writeFile(res.filePath, '﻿' + content, 'utf8');
    return res.filePath;
  }

  /** Markdown report for an AI (plain UTF-8 text). */
  async saveReport(win, suggestedName, content) {
    if (typeof content !== 'string' || content.length > 20 * 1024 * 1024) return null;
    const res = await dialog.showSaveDialog(win, {
      title: t('main.dialog.saveReport.title'),
      defaultPath: String(suggestedName || 'report.md'),
      filters: [{ name: t('main.dialog.filters.markdown'), extensions: ['md'] }, { name: t('main.dialog.filters.text'), extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, content, 'utf8');
    return res.filePath;
  }
}

module.exports = { DialogMainService };
