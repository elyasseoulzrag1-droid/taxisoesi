// Backend "mode local" : mêmes règles que la base Claude, mais dans le localStorage de l'appareil.
// Un document = une clé "sy-compta:db:<collection>/<id>". Tout accès au stockage est protégé (il peut lever).
import { deepFreeze, isPlainObject, mergeDeep } from "./json.js";

export const LOCAL_PREFIX = "sy-compta:db:";

/** Stockage de secours en mémoire quand localStorage est indisponible (données perdues au rechargement). */
function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function usableStorage(candidate, prefix) {
  try {
    const storage = candidate || globalThis.localStorage;
    if (!storage) return null;
    const probe = prefix + "__test";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * @param {object} [options] { storage (défaut : localStorage), prefix, target (cible de l'événement "storage", défaut : window) }
 * @returns backend { kind, persistent, listen, set, update, delete }
 */
export function createLocalBackend(options = {}) {
  const prefix = options.prefix || LOCAL_PREFIX;
  let storage = usableStorage(options.storage, prefix);
  const persistent = !!storage;
  if (!storage) storage = memoryStorage();
  const cache = new Map();      // chemin -> { raw, data } : un document inchangé garde la même référence
  const listeners = new Map();  // collection -> Set(fonction)
  const queued = new Set();

  const collectionOf = (path) => path.slice(0, path.lastIndexOf("/"));

  function read(path) {
    let raw = null;
    try { raw = storage.getItem(prefix + path); } catch { raw = null; }
    if (raw === null || raw === undefined) { cache.delete(path); return undefined; }
    const hit = cache.get(path);
    if (hit && hit.raw === raw) return hit.data;
    let data;
    try { data = JSON.parse(raw); } catch { data = undefined; }
    if (!isPlainObject(data)) { cache.delete(path); return undefined; }
    deepFreeze(data);
    cache.set(path, { raw, data });
    return data;
  }

  function readCollection(collection) {
    const head = prefix + collection + "/";
    const ids = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (typeof key === "string" && key.startsWith(head) && !key.slice(head.length).includes("/")) ids.push(key.slice(head.length));
      }
    } catch { /* stockage illisible : collection vide */ }
    const docs = [];
    for (const id of ids.sort()) {
      const data = read(collection + "/" + id);
      if (data) docs.push({ id, data });
    }
    return docs;
  }

  function emit(collection) {
    if (queued.has(collection)) return;
    queued.add(collection);
    queueMicrotask(() => {
      queued.delete(collection);
      const set = listeners.get(collection);
      if (!set || !set.size) return;
      const docs = readCollection(collection);
      for (const fn of [...set]) fn(docs, { fromCache: false });
    });
  }

  function write(path, data) {
    const raw = JSON.stringify(data);
    try {
      storage.setItem(prefix + path, raw);
    } catch (err) {
      throw { code: "quota_exceeded", message: "localStorage: " + String((err && err.message) || err) };
    }
    cache.set(path, { raw, data: deepFreeze(JSON.parse(raw)) });
    emit(collectionOf(path));
  }

  // Un autre onglet a écrit : on relit la collection concernée.
  const target = options.target || (typeof window !== "undefined" ? window : null);
  const onStorage = (event) => {
    const key = event && event.key;
    if (key === null || key === undefined) { for (const name of listeners.keys()) emit(name); return; }
    if (typeof key === "string" && key.startsWith(prefix)) emit(collectionOf(key.slice(prefix.length)));
  };
  try { if (target && target.addEventListener) target.addEventListener("storage", onStorage); } catch { /* pas d'événement : tant pis */ }

  return {
    kind: "local",
    persistent,
    listen(collection, onDocs) {
      if (!listeners.has(collection)) listeners.set(collection, new Set());
      const set = listeners.get(collection);
      let active = true;
      const fn = (docs, meta) => { if (active) onDocs(docs, meta); };
      set.add(fn);
      queueMicrotask(() => fn(readCollection(collection), { fromCache: false }));
      return () => { active = false; set.delete(fn); };
    },
    async set(path, data) {
      if (!isPlainObject(data)) throw { code: "invalid_argument", message: "document body must be an object" };
      write(path, data);
    },
    async update(path, data) {
      const current = read(path);
      if (current === undefined) throw { code: "invalid_argument", message: "document does not exist: " + path };
      write(path, mergeDeep(current, deepFreeze(JSON.parse(JSON.stringify(data)))));
    },
    async delete(path) {
      try { storage.removeItem(prefix + path); } catch { /* rien à retirer */ }
      cache.delete(path);
      emit(collectionOf(path));
    },
  };
}
