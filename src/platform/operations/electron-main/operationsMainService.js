/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Operations that change files or data (Recycle Bin, organize, rename, undo, clear catalog).
// Always a two-step flow:
//   1) prepare(kind, payload): validates everything, builds the plan and generates a random CODE;
//   2) commit(id, typedCode): only runs if the typed code matches the generated one.
// The check happens here in the main process, so the UI cannot skip the step.
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { t, tn, formatBytes } = require('../../nls/common/nls');

const ALPHABET = 'ACDEFHJKMNPRTUVWXY34679'; // no ambiguous characters (0/O, 1/I/L, 5/S, 8/B, 2/Z)
const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ITEMS = 50000;
const PREVIEW = 8;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

function newCode() {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return c;
}
const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function exists(p) {
  try { await fs.promises.lstat(p); return true; } catch { return false; }
}

/** True only when the file or one of its folders is really gone (not for "access denied"). */
async function isGone(p) {
  try { await fs.promises.lstat(p); return false; } catch (err) { return err.code === 'ENOENT' || err.code === 'ENOTDIR'; }
}

async function uniquePath(p) {
  if (!(await exists(p))) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 10000; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(c))) return c;
  }
  throw new Error(t('main.ops.errors.noFreeName'));
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) return t('main.ops.name.empty');
  if (name.length > 240) return t('main.ops.name.tooLong');
  if (INVALID_CHARS.test(name)) return t('main.ops.name.invalidChar');
  if (/[. ]$/.test(name)) return t('main.ops.name.trailingDotOrSpace');
  if (WIN_RESERVED.test(name)) return t('main.ops.name.reserved');
  return null;
}

class OperationsMainService {
  constructor(scan, catalog) {
    this.scan = scan;
    this.catalog = catalog;
    this.pending = new Map();
  }

  registerChannels(ipc) {
    ipc.handle('ops:prepare', (_e, kind, payload) => this.prepare(kind, payload || {}));
    ipc.handle('ops:commit', (_e, id, code) => this.commit(id, code));
    ipc.handle('ops:cancel', (_e, id) => { this.pending.delete(id); return true; });
  }

  get db() { return this.catalog.available ? this.catalog.db : null; }

  // ------------------------------------------------------------------ step 1
  async prepare(kind, payload) {
    const planners = {
      trash: () => this.#planTrash(payload),
      organize: () => this.#planOrganize(payload),
      rename: () => this.#planRename(payload),
      undo: () => this.#planUndo(payload),
      catalogClear: () => this.#planCatalogClear(),
    };
    if (!planners[kind]) throw new Error(t('main.ops.errors.unknownOperation'));
    const plan = await planners[kind]();
    for (const [k, v] of this.pending) if (Date.now() > v.expires) this.pending.delete(k);
    const id = crypto.randomUUID();
    const code = newCode();
    this.pending.set(id, { kind, plan, code, expires: Date.now() + TTL_MS, attempts: 0 });
    return { id, code, kind, ...plan.view };
  }

  // ------------------------------------------------------------------ step 2
  async commit(id, typed) {
    const p = this.pending.get(id);
    if (!p) return { ok: false, expired: true, error: t('main.ops.errors.expired') };
    if (Date.now() > p.expires) {
      this.pending.delete(id);
      return { ok: false, expired: true, error: t('main.ops.errors.expired') };
    }
    if (normalizeCode(typed) !== p.code) {
      p.attempts++;
      if (p.attempts >= MAX_ATTEMPTS) {
        this.pending.delete(id);
        return { ok: false, expired: true, error: t('main.ops.errors.tooManyAttempts') };
      }
      return { ok: false, error: t('main.ops.errors.wrongCode'), remaining: MAX_ATTEMPTS - p.attempts };
    }
    this.pending.delete(id);
    const run = {
      trash: () => this.#runTrash(p.plan),
      organize: () => this.#runMoves(p.plan, 'organize'),
      rename: () => this.#runMoves(p.plan, 'rename'),
      undo: () => this.#runUndo(p.plan),
      catalogClear: () => this.#runCatalogClear(),
    }[p.kind];
    const result = await run();
    return { ok: true, kind: p.kind, ...result };
  }

