/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// New versions: state shown by the version indicator in the status bar and by the update dialog.
// The check itself runs in the main process (it reads manifest.txt of the latest GitHub release);
// automatic checking can be turned off in the dialog.
import { Emitter } from '../../../../base/common/event.js';

const AUTO_KEY = 'lionorganizer.update.autoCheck';
const FIRST_CHECK_MS = 4000;
const EVERY_MS = 24 * 60 * 60 * 1000;

export class UpdateService {
  #onDidChange = new Emitter();
  onDidChange = this.#onDidChange.event;

  /** @type {'idle'|'checking'|'current'|'available'|'error'} */
  status = 'idle';
  /** last answer of the main process: { current, latest, available, method, checkedAt, ok, error } */
  info = null;
  version = '';

  constructor({ host }) {
    this.host = host;
    host.appInfo().then((i) => { this.version = i.version || ''; this.#onDidChange.fire(); }, () => {});
    if (this.autoCheck) setTimeout(() => this.check(), FIRST_CHECK_MS);
    setInterval(() => { if (this.autoCheck) this.check(); }, EVERY_MS);
  }

  get autoCheck() {
    try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
  }

  set autoCheck(on) {
    try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    this.#onDidChange.fire();
  }

  async check() {
    if (this.status === 'checking' || !this.host.update) return this.info;
    this.status = 'checking';
    this.#onDidChange.fire();
    let info;
    try { info = await this.host.update.check(); } catch (err) { info = { ok: false, error: String(err?.message || err) }; }
    this.info = info;
    if (info.current) this.version = info.current;
    this.status = !info.ok ? 'error' : info.available ? 'available' : 'current';
    this.#onDidChange.fire();
    return info;
  }

  /** @returns {Promise<{ok:boolean, action?:'installer'|'script'|'download', error?:string}>} */
  install() { return this.host.update.install(); }

  openReleasePage() { return this.host.update.openReleasePage(); }
}
