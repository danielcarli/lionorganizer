/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// UI access to the catalog (SQLite database in the main process).
import { Emitter } from '../../../../base/common/event.js';
import { cleanError } from '../../operations/browser/operationsService.js';

export class CatalogService {
  #onDidChange = new Emitter();
  onDidChange = this.#onDidChange.event;
  status = { available: false, error: null };

  constructor({ host, analysis, operations }) {
    this.host = host;
    host.catalog.status().then((s) => { this.status = s; this.#onDidChange.fire(); });
    analysis.onDidChangeData(() => { if (analysis.result?.catalog?.recorded) this.#onDidChange.fire(); });
    operations.onDidRun(() => this.#onDidChange.fire());
  }

  get available() { return this.status.available; }

  #call(fn) {
    return fn().catch((err) => { throw new Error(cleanError(err)); });
  }

  stats() { return this.#call(() => this.host.catalog.stats()); }
  search(opts) { return this.#call(() => this.host.catalog.search(opts)); }
  history(root) { return this.#call(() => this.host.catalog.history(root)); }
  compare(scanId) { return this.#call(() => this.host.catalog.compare(scanId)); }
  operations() { return this.#call(() => this.host.catalog.operations()); }
  exportCsv() { return this.#call(() => this.host.catalog.exportCsv()); }
  revealDb() { return this.#call(() => this.host.catalog.revealDb()); }
}
