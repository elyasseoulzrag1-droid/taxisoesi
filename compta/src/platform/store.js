// Le magasin de données de l'appli : une seule implémentation, écrite contre une petite interface Backend
// (base Claude ou localStorage). Il garde les derniers documents en mémoire, en dérive un instantané
// immuable et prévient ses abonnés. Les écritures sont regroupées par document et sérialisées par chemin.
import { isValidISO, monthOf } from "../core/dates.js";
import { newId } from "../core/ids.js";
import { PlatformError, DB_MESSAGES, dbCode, dbError, detailOf } from "./errors.js";
import {
  deepEqual, deepFreeze, diffPatch, isPlainObject, isSafeKey, jsonBytes, jsonClone,
  mergeDeep, mergePatches, prunePatch, stripNulls, utf8Length,
} from "./json.js";

export const DUMP_FORMAT = "starringyou-compta";
export const DUMP_VERSION = 1;
export { diffPatch } from "./json.js";

const COLLECTIONS = ["config", "ledger", "stats", "audit", "meta"];
const DOC_LIMIT_BYTES = 256 * 1024;
// {"v":1,"month":"2026-11","ops":{}} fait 36 octets : on garde un peu de marge.
const EMPTY_DOC_BYTES = 48;
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);
const MONTH_RE = /^\d{4}-\d{2}$/;

const DEFAULTS = {
  readOnly: false,
  loadTimeoutMs: 10000,       // au-delà : stale (contrat db : limiter le chargement dans le temps)
  writeWaitMs: 10000,         // attente maximale d'une réponse définitive de la base avant une écriture
  softLimitBytes: 180 * 1024, // au-dessus : on ouvre un nouveau fragment de mois
  hardLimitBytes: 240 * 1024, // jamais dépassé par une mise à jour sur place
  maxOpBytes: 64 * 1024,
  auditCap: 300,
  ignoredCap: 4000,
  maxConcurrentWrites: 4,
  retryDelayMs: () => 300 + Math.random() * 600,       // "unavailable" : une seule nouvelle tentative
  rateRetryDelayMs: () => 1500 + Math.random() * 1500, // "resource_exhausted" : on ralentit, une seule fois
  now: () => new Date().toISOString(),
};

