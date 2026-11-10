/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Main-process side of the background worker (platform/worker/node/dataWorker.js): starts it, sends calls,
// relays progress and cancels. Every call returns a promise, so the main process never waits on disk or
// on the catalog. If the worker stops unexpectedly, the calls in flight fail and a new worker is started.
const { Worker } = require('worker_threads');
const path = require('path');

class DataWorkerHost {
  /** @param {{ dbFile: string, testHook?: string }} opts */
  constructor(opts) {
    this.opts = opts;
    this.nextId = 1;
    this.pending = new Map(); // id → { resolve, reject, onProgress }
    this.info = { available: false, error: null, file: null };
    this.#start();
  }

  #start() {
    this.ready = new Promise((resolve) => { this.#resolveReady = resolve; });
    const w = new Worker(path.join(__dirname, '..', 'node', 'dataWorker.js'), {
      workerData: { dbFile: this.opts.dbFile, testHook: this.opts.testHook || null },
    });
    w.on('message', (m) => this.#onMessage(m));
    w.on('error', (err) => console.error('[data worker]', err));
    w.on('exit', (code) => {
      if (this.worker !== w) return;
      for (const p of this.pending.values()) p.reject(new Error(`background worker stopped (${code})`));
      this.pending.clear();
      if (!this.closing) this.#start(); // keep the app usable
    });
    this.worker = w;
  }

  #resolveReady = null;

  #onMessage(m) {
    if (m.type === 'ready') {
      this.info = { available: m.available, error: m.error, file: m.file };
      this.#resolveReady(this.info);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { p.onProgress?.(m.data); return; }
    this.pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value);
  }

  /**
   * @param {string} method
   * @param {any[]} args
   * @param {{ onProgress?: (data: any) => void, onId?: (id: number) => void }} [opts]
   */
  call(method, args = [], { onProgress, onId } = {}) {
    const id = this.nextId++;
    onId?.(id);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ type: 'call', id, method, args });
    });
  }

  cancel(id) {
    if (id) this.worker.postMessage({ type: 'cancel', id });
  }

  /** Catalog methods, as promises (e.g. await host.db.stats()). */
  get db() {
    return this.#db ||= new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : (...args) => this.call('db', [String(name), args])) });
  }
  #db = null;

  async close() {
    this.closing = true;
    try { await Promise.race([this.call('close'), new Promise((r) => setTimeout(r, 1500))]); } catch { /* already gone */ }
    await this.worker.terminate().catch(() => {});
  }
}

module.exports = { DataWorkerHost };