  // ------------------------------------------------------------------ Recycle Bin
  async #planTrash({ paths }) {
    if (!Array.isArray(paths) || !paths.length) throw new Error(t('main.ops.trash.errors.noneSelected'));
    if (paths.length > MAX_ITEMS) throw new Error(t('main.ops.errors.tooManyFiles'));
    const known = [...new Set(paths)].filter((p) => this.scan.isKnownFile(p));
    if (!known.length) throw new Error(t('main.ops.trash.errors.notInScan'));
    // files that no longer exist are left out: there is nothing to move to the Recycle Bin
    const gone = await Promise.all(known.map((p) => isGone(p)));
    const valid = known.filter((_, i) => !gone[i]);
    if (!valid.length) throw new Error(tn('main.ops.trash.errors.allMissing', known.length));
    const bytes = valid.reduce((s, p) => s + (this.scan.files.get(p)?.size || 0), 0);
    const root = this.scan.currentRoot;
    const sizes = Object.fromEntries(valid.map((p) => [p, this.scan.files.get(p)?.size || 0]));
    return {
      paths: valid, bytes, sizes,
      view: {
        title: tn('main.ops.trash.title', valid.length),
        message: tn('main.ops.trash.message', valid.length, { size: formatBytes(bytes) }),
        items: valid.slice(0, PREVIEW).map((p) => ({ label: path.basename(p), detail: path.relative(root, path.dirname(p)) || t('common.rootFolder'), size: this.scan.files.get(p)?.size })),
        more: Math.max(0, valid.length - PREVIEW),
        count: valid.length, bytes,
        confirmLabel: t('common.moveToTrash'), danger: true,
        skipped: paths.length - valid.length,
      },
    };
  }

  async #runTrash(plan) {
    const removed = [];
    const failed = [];
    const missing = [];
    for (const p of plan.paths) {
      try {
        await shell.trashItem(p);
        this.scan.forget(p);
        removed.push(p);
      } catch {
        // deleted or moved in the meantime (e.g. in Explorer) is not the same as "in use"
        if (await isGone(p)) missing.push(p); else failed.push(p);
      }
    }
    const bytes = removed.reduce((s, p) => s + (plan.sizes?.[p] || 0), 0);
    let opId = null;
    if (this.db && removed.length) {
      try {
        this.db.markTrashed(removed);
        opId = this.db.logOperation({ kind: 'trash', root: this.scan.currentRoot, summary: tn('main.ops.trash.summary', removed.length), bytes, items: removed.map((src) => ({ src })) });
      } catch (err) { console.error(err); }
    }
    return { removed, failed, missing, opId, bytes };
  }

  // ------------------------------------------------------------------ Organize by type
  #planOrganize({ moves }) {
    if (!Array.isArray(moves) || !moves.length) throw new Error(t('main.ops.organize.errors.nothing'));
    if (moves.length > MAX_ITEMS) throw new Error(t('main.ops.errors.tooManyFiles'));
    const root = this.scan.currentRoot;
    const seen = new Set();
    const pairs = [];
    for (const m of moves) {
      const src = m?.src;
      const dst = typeof m?.dst === 'string' ? path.resolve(m.dst) : null;
      if (!this.scan.isKnownFile(src) || !dst || seen.has(src)) continue;
      if (!this.scan.isInsideRoot(dst) || path.basename(dst) !== path.basename(src) || dst === src) continue;
      seen.add(src);
      pairs.push({ src, dst });
    }
    if (!pairs.length) throw new Error(t('main.ops.organize.errors.noValidMoves'));
    const folders = [...new Set(pairs.map((p) => path.relative(root, path.dirname(p.dst))))];
    return {
      pairs, twoPhase: false,
      view: {
        title: tn('main.ops.organize.title', pairs.length),
        message: tn('main.ops.organize.message', folders.length, { folders: folders.slice(0, 4).join(', ') + (folders.length > 4 ? '…' : '') }),
        items: pairs.slice(0, PREVIEW).map((p) => ({ label: path.basename(p.src), detail: '→ ' + path.relative(root, path.dirname(p.dst)) })),
        more: Math.max(0, pairs.length - PREVIEW),
        count: pairs.length, bytes: 0,
        confirmLabel: t('main.ops.organize.confirm'), danger: false,
      },
    };
  }

  // ------------------------------------------------------------------ Batch rename
  async #planRename({ renames }) {
    if (!Array.isArray(renames) || !renames.length) throw new Error(t('main.ops.rename.errors.nothing'));
    if (renames.length > MAX_ITEMS) throw new Error(t('main.ops.errors.tooManyFiles'));
    const ci = process.platform === 'win32' || process.platform === 'darwin';
    const key = (p) => (ci ? p.toLowerCase() : p);
    const pairs = [];
    const problems = [];
    const sources = new Set();
    for (const r of renames) {
      const src = r?.src;
      if (!this.scan.isKnownFile(src) || sources.has(src)) continue;
      const err = validateName(r.name);
      if (err) { problems.push(t('main.ops.rename.problemItem', { name: path.basename(src), reason: err })); continue; }
      const dst = path.join(path.dirname(src), r.name);
      if (dst === src) continue;
      sources.add(src);
      pairs.push({ src, dst });
    }
    const srcKeys = new Set(pairs.map((p) => key(p.src)));
    const targets = new Map();
    for (const p of pairs) {
      const k = key(p.dst);
      if (targets.has(k)) problems.push(t('main.ops.rename.problemItem', { name: path.basename(p.dst), reason: t('main.ops.rename.problem.sameName') }));
      targets.set(k, p);
      if (!srcKeys.has(k) && (await exists(p.dst))) problems.push(t('main.ops.rename.problemItem', { name: path.basename(p.dst), reason: t('main.ops.rename.problem.exists') }));
    }
    if (problems.length) throw new Error(t('main.ops.rename.errors.problems', { problems: problems.slice(0, 3).join('; ') + (problems.length > 3 ? '…' : '') }));
    if (!pairs.length) throw new Error(t('main.ops.rename.errors.noChanges'));
    return {
      pairs, twoPhase: true,
      view: {
        title: tn('main.ops.rename.title', pairs.length),
        message: t('main.ops.rename.message'),
        items: pairs.slice(0, PREVIEW).map((p) => ({ label: path.basename(p.src), detail: '→ ' + path.basename(p.dst) })),
        more: Math.max(0, pairs.length - PREVIEW),
        count: pairs.length, bytes: 0,
        confirmLabel: t('main.ops.rename.confirm'), danger: false,
      },
    };
  }

  // ------------------------------------------------------------------ Undo
  async #planUndo({ opId }) {
    if (!this.db) throw new Error(t('main.ops.errors.catalogUnavailable'));
    const op = this.db.operation(Number(opId));
    if (!op || !op.undoable) throw new Error(t('main.ops.undo.errors.notUndoable'));
    if (op.undone_at) throw new Error(t('main.ops.undo.errors.alreadyUndone'));
    const moves = op.items.filter((i) => i.dst && !i.created_dir).reverse();
    const pairs = [];
    const problems = [];
    for (const m of moves) {
      if (!(await exists(m.dst))) { problems.push(t('main.ops.undo.problem.moved', { name: path.basename(m.dst), folder: path.dirname(m.dst) })); continue; }
      if (await exists(m.src)) { problems.push(t('main.ops.undo.problem.exists', { path: m.src })); continue; }
      pairs.push({ src: m.dst, dst: m.src });
    }
    if (!pairs.length) throw new Error(problems.length ? t('main.ops.undo.errors.nothingWithReason', { reason: problems[0] }) : t('main.ops.undo.errors.nothing'));
    return {
      pairs, twoPhase: true, opId: op.id, op,
      createdDirs: op.items.filter((i) => i.created_dir).map((i) => i.src),
      view: {
        title: t('main.ops.undo.title', { summary: op.summary }),
        message: tn('main.ops.undo.message', pairs.length) + (problems.length ? ' ' + tn('main.ops.undo.unrevertable', problems.length) : ''),
        items: pairs.slice(0, PREVIEW).map((p) => ({ label: path.basename(p.src), detail: '→ ' + p.dst })),
        more: Math.max(0, pairs.length - PREVIEW),
        count: pairs.length, bytes: 0,
        confirmLabel: t('main.ops.undo.confirm'), danger: false,
      },
    };
  }

  async #runUndo(plan) {
    const res = await this.#movePairs(plan.pairs, true);
    for (const dir of [...plan.createdDirs].sort((a, b) => b.length - a.length)) {
      try { await fs.promises.rmdir(dir); } catch { /* not empty or already removed */ }
    }
    if (this.db) {
      try {
        this.db.applyMoves(res.moved, this.scan.currentRoot);
        this.db.markUndone(plan.opId);
        this.db.logOperation({ kind: 'undo', root: plan.op.root, summary: t('main.ops.undo.summary', { summary: plan.op.summary }), items: res.moved });
      } catch (err) { console.error(err); }
    }
    return res;
  }

  // ------------------------------------------------------------------ Clear catalog
  #planCatalogClear() {
    if (!this.db) throw new Error(t('main.ops.errors.catalogUnavailable'));
    const s = this.db.stats();
    return {
      view: {
        title: t('main.ops.catalogClear.title'),
        message: t('main.ops.catalogClear.message', { files: tn('common.files', s.files + s.missing), scans: tn('main.ops.catalogClear.scans', s.scans) }),
        items: s.roots.slice(0, PREVIEW).map((r) => ({ label: r.path, detail: tn('main.ops.catalogClear.scans', r.scans) })),
        more: Math.max(0, s.roots.length - PREVIEW),
        count: s.files, bytes: 0,
        confirmLabel: t('main.ops.catalogClear.confirm'), danger: true,
      },
    };
  }

  #runCatalogClear() {
    this.db.clear();
    return {};
  }

  // ------------------------------------------------------------------ moving
  async #runMoves(plan, kind) {
    const root = this.scan.currentRoot;
    const res = await this.#movePairs(plan.pairs, plan.twoPhase);
    let opId = null;
    if (this.db && res.moved.length) {
      try {
        this.db.applyMoves(res.moved, root);
        const summary = kind === 'organize'
          ? tn('main.ops.organize.summary', res.moved.length)
          : tn('main.ops.rename.summary', res.moved.length);
        opId = this.db.logOperation({
          kind, root, summary, undoable: true,
          items: [...res.moved, ...res.createdDirs.map((d) => ({ src: d, createdDir: true }))],
        });
      } catch (err) { console.error(err); }
    }
    return { ...res, opId };
  }

  /** Moves/renames {src,dst} pairs. Two-phase mode avoids collisions (a→b, b→a, or case-only changes). */
  async #movePairs(pairs, twoPhase) {
    const moved = [];
    const failed = [];
    const createdDirs = [];
    const ensureDir = async (dir) => {
      if (await exists(dir)) return;
      const missing = [];
      let d = dir;
      while (!(await exists(d)) && path.dirname(d) !== d) { missing.unshift(d); d = path.dirname(d); }
      await fs.promises.mkdir(dir, { recursive: true });
      createdDirs.push(...missing);
    };

    let staged = pairs.map((p) => ({ ...p, from: p.src }));
    if (twoPhase) {
      const tag = crypto.randomBytes(4).toString('hex');
      const next = [];
      for (const p of staged) {
        const tmp = `${p.src}.lo-${tag}.tmp`;
        try { await fs.promises.rename(p.src, tmp); next.push({ ...p, from: tmp }); } catch { failed.push(p.src); }
      }
      staged = next;
    }
    for (const p of staged) {
      try {
        await ensureDir(path.dirname(p.dst));
        const dst = await uniquePath(p.dst);
        await fs.promises.rename(p.from, dst);
        moved.push({ src: p.src, dst });
        this.scan.moved(p.src, dst);
      } catch {
        // restore the temporary file to its original name, if possible
        if (p.from !== p.src) { try { await fs.promises.rename(p.from, p.src); } catch { /* keeps the temporary name */ } }
        failed.push(p.src);
      }
    }
    return { moved, failed, createdDirs };
  }
}

module.exports = { OperationsMainService, validateName };