const delayOf = (value) => Math.max(0, typeof value === "function" ? value() : Number(value) || 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const monthOfDoc = (docId) => docId.slice(0, 7);
/** Octets pris par une entrée `"id":{...},` dans la map d'un document. */
const entryBytes = (id, value) => utf8Length(id) + jsonBytes(value) + 4;

function compareOps(a, b) {
  const da = String(a.date || ""), db = String(b.date || "");
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Entre deux copies de la même opération (deux documents), laquelle garder : la plus récente, de façon déterministe. */
function preferCopy(a, b) {
  const ua = String(a.raw.updatedAt || a.raw.createdAt || "");
  const ub = String(b.raw.updatedAt || b.raw.createdAt || "");
  if (ua !== ub) return ua > ub ? a : b;
  const homeA = monthOf(a.raw.date) === monthOfDoc(a.docId);
  const homeB = monthOf(b.raw.date) === monthOfDoc(b.docId);
  if (homeA !== homeB) return homeA ? a : b;
  return a.docId >= b.docId ? a : b;
}

/**
 * Crée le store.
 * @param {object} backend { listen(collection, onDocs, onError) -> unsubscribe, set(path, data), update(path, data), delete(path) }
 *   onDocs reçoit la collection entière : (docs: [{ id, data }], { fromCache: boolean }). update() rejette
 *   { code: "invalid_argument" } si le document n'existe pas et fusionne récursivement, comme la base Claude.
 * @param {object} [options] voir DEFAULTS (readOnly, loadTimeoutMs, softLimitBytes, auditCap, retryDelayMs, now...)
 */
export function createStore(backend, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const cols = {};
  for (const name of COLLECTIONS) {
    cols[name] = { name, docs: new Map(), loaded: false, confirmed: false, error: null, unsubscribe: null, waiters: [], dirty: true };
  }
  const listeners = new Set();
  const cleanCache = new WeakMap();
  let readOnly = !!opts.readOnly;
  let closed = false;
  let timerFired = false;
  let loadTimer = null;
  let snapshot = null;
  let lastBuilt = null;
  let delivered = null;
  let notifyQueued = false;
  let activeWrites = 0;
  const writeSlots = [];
  // Vues dérivées, recalculées seulement quand leur collection a changé.
  let ledger = { ops: EMPTY_ARRAY, loc: new Map(), extra: new Map() };
  let statsByMonth = EMPTY_OBJECT;
  let audit = EMPTY_ARRAY;
  let ignored = EMPTY_OBJECT;

  // ---------------------------------------------------------------- documents en mémoire

  function recOf(col, id) {
    const map = cols[col].docs;
    let rec = map.get(id);
    if (!rec) {
      rec = { col, id, path: col + "/" + id, base: undefined, entries: [], view: undefined, bytes: -1, running: false };
      map.set(id, rec);
    }
    return rec;
  }

  /** Effet d'une écriture sur un document (undefined = document absent). */
  function applyEntry(value, entry) {
    if (entry.kind === "delete") return undefined;
    if (entry.kind === "set") return entry.data;
    return value === undefined ? stripNulls(entry.data) : mergeDeep(value, entry.data);
  }

  /** Recalcule la vue (dernier état connu + écritures en attente). Marque la collection si elle a changé. */
  function refresh(rec) {
    let view = rec.base;
    for (const entry of rec.entries) view = applyEntry(view, entry);
    if (view === rec.view || deepEqual(view, rec.view)) return false;
    rec.view = view;
    rec.bytes = -1;
    cols[rec.col].dirty = true;
    scheduleNotify();
    return true;
  }

  function docBytes(rec) {
    if (rec.view === undefined) return 0;
    if (rec.bytes < 0) rec.bytes = jsonBytes(rec.view);
    return rec.bytes;
  }

  // ---------------------------------------------------------------- abonnements à la base

  function onDocs(col, list, meta) {
    if (closed) return;
    const state = cols[col];
    const seen = new Set();
    for (const item of list || []) {
      if (!item || typeof item.id !== "string" || !isPlainObject(item.data)) continue;
      seen.add(item.id);
      const rec = recOf(col, item.id);
      if (rec.base !== item.data) {
        rec.base = deepFreeze(item.data);
        refresh(rec);
      }
    }
    for (const rec of state.docs.values()) {
      if (rec.base !== undefined && !seen.has(rec.id)) {
        rec.base = undefined;
        refresh(rec);
      }
    }
    state.loaded = true;
    state.confirmed = !(meta && meta.fromCache);
    if (state.confirmed) for (const waiter of state.waiters.splice(0)) waiter.resolve();
    updateLoadState();
    scheduleNotify();
  }

  function onError(col, raw) {
    if (closed) return;
    const state = cols[col];
    const err = dbError(raw);
    state.error = Object.freeze({ code: err.code, message: err.message });
    state.confirmed = false;
    state.unsubscribe = null;
    if (err.detail) console.warn("[store] abonnement " + col + " interrompu : " + err.detail);
    for (const waiter of state.waiters.splice(0)) waiter.reject(new PlatformError(err.code, err.message));
    updateLoadState();
    scheduleNotify();
  }

  function listen(col) {
    const state = cols[col];
    state.error = null;
    try {
      state.unsubscribe = backend.listen(col, (list, meta) => onDocs(col, list, meta), (err) => onError(col, err));
    } catch (err) {
      onError(col, err);
    }
  }

  function firstError() {
    for (const name of COLLECTIONS) if (cols[name].error) return cols[name].error;
    return null;
  }

  const mainConfirmed = () => cols.config.confirmed && cols.ledger.confirmed;

  function updateLoadState() {
    if (mainConfirmed() || firstError()) {
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
      if (mainConfirmed()) timerFired = false;
      return;
    }
    if (loadTimer || timerFired || closed) return;
    loadTimer = setTimeout(() => {
      loadTimer = null;
      timerFired = true;
      scheduleNotify();
    }, opts.loadTimeoutMs);
    if (loadTimer && typeof loadTimer.unref === "function") loadTimer.unref();
  }

  /** Attend que la base ait répondu pour de bon sur cette collection (sinon on risquerait d'écraser un document inconnu). */
  function waitConfirmed(col) {
    const state = cols[col];
    if (closed) return Promise.reject(new PlatformError("closed", DB_MESSAGES.closed));
    if (state.confirmed) return Promise.resolve();
    if (state.error) return Promise.reject(new PlatformError(state.error.code, state.error.message));
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      const timer = setTimeout(() => {
        const at = state.waiters.indexOf(waiter);
        if (at >= 0) state.waiters.splice(at, 1);
        reject(new PlatformError("offline", DB_MESSAGES.offline));
      }, opts.writeWaitMs);
      if (timer && typeof timer.unref === "function") timer.unref();
      state.waiters.push(waiter);
    });
  }

  // ---------------------------------------------------------------- instantané et abonnés

  function scheduleNotify() {
    snapshot = null;
    if (notifyQueued || closed) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      if (closed) return;
      const snap = getSnapshot();
      if (snap === delivered) return;
      delivered = snap;
      for (const listener of [...listeners]) {
        try { listener(snap); } catch (err) { console.error("[store] un abonné a échoué", err); }
      }
    });
  }

  function cleanOp(id, raw) {
    let clean = cleanCache.get(raw);
    if (!clean) {
      clean = stripNulls(raw);
      if (clean.id !== id) clean = Object.freeze({ ...clean, id });
      cleanCache.set(raw, clean);
    }
    return clean;
  }

  /** Index du grand livre : opérations vivantes, document qui porte chacune, copies en trop. */
  function ledgerIndex() {
    const state = cols.ledger;
    if (!state.dirty) return ledger;
    state.dirty = false;
    const loc = new Map();
    const extra = new Map();
    for (const docId of [...state.docs.keys()].sort()) {
      const view = state.docs.get(docId).view;
      const map = view && isPlainObject(view.ops) ? view.ops : null;
      if (!map) continue;
      for (const id of Object.keys(map)) {
        const raw = map[id];
        if (!isPlainObject(raw) || !isSafeKey(id)) continue; // null = opération supprimée
        const candidate = { docId, raw };
        const current = loc.get(id);
        if (!current) { loc.set(id, candidate); continue; }
        const winner = preferCopy(current, candidate);
        const loser = winner === current ? candidate : current;
        loc.set(id, winner);
        if (!extra.has(id)) extra.set(id, []);
        extra.get(id).push(loser.docId);
      }
    }
    const ops = [];
    for (const [id, { raw }] of loc) ops.push(cleanOp(id, raw));
    ops.sort(compareOps);
    const same = ops.length === ledger.ops.length && ops.every((op, i) => op === ledger.ops[i]);
    ledger = { ops: same ? ledger.ops : Object.freeze(ops), loc, extra };
    return ledger;
  }

  function locationsOf(index, id) {
    const out = [];
    const current = index.loc.get(id);
    if (current) out.push(current.docId);
    for (const docId of index.extra.get(id) || []) if (!out.includes(docId)) out.push(docId);
    return out;
  }

  function deriveStats() {
    const state = cols.stats;
    if (!state.dirty) return statsByMonth;
    state.dirty = false;
    const out = {};
    for (const docId of [...state.docs.keys()].sort()) {
      const view = state.docs.get(docId).view;
      if (!isPlainObject(view) || !MONTH_RE.test(docId)) continue;
      out[docId] = stripNulls(view);
    }
    const keys = Object.keys(out);
    const same = keys.length === Object.keys(statsByMonth).length && keys.every((k) => out[k] === statsByMonth[k]);
    if (!same) statsByMonth = Object.freeze(out);
    return statsByMonth;
  }

  function deriveAudit() {
    const state = cols.audit;
    if (!state.dirty) return audit;
    state.dirty = false;
    const out = [];
    for (const rec of state.docs.values()) {
      const map = rec.view && isPlainObject(rec.view.entries) ? rec.view.entries : null;
      if (!map) continue;
      for (const id of Object.keys(map)) if (isPlainObject(map[id])) out.push(cleanOp(id, map[id]));
    }
    out.sort((a, b) => {
      const ta = String(a.at || ""), tb = String(b.at || "");
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const same = out.length === audit.length && out.every((e, i) => e === audit[i]);
    if (!same) audit = Object.freeze(out);
    return audit;
  }

  function deriveIgnored() {
    const state = cols.meta;
    if (!state.dirty) return ignored;
    state.dirty = false;
    const view = state.docs.get("ignored") && state.docs.get("ignored").view;
    const hashes = view && isPlainObject(view.hashes) ? stripNulls(view.hashes) : EMPTY_OBJECT;
    if (!deepEqual(hashes, ignored)) ignored = hashes;
    return ignored;
  }

  /** Instantané courant (objet gelé ; le même tant que rien n'a changé). */
  function getSnapshot() {
    if (snapshot) return snapshot;
    const error = firstError();
    const loaded = cols.config.loaded && cols.ledger.loaded;
    const configRec = cols.config.docs.get("main");
    const next = {
      ready: loaded || timerFired || !!error,
      loaded,
      stale: (timerFired || !!error) && !mainConfirmed(),
      error,
      readOnly,
      config: (configRec && configRec.view) || null,
      ops: ledgerIndex().ops,
      statsByMonth: deriveStats(),
      audit: deriveAudit(),
      ignored: deriveIgnored(),
    };
    cols.config.dirty = false;
    const unchanged = lastBuilt && Object.keys(next).every((key) => next[key] === lastBuilt[key]);
    snapshot = unchanged ? lastBuilt : Object.freeze(next);
    lastBuilt = snapshot;
    return snapshot;
  }

  // ---------------------------------------------------------------- file d'écriture (une à la fois par document)

  async function acquireSlot() {
    if (activeWrites < opts.maxConcurrentWrites) { activeWrites++; return; }
    await new Promise((resolve) => writeSlots.push(resolve)); // le créneau est transmis par releaseSlot
  }

  function releaseSlot() {
    const next = writeSlots.shift();
    if (next) next(); else activeWrites--;
  }

  /**
   * Met une écriture en file pour un document. L'effet est visible tout de suite dans l'instantané (écho local) ;
   * si la base refuse, l'écho est retiré et la promesse est rejetée avec une PlatformError.
   * `after` : promesse à attendre avant d'écrire (pour ordonner deux documents entre eux).
   */
  function enqueue(rec, kind, data, after = null) {
    const last = rec.entries[rec.entries.length - 1];
    if (kind === "update" && !after && last && last.kind === "update" && !last.started && !last.after) {
      const merged = mergePatches(last.data, data);
      if (merged) {
        last.data = merged;
        refresh(rec);
        return last.promise;
      }
    }
    const entry = { kind, data, after, started: false };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    rec.entries.push(entry);
    refresh(rec);
    pump(rec);
    return entry.promise;
  }

  async function pump(rec) {
    if (rec.running) return;
    rec.running = true;
    while (rec.entries.length && !closed) {
      const entry = rec.entries[0];
      entry.started = true;
      let failure = null;
      try {
        if (entry.after) await entry.after;
        await acquireSlot();
        try { await execute(rec, entry); } finally { releaseSlot(); }
      } catch (err) {
        failure = err;
      }
      if (rec.entries[0] !== entry) break; // le store a été fermé entre-temps
      rec.entries.shift();
      if (failure) {
        refresh(rec); // retire l'écho local
        entry.reject(failure instanceof PlatformError ? failure : dbError(failure));
      } else {
        rec.base = applyEntry(rec.base, entry);
        refresh(rec);
        entry.resolve();
      }
    }
    rec.running = false;
  }

  async function execute(rec, entry) {
    let kind = entry.kind;
    let data = entry.data;
    if (kind === "update" && rec.base === undefined) {
      // Le document n'existe pas (ou sa création vient d'échouer) : update() serait refusé, on l'écrit en entier.
      kind = "set";
      data = stripNulls(data);
    }
    const call = () => (kind === "delete" ? backend.delete(rec.path) : backend[kind](rec.path, data));
    try {
      await call();
    } catch (first) {
      const code = dbCode(first);
      const delay = code === "unavailable" ? opts.retryDelayMs : code === "resource_exhausted" ? opts.rateRetryDelayMs : null;
      if (delay === null) throw classify(first, rec, entry);
      await sleep(delayOf(delay));
      try { await call(); } catch (second) { throw classify(second, rec, entry); }
    }
  }

  function classify(raw, rec, entry) {
    const code = dbCode(raw);
    if (code !== "invalid_argument") return dbError(raw);
    const result = applyEntry(rec.base, entry);
    if (result !== undefined && jsonBytes(result) > DOC_LIMIT_BYTES - 1024) {
      return new PlatformError("too_large", DB_MESSAGES.too_large, { detail: detailOf(raw) });
    }
    // Contrat db : un écrit bien formé refusé avec invalid_argument = ce visiteur n'a pas le droit d'écrire.
    setReadOnly(true);
    return new PlatformError("read_only", DB_MESSAGES.read_only, { detail: detailOf(raw) });
  }

  function setReadOnly(flag) {
    if (readOnly === !!flag) return;
    readOnly = !!flag;
    scheduleNotify();
  }

  function assertWritable() {
    if (closed) throw new PlatformError("closed", DB_MESSAGES.closed);
    if (readOnly) throw new PlatformError("read_only", DB_MESSAGES.read_only);
  }

  function assertFits(rec, patch) {
    if (jsonBytes(mergeDeep(rec.view, patch)) > opts.hardLimitBytes) {
      throw new PlatformError("too_large", DB_MESSAGES.too_large);
    }
  }

  function cleanObject(value, message) {
    const clean = isPlainObject(value) ? jsonClone(value) : null;
    if (!isPlainObject(clean)) throw new PlatformError("invalid", message);
    return deepFreeze(clean);
  }

  // ---------------------------------------------------------------- écritures publiques

  async function saveConfig(patch) {
    assertWritable();
    const clean = cleanObject(patch, "Réglages invalides : rien n'a été enregistré.");
    await waitConfirmed("config");
    assertWritable();
    const rec = recOf("config", "main");
    if (rec.view === undefined) {
      return enqueue(rec, "set", stripNulls(deepFreeze({ v: 1, ...clean })));
    }
    const effective = prunePatch(rec.view, clean);
    if (effective === undefined) return undefined;
    assertFits(rec, effective);
    return enqueue(rec, "update", deepFreeze(effective));
  }

  function cleanOps(input) {
    if (!Array.isArray(input)) throw new PlatformError("invalid_op", "Liste d'opérations invalide : rien n'a été enregistré.");
    const byId = new Map();
    for (const raw of input) {
      const op = isPlainObject(raw) ? stripNulls(deepFreeze(jsonClone(raw))) : null;
      if (!op || !isSafeKey(op.id) || !isValidISO(op.date)) {
        throw new PlatformError("invalid_op", "Opération invalide : il manque un identifiant ou une date valide. Rien n'a été enregistré.");
      }
      if (entryBytes(op.id, op) > opts.maxOpBytes) {
        const label = String(op.label || op.id).slice(0, 60);
        throw new PlatformError("too_large", "L'opération « " + label + " » est trop volumineuse. Raccourcis la note ou retire des détails, puis réessaie.");
      }
      byId.set(op.id, op);
    }
    return [...byId.values()];
  }

  /** Répartit des opérations dans des documents de mois neufs (import complet). */
  function layoutLedger(ops) {
    const docs = new Map();
    const sizes = new Map();
    for (const op of [...ops].sort(compareOps)) {
      const month = monthOf(op.date);
      const size = entryBytes(op.id, op);
      for (let n = 1; ; n++) {
        const docId = n === 1 ? month : month + "." + n;
        const used = sizes.get(docId) || EMPTY_DOC_BYTES;
        if (used + size > opts.softLimitBytes && used > EMPTY_DOC_BYTES) continue;
        if (!docs.has(docId)) docs.set(docId, { v: 1, month, ops: {} });
        docs.get(docId).ops[op.id] = op;
        sizes.set(docId, used + size);
        break;
      }
    }
    return docs;
  }

  async function putOps(input) {
    assertWritable();
    const list = cleanOps(input);
    if (!list.length) return;
    await waitConfirmed("ledger");
    assertWritable();
    const index = ledgerIndex();
    const plan = new Map(); // docId -> { puts: Map(id -> op), tombs: Set(id) }
    const slot = (docId) => {
      if (!plan.has(docId)) plan.set(docId, { puts: new Map(), tombs: new Set() });
      return plan.get(docId);
    };
    const projected = new Map();
    const bytesOf = (docId) => {
      if (!projected.has(docId)) {
        const rec = cols.ledger.docs.get(docId);
        projected.set(docId, rec && rec.view !== undefined ? docBytes(rec) : EMPTY_DOC_BYTES);
      }
      return projected.get(docId);
    };
    for (const op of list) {
      const month = monthOf(op.date);
      const size = entryBytes(op.id, op);
      const current = index.loc.get(op.id);
      let target = null;
      if (current && monthOfDoc(current.docId) === month) {
        // Même mois : on met à jour sur place, sauf si le document deviendrait trop gros.
        const next = bytesOf(current.docId) - entryBytes(op.id, current.raw) + size;
        if (next <= opts.hardLimitBytes) { target = current.docId; projected.set(target, next); }
      }
      for (let n = 1; !target; n++) {
        const docId = n === 1 ? month : month + "." + n;
        if (current && docId === current.docId) continue;
        const used = bytesOf(docId);
        if (used + size <= opts.softLimitBytes || used <= EMPTY_DOC_BYTES) {
          target = docId;
          projected.set(docId, used + size);
        }
      }
      slot(target).puts.set(op.id, op);
      // L'opération quitte son ancien document (mois changé, fragment plein) : on y laisse une marque de suppression.
      for (const docId of locationsOf(index, op.id)) if (docId !== target) slot(docId).tombs.add(op.id);
    }
    const first = [];
    for (const [docId, item] of plan) {
      if (!item.puts.size) continue;
      const rec = recOf("ledger", docId);
      if (rec.view === undefined) {
        const ops = {};
        for (const [id, op] of item.puts) ops[id] = op;
        first.push(enqueue(rec, "set", deepFreeze({ v: 1, month: monthOfDoc(docId), ops })));
        continue;
      }
      const existing = isPlainObject(rec.view.ops) ? rec.view.ops : EMPTY_OBJECT;
      let patch = null;
      for (const [id, op] of item.puts) {
        // update() fusionne : un champ retiré de l'opération doit être écrit à null.
        const delta = isPlainObject(existing[id]) ? diffPatch(existing[id], op) : op;
        if (delta !== undefined) (patch ??= {})[id] = delta;
      }
      if (patch) first.push(enqueue(rec, "update", deepFreeze({ ops: patch })));
    }
    const second = [];
    let gate = null;
    for (const [docId, item] of plan) {
      const ids = [...item.tombs].filter((id) => !item.puts.has(id));
      const rec = recOf("ledger", docId);
      if (!ids.length || rec.view === undefined) continue;
      if (!gate && first.length) {
        // On n'efface l'ancienne copie qu'une fois la nouvelle enregistrée : jamais d'opération perdue en route.
        gate = Promise.all(first);
        gate.catch(() => {});
      }
      const patch = {};
      for (const id of ids) patch[id] = null;
      second.push(enqueue(rec, "update", deepFreeze({ ops: patch }), gate));
    }
    await Promise.all([...first, ...second]);
  }

  async function deleteOps(ids) {
    assertWritable();
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(isSafeKey))];
    if (!list.length) return;
    await waitConfirmed("ledger");
    assertWritable();
    const index = ledgerIndex();
    const perDoc = new Map();
    for (const id of list) {
      for (const docId of locationsOf(index, id)) {
        if (!perDoc.has(docId)) perDoc.set(docId, {});
        perDoc.get(docId)[id] = null;
      }
    }
    await Promise.all([...perDoc].map(([docId, patch]) => enqueue(recOf("ledger", docId), "update", deepFreeze({ ops: patch }))));
  }

  async function putStats(month, patch) {
    assertWritable();
    if (!MONTH_RE.test(String(month))) throw new PlatformError("invalid", "Mois invalide pour les statistiques : rien n'a été enregistré.");
    const clean = cleanObject(patch, "Statistiques invalides : rien n'a été enregistré.");
    await waitConfirmed("stats");
    assertWritable();
    const rec = recOf("stats", month);
    if (rec.view === undefined) {
      return enqueue(rec, "set", stripNulls(deepFreeze({ v: 1, ...clean, month })));
    }
    const effective = prunePatch(rec.view, clean);
    if (effective === undefined) return undefined;
    assertFits(rec, effective);
    return enqueue(rec, "update", deepFreeze(effective));
  }

  /** Journal des modifications : au mieux, ne rejette jamais. */
  async function addAudit(entry) {
    try {
      if (readOnly || closed || !isPlainObject(entry)) return;
      const clean = stripNulls(deepFreeze(jsonClone(entry)));
      const at = typeof clean.at === "string" && /^\d{4}-\d{2}-\d{2}/.test(clean.at) ? clean.at : opts.now();
      const id = isSafeKey(clean.id) ? clean.id : newId("au");
      const record = Object.freeze({ ...clean, id, at });
      await waitConfirmed("audit");
      if (readOnly) return;
      const month = at.slice(0, 7);
      const rec = recOf("audit", month);
      if (rec.view === undefined) {
        await enqueue(rec, "set", deepFreeze({ v: 1, month, entries: { [id]: record } }));
        return;
      }
      const map = isPlainObject(rec.view.entries) ? rec.view.entries : EMPTY_OBJECT;
      const live = Object.keys(map).filter((key) => isPlainObject(map[key]) && key !== id)
        .sort((a, b) => {
          const ta = String(map[a].at || ""), tb = String(map[b].at || "");
          return ta !== tb ? (ta < tb ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
        });
      const overflow = Math.max(0, live.length + 1 - opts.auditCap);
      const tombstones = Object.keys(map).length - live.length;
      if (tombstones + overflow > opts.auditCap) {
        // Trop de marques de suppression accumulées : on réécrit le document au propre.
        const entries = {};
        for (const key of live.slice(overflow)) entries[key] = stripNulls(map[key]);
        entries[id] = record;
        await enqueue(rec, "set", deepFreeze({ v: 1, month, entries }));
        return;
      }
      const patch = { [id]: record };
      for (const key of live.slice(0, overflow)) patch[key] = null;
      await enqueue(rec, "update", deepFreeze({ entries: patch }));
    } catch (err) {
      console.warn("[store] journal non enregistré : " + detailOf(err));
    }
  }

  /** Mémorise des lignes de relevé à ne plus proposer (date = jour de la décision). date null : les oublier. */
  async function setIgnored(hashes, date) {
    assertWritable();
    const list = [...new Set((Array.isArray(hashes) ? hashes : [hashes]).filter(isSafeKey))];
    if (!list.length) return undefined;
    const value = date === null ? null : isValidISO(date) ? date : opts.now().slice(0, 10);
    await waitConfirmed("meta");
    assertWritable();
    const rec = recOf("meta", "ignored");
    const patch = {};
    for (const hash of list) patch[hash] = value;
    if (rec.view === undefined) {
      if (value === null) return undefined;
      return enqueue(rec, "set", deepFreeze({ v: 1, hashes: patch }));
    }
    const current = isPlainObject(rec.view.hashes) ? rec.view.hashes : EMPTY_OBJECT;
    if (Object.keys(current).length + list.length > opts.ignoredCap) {
      // Document proche de sa limite : on ne garde que les décisions les plus récentes.
      const merged = stripNulls(mergeDeep(current, deepFreeze(patch)));
      const keep = Object.keys(merged)
        .sort((a, b) => (merged[a] === merged[b] ? (a < b ? -1 : 1) : merged[a] < merged[b] ? 1 : -1))
        .slice(0, Math.floor(opts.ignoredCap * 0.75));
      const next = {};
      for (const key of keep) next[key] = merged[key];
      return enqueue(rec, "set", deepFreeze({ v: 1, hashes: next }));
    }
    const effective = prunePatch(rec.view, { hashes: patch });
    if (effective === undefined) return undefined;
    return enqueue(rec, "update", deepFreeze(effective));
  }

  // ---------------------------------------------------------------- sauvegarde et restauration

  async function waitLoaded(names) {
    try {
      await Promise.all(names.map(waitConfirmed));
    } catch (err) {
      // Hors connexion : on exporte ce qu'on a déjà reçu plutôt que rien.
      if (!names.every((name) => cols[name].loaded)) throw err;
    }
  }

  async function exportAll() {
    await waitLoaded(["config", "ledger", "stats", "meta"]);
    const snap = getSnapshot();
    return jsonClone({
      format: DUMP_FORMAT,
      version: DUMP_VERSION,
      exportedAt: opts.now(),
      config: snap.config ? stripNulls(snap.config) : null,
      ops: snap.ops,
      statsByMonth: snap.statsByMonth,
      ignored: snap.ignored,
    });
  }

  function readDump(dump) {
    if (!isPlainObject(dump) || dump.format !== DUMP_FORMAT) {
      throw new PlatformError("bad_dump", "Ce fichier n'est pas une sauvegarde de Compta StarringYou.");
    }
    if (Number(dump.version) > DUMP_VERSION) {
      throw new PlatformError("bad_dump", "Cette sauvegarde vient d'une version plus récente de l'appli : mets la page à jour avant de l'importer.");
    }
    const ops = new Map();
    for (const raw of Array.isArray(dump.ops) ? dump.ops : []) {
      const op = isPlainObject(raw) ? stripNulls(deepFreeze(jsonClone(raw))) : null;
      if (op && isSafeKey(op.id) && isValidISO(op.date) && entryBytes(op.id, op) <= opts.maxOpBytes) ops.set(op.id, op);
    }
    const stats = {};
    if (isPlainObject(dump.statsByMonth)) {
      for (const month of Object.keys(dump.statsByMonth)) {
        if (MONTH_RE.test(month) && isPlainObject(dump.statsByMonth[month])) stats[month] = deepFreeze(jsonClone(dump.statsByMonth[month]));
      }
    }
    const hashes = {};
    if (isPlainObject(dump.ignored)) {
      for (const hash of Object.keys(dump.ignored)) if (isSafeKey(hash) && isValidISO(dump.ignored[hash])) hashes[hash] = dump.ignored[hash];
    }
    return {
      config: isPlainObject(dump.config) ? deepFreeze(jsonClone(dump.config)) : null,
      ops: [...ops.values()],
      stats,
      ignored: isPlainObject(dump.ignored) ? hashes : null,
    };
  }

  /**
   * Restaure une sauvegarde. replace true : le grand livre, les statistiques et les réglages sont remplacés.
   * replace false : fusion (les opérations de même identifiant sont mises à jour, le reste est gardé).
   */
  async function importAll(dump, { replace = false } = {}) {
    assertWritable();
    const data = readDump(dump);
    if (!replace) {
      if (data.config) await saveConfig(data.config);
      await putOps(data.ops);
      for (const month of Object.keys(data.stats)) await putStats(month, data.stats[month]);
      const byDate = new Map();
      for (const hash of Object.keys(data.ignored || {})) {
        const date = data.ignored[hash];
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(hash);
      }
      for (const [date, hashes] of byDate) await setIgnored(hashes, date);
      return { ops: data.ops.length };
    }
    await Promise.all(["config", "ledger", "stats", "meta"].map(waitConfirmed));
    assertWritable();
    const sets = [];
    const layout = layoutLedger(data.ops);
    for (const [docId, doc] of layout) sets.push(enqueue(recOf("ledger", docId), "set", deepFreeze(doc)));
    for (const month of Object.keys(data.stats)) {
      sets.push(enqueue(recOf("stats", month), "set", stripNulls(deepFreeze({ v: 1, ...data.stats[month], month }))));
    }
    if (data.config) sets.push(enqueue(recOf("config", "main"), "set", stripNulls(data.config)));
    if (data.ignored) sets.push(enqueue(recOf("meta", "ignored"), "set", deepFreeze({ v: 1, hashes: data.ignored })));
    // Les anciens documents ne sont supprimés qu'une fois les nouveaux écrits.
    const gate = Promise.all(sets);
    gate.catch(() => {});
    const removals = [];
    for (const rec of cols.ledger.docs.values()) {
      if (rec.view !== undefined && !layout.has(rec.id)) removals.push(enqueue(rec, "delete", null, gate));
    }
    for (const rec of cols.stats.docs.values()) {
      if (rec.view !== undefined && !(rec.id in data.stats)) removals.push(enqueue(rec, "delete", null, gate));
    }
    await Promise.all([...sets, ...removals]);
    return { ops: data.ops.length };
  }

  // ---------------------------------------------------------------- cycle de vie

  function subscribe(listener) {
    listeners.add(listener);
    try { listener(getSnapshot()); } catch (err) { console.error("[store] un abonné a échoué", err); }
    return () => { listeners.delete(listener); };
  }

  /** Attend la fin de toutes les écritures en cours (réussies ou non). */
  async function flush() {
    for (;;) {
      const pending = [];
      for (const name of COLLECTIONS) {
        for (const rec of cols[name].docs.values()) for (const entry of rec.entries) pending.push(entry.promise.catch(() => {}));
      }
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  /** Relance les abonnements interrompus par une erreur (bouton "Réessayer"). */
  function retry() {
    if (closed) return;
    for (const name of COLLECTIONS) {
      if (cols[name].error) listen(name);
    }
    timerFired = false;
    updateLoadState();
    scheduleNotify();
  }

  function close() {
    if (closed) return;
    closed = true;
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    for (const name of COLLECTIONS) {
      const state = cols[name];
      try { if (state.unsubscribe) state.unsubscribe(); } catch { /* déjà coupé */ }
      state.unsubscribe = null;
      for (const waiter of state.waiters.splice(0)) waiter.reject(new PlatformError("closed", DB_MESSAGES.closed));
      for (const rec of state.docs.values()) {
        for (const entry of rec.entries.splice(0)) entry.reject(new PlatformError("closed", DB_MESSAGES.closed));
      }
    }
    listeners.clear();
  }

  for (const name of COLLECTIONS) listen(name);
  updateLoadState();

  return {
    subscribe, getSnapshot,
    saveConfig, putOps, deleteOps, putStats, addAudit, setIgnored,
    exportAll, importAll,
    setReadOnly, flush, retry, close,
    get kind() { return backend.kind || "custom"; },
  };
}
