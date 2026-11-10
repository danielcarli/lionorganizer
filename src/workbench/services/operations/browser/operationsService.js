/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Runs operations that change files, always in 2 steps:
// prepare in the main process → modal with a typed code → execute.
// Then updates the analysis model and notifies the other parts.
import { Emitter } from '../../../../base/common/event.js';
import { formatBytes } from '../../../../base/common/format.js';
import { t, tn } from '../../../../base/common/nls.js';

export class OperationsService {
  #onDidRun = new Emitter();
  onDidRun = this.#onDidRun.event;

  constructor({ host, analysis, notifications, confirmation }) {
    Object.assign(this, { host, analysis, notifications, confirmation });
  }

  /** Recycle Bin (deletion). Always asks for the code, for 1 or many files. */
  async trash(files) {
    if (!files?.length) return null;
    const res = await this.#run('trash', { paths: files.map((f) => f.path) });
    if (!res) return null;
    if (res.removed.length) {
      this.analysis.removeFiles(res.removed);
      this.notifications.info(tn('ops.trashed', res.removed.length, { size: formatBytes(res.bytes) }));
    }
    this.#warnFailed(res.failed, 'ops.failed.trash');
    return res;
  }

  /** @param {{src:string,dst:string}[]} moves */
  async organize(moves) {
    const res = await this.#run('organize', { moves });
    if (!res) return null;
    this.#applyMoved(res, 'organize');
    return res;
  }

  /** @param {{src:string,name:string}[]} renames */
  async rename(renames) {
    const res = await this.#run('rename', { renames });
    if (!res) return null;
    this.#applyMoved(res, 'rename');
    return res;
  }

  async undo(opId) {
    const res = await this.#run('undo', { opId });
    if (!res) return null;
    this.analysis.applyMoves(res.moved);
    this.notifications.info(tn('ops.undone', res.moved.length));
    this.#warnFailed(res.failed, 'ops.failed.undo');
    return res;
  }

  async clearCatalog() {
    const res = await this.#run('catalogClear', {});
    if (res) this.notifications.info(t('ops.catalogCleared'));
    return res;
  }

  async #run(kind, payload) {
    let view;
    try {
      view = await this.host.ops.prepare(kind, payload);
    } catch (err) {
      this.notifications.warn(cleanError(err));
      return null;
    }
    const result = await this.confirmation.confirm(view, (code) => this.host.ops.commit(view.id, code));
    if (!result) { this.host.ops.cancel(view.id); return null; }
    this.#onDidRun.fire({ kind, result });
    return result;
  }

  /** @param {'organize'|'rename'} kind */
  #applyMoved(res, kind) {
    if (res.moved.length) {
      this.analysis.applyMoves(res.moved);
      this.notifications.info(tn('ops.moved.' + kind, res.moved.length), 9000, res.opId ? { label: t('ops.undo'), run: () => this.undo(res.opId) } : null);
    }
    this.#warnFailed(res.failed, 'ops.failed.' + kind);
  }

  /** @param {string} key plural message key for "N files could not be …" */
  #warnFailed(failed, key) {
    if (failed?.length) this.notifications.warn(tn(key, failed.length));
  }
}

export function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
