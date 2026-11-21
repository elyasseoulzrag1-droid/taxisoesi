/* Bouchon de développement de `window.claude` : imite en mémoire les capacités d'un Artifact Claude
 * (db, user, assets, downloads, sample) en suivant leurs contrats d'aussi près que possible.
 *
 * Script classique : à injecter AVANT les scripts de la page, par exemple avec Playwright
 *   await page.addInitScript({ path: "dev/mock-claude.js" });
 * Options : définir `window.__mockOptions = { role, can, capabilities, latencyMs, user, people, seed, persist }` avant ce script.
 *   role : "owner" (défaut), "editor", "contributor" (écrit les données, pas de fichiers), "viewer" (lecture seule)
 *   can: null : la plateforme ne dit rien du droit d'écriture ; capabilities : noms servis (défaut : les cinq)
 *   seed : { "config/main": {...} } utilisé quand sessionStorage est vide ; persist: false : rien dans sessionStorage
 * Pilotage depuis un test, par `window.__mock` :
 *   reset()                                   tout effacer (documents, fichiers, journaux, sessionStorage)
 *   db.dump(), db.get(chemin), db.load({...}) lire ou modifier les documents directement
 *   db.writes, db.overlaps                    journal des écritures, écritures simultanées sur un même document
 *   db.failNext(code, nombre, filtre)         faire échouer les prochaines écritures
 *   db.hold, db.cacheOnly, db.refresh()       base injoignable, instantanés "en cache"
 *   setRole(nom)                              changer le niveau du visiteur en cours de route
 *   downloads, downloadDecision               fichiers enregistrés ; "accept", "decline" ou un code d'erreur
 *   sampleCalls, sampleHandler, sampleConsent, sampleLimits   appels à Claude, réponses sur mesure, refus, limites
 *   assets.list(), assets.limits              fichiers envoyés, quotas
 * Référence complète : api/platform.md (section 7).
 * L'état (documents) survit à un rechargement grâce à sessionStorage ; `window.__mock.reset()` l'efface.
 *
 * Se charge aussi dans Node (tests unitaires) : rien n'y est installé globalement, on appelle
 *   const { claude, mock } = globalThis.__createMockClaude({ ... });
 */
(function (root) {
  "use strict";

  const DOC_LIMIT_BYTES = 256 * 1024;
  const MAX_DEPTH = 32;
  const MAX_SUBSCRIPTIONS = 64;
  const STORAGE_KEY = "__mock_claude_state__";
  const SEGMENT_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  const UNSAFE_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  const ASSET_TYPES = [
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "video/mp4", "video/webm", "application/pdf",
    "font/woff2", "font/woff", "font/ttf", "font/otf", "text/csv", "text/markdown", "application/json", "text/plain",
    "text/css", "text/javascript",
  ];
  const DOWNLOAD_EXTENSIONS = (
    "gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig"
  ).split(" ");
  const TEXT_EXTENSIONS = ["txt", "json", "md", "csv", "html", "svg"];
  const ROLES = {
    owner: { isOwner: true, canEdit: true, dataWrite: true, assets: true },
    editor: { isOwner: false, canEdit: true, dataWrite: true, assets: true },
    contributor: { isOwner: false, canEdit: false, dataWrite: true, assets: false },
    viewer: { isOwner: false, canEdit: false, dataWrite: false, assets: false },
  };
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  const META_CACHE = Object.freeze({ fromCache: true, hasPendingWrites: false });

  // ------------------------------------------------------------ petits outils

  const fail = (code, message) => ({ code: code, message: message || code });
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.keys(value).forEach((key) => deepFreeze(value[key]));
    }
    return value;
  }

  function byteLength(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  function depthOf(value) {
    if (value === null || typeof value !== "object") return 0;
    let max = 0;
    const items = Array.isArray(value) ? value : Object.keys(value).map((k) => value[k]);
    for (const item of items) max = Math.max(max, depthOf(item));
    return max + 1;
  }

  /** Fusion de update() : les objets se fusionnent récursivement, le reste (tableaux compris) remplace. */
  function merge(target, patch) {
    const out = {};
    Object.keys(target).forEach((key) => { out[key] = target[key]; });
    Object.keys(patch).forEach((key) => {
      if (UNSAFE_KEYS[key]) return;
      const value = patch[key];
      out[key] = isObject(value) && isObject(target[key]) ? merge(target[key], value) : value;
    });
    return out;
  }

  function compareValues(a, b) {
    if (a === b) return 0;
    if (typeof a === typeof b) return a < b ? -1 : a > b ? 1 : 0;
    return typeof a < typeof b ? -1 : 1;
  }

  // ------------------------------------------------------------ fabrique

  function createMockClaude(options) {
    options = options || {};
    const later = (fn, ms) => setTimeout(fn, ms || 0);
    const served = options.capabilities || ["db", "user", "assets", "downloads", "sample"];
    let roleName = ROLES[options.role] ? options.role : "owner";
    const role = () => ROLES[roleName];

    let storage = null;
    if (options.persist !== false) {
      try {
        storage = root.sessionStorage || null;
        if (storage) storage.getItem(STORAGE_KEY);
      } catch (e) {
        storage = null;
      }
    }

    // ---------------------------------------------------------- db

    const docs = new Map();        // chemin -> corps gelé
    const listeners = new Set();
    const snapCache = new Map();   // chemin -> { data, snap }
    const inflight = new Map();
    const leases = new Map();
    let injected = [];
    let deliveryQueued = false;
    let idCounter = 0;

    const dbControl = {
      writes: [],          // journal : { op, path, ok, code, bytes }
      overlaps: 0,         // écritures lancées sur un document alors qu'une autre y était encore en cours
      latencyMs: Number(options.latencyMs) || 0,
      hold: false,         // true : la base "ne répond pas" (aucun instantané livré)
      cacheOnly: false,    // true : les instantanés sont marqués fromCache
      /** Fait échouer les prochaines écritures : failNext("unavailable"), failNext("quota_exceeded", 2, (op, path) => ...). */
      failNext(code, count, match) { injected.push({ code: code, count: count || 1, match: match || null }); },
      dump() {
        const out = {};
        Array.from(docs.keys()).sort().forEach((path) => { out[path] = clone(docs.get(path)); });
        return out;
      },
      get(path) { return docs.has(path) ? clone(docs.get(path)) : undefined; },
      /** Remplace ou ajoute des documents sans passer par les règles : load({ "config/main": {...} }). */
      load(map) {
        Object.keys(map || {}).forEach((path) => {
          if (map[path] === null) docs.delete(path); else docs.set(path, deepFreeze(clone(map[path])));
        });
        persist();
        scheduleDelivery();
      },
      /** Force une nouvelle livraison à tous les abonnés (après avoir changé hold ou cacheOnly). */
      refresh() {
        listeners.forEach((l) => { l.started = false; });
        scheduleDelivery();
      },
    };

    function persist() {
      if (!storage) return;
      try {
        const out = {};
        docs.forEach((data, path) => { out[path] = data; });
        storage.setItem(STORAGE_KEY, JSON.stringify({ docs: out }));
      } catch (e) { /* stockage plein ou interdit : l'état reste en mémoire */ }
    }

    function restore() {
      let loaded = false;
      if (storage) {
        try {
          const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
          if (saved && isObject(saved.docs)) {
            Object.keys(saved.docs).forEach((path) => docs.set(path, deepFreeze(saved.docs[path])));
            loaded = true;
          }
        } catch (e) { /* état illisible : on repart de zéro */ }
      }
      if (!loaded && isObject(options.seed)) {
        Object.keys(options.seed).forEach((path) => docs.set(path, deepFreeze(clone(options.seed[path]))));
      }
    }

    function checkPath(path, wantDocument) {
      if (typeof path !== "string" || !path) throw new TypeError("db: the path must be a non-empty string");
      const segments = path.split("/");
      if (segments.length > 16) throw new TypeError("db: at most 16 segments per path: " + path);
      if (byteLength(path) > 1000) throw new TypeError("db: at most 1000 bytes per path");
      segments.forEach((segment) => {
        if (!segment || segment === "." || segment === ".." || !SEGMENT_RE.test(segment) || byteLength(segment) > 200) {
          throw new TypeError('db: invalid path segment "' + segment + '" in "' + path + '"');
        }
      });
      if ((segments.length % 2 === 0) !== wantDocument) {
        throw new TypeError(wantDocument
          ? 'db: a document path has an even number of segments, got ' + segments.length + ' in "' + path + '"'
          : 'db: a collection path has an odd number of segments, got ' + segments.length + ' in "' + path + '"');
      }
      return segments;
    }

    function checkBody(data, what) {
      if (!isObject(data)) return fail("invalid_argument", what + ": the document body must be a plain JSON object");
      let text;
      try { text = JSON.stringify(data); } catch (e) { return fail("invalid_argument", what + ": the body is not JSON"); }
      const bytes = byteLength(text);
      if (bytes > DOC_LIMIT_BYTES) return fail("invalid_argument", what + ": the document exceeds 256 KiB (" + bytes + " bytes)");
      if (depthOf(data) > MAX_DEPTH) return fail("invalid_argument", what + ": the document is more than 32 levels deep");
      return null;
    }

    function write(op, path, data) {
      const entry = { op: op, path: path, ok: false, code: null, bytes: 0 };
      dbControl.writes.push(entry);
      const running = inflight.get(path) || 0;
      if (running > 0) dbControl.overlaps++;
      inflight.set(path, running + 1);
      let failure = null;
      const rule = injected.find((r) => !r.match || r.match(op, path));
      if (rule) {
        failure = fail(rule.code, "injected failure (" + rule.code + ")");
        rule.count--;
        if (rule.count <= 0) injected = injected.filter((r) => r !== rule);
      }
      if (!failure && !role().dataWrite) failure = fail("invalid_argument", "this viewer may not write " + path);
      if (!failure) {
        if (op === "delete") {
          docs.delete(path);
        } else if (op === "set") {
          failure = checkBody(data, "set " + path);
          if (!failure) docs.set(path, deepFreeze(clone(data)));
        } else {
          const current = docs.get(path);
          if (!current) failure = fail("invalid_argument", "update " + path + ": the document does not exist");
          else failure = checkBody(data, "update " + path);
          if (!failure) {
            const next = merge(current, clone(data));
            failure = checkBody(next, "update " + path);
            if (!failure) docs.set(path, deepFreeze(next));
          }
        }
      }
      if (failure) {
        entry.code = failure.code;
      } else {
        entry.ok = true;
        entry.bytes = docs.has(path) ? byteLength(JSON.stringify(docs.get(path))) : 0;
        persist();
        scheduleDelivery(); // le visiteur voit son propre écrit tout de suite, avant la confirmation
      }
      return new Promise((resolve, reject) => {
        later(() => {
          inflight.set(path, (inflight.get(path) || 1) - 1);
          if (failure) reject(failure); else resolve();
        }, dbControl.latencyMs);
      });
    }

    function docSnapshot(path, meta) {
      const data = docs.get(path);
      const hit = snapCache.get(path);
      if (hit && hit.data === data && hit.meta === meta) return hit.snap;
      const snap = Object.freeze({
        id: path.slice(path.lastIndexOf("/") + 1),
        exists: data !== undefined,
        data: () => data,
        metadata: meta,
      });
      snapCache.set(path, { data: data, meta: meta, snap: snap });
      return snap;
    }

    function runQuery(query) {
      const head = query.path + "/";
      let rows = [];
      docs.forEach((data, path) => {
        if (path.indexOf(head) !== 0 || path.slice(head.length).indexOf("/") >= 0) return;
        rows.push({ path: path, id: path.slice(head.length), data: data });
      });
      rows = rows.filter((row) => query.filters.every((f) => {
        const value = row.data[f.field];
        switch (f.op) {
          case "==": return value === f.value;
          case "!=": return value !== undefined && value !== f.value;
          case "<": return value !== undefined && compareValues(value, f.value) < 0;
          case "<=": return value !== undefined && compareValues(value, f.value) <= 0;
          case ">": return value !== undefined && compareValues(value, f.value) > 0;
          case ">=": return value !== undefined && compareValues(value, f.value) >= 0;
          case "in": return f.value.indexOf(value) >= 0;
          case "not-in": return value !== undefined && f.value.indexOf(value) < 0;
          case "array-contains": return Array.isArray(value) && value.indexOf(f.value) >= 0;
          default: return false;
        }
      }));
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (query.order) {
        const field = query.order.field;
        const sign = query.order.dir === "desc" ? -1 : 1;
        rows.sort((a, b) => {
          const va = a.data[field], vb = b.data[field];
          if (va === undefined || vb === undefined) return va === vb ? 0 : va === undefined ? 1 : -1; // champ absent : en dernier
          return sign * compareValues(va, vb);
        });
      }
      return query.limit ? rows.slice(0, query.limit) : rows;
    }

    function querySnapshot(rows, previous, meta) {
      const snaps = rows.map((row) => docSnapshot(row.path, meta));
      const changes = [];
      const before = previous || [];
      before.forEach((old, oldIndex) => {
        if (!rows.some((row) => row.path === old.path)) {
          changes.push(Object.freeze({ type: "removed", doc: old.snap, oldIndex: oldIndex, newIndex: -1 }));
        }
      });
      rows.forEach((row, newIndex) => {
        const oldIndex = before.findIndex((old) => old.path === row.path);
        if (oldIndex < 0) changes.push(Object.freeze({ type: "added", doc: snaps[newIndex], oldIndex: -1, newIndex: newIndex }));
        else if (before[oldIndex].data !== row.data || oldIndex !== newIndex) {
          changes.push(Object.freeze({ type: "modified", doc: snaps[newIndex], oldIndex: oldIndex, newIndex: newIndex }));
        }
      });
      Object.freeze(changes);
      return Object.freeze({
        docs: Object.freeze(snaps),
        size: snaps.length,
        empty: snaps.length === 0,
        docChanges: () => changes,
        metadata: meta,
      });
    }

    function deliver(listener) {
      if (!listener.active || dbControl.hold) return;
      const meta = dbControl.cacheOnly ? META_CACHE : META;
      if (listener.kind === "doc") {
        const data = docs.get(listener.path);
        if (listener.started && listener.lastData === data && listener.lastMeta === meta) return;
        listener.started = true;
        listener.lastData = data;
        listener.lastMeta = meta;
        listener.next(docSnapshot(listener.path, meta));
        return;
      }
      const rows = runQuery(listener.query);
      const last = listener.lastRows;
      const same = listener.started && listener.lastMeta === meta && last.length === rows.length
        && rows.every((row, i) => row.path === last[i].path && row.data === last[i].data);
      if (same) return;
      const snap = querySnapshot(rows, listener.started ? last : null, meta);
      listener.started = true;
      listener.lastMeta = meta;
      listener.lastRows = rows.map((row, i) => ({ path: row.path, data: row.data, snap: snap.docs[i] }));
      listener.next(snap);
    }

    function scheduleDelivery() {
      if (deliveryQueued) return;
      deliveryQueued = true;
      later(() => {
        deliveryQueued = false;
        Array.from(listeners).forEach((listener) => {
          try { deliver(listener); } catch (e) { console.error("[mock db] snapshot callback threw", e); }
        });
      }, 0);
    }

    function subscribe(listener, problem) {
      if (typeof listener.next !== "function") throw new TypeError("db: onSnapshot needs a callback");
      const active = Array.from(listeners).filter((l) => l.active).length;
      const error = problem || (active >= MAX_SUBSCRIPTIONS ? fail("resource_exhausted", "at most 64 active subscriptions per view") : null);
      if (error) {
        later(() => {
          if (typeof listener.error === "function") listener.error(error);
          else console.error("[mock db] listener error", error);
        }, 0);
        return () => {};
      }
      listener.active = true;
      listener.started = false;
      listeners.add(listener);
      scheduleDelivery();
      return () => {
        listener.active = false;
        listeners.delete(listener);
      };
    }

    function queryProblem(query) {
      if (query.filters.length > 10) return fail("invalid_argument", "at most 10 filters per query");
      if (query.orders > 1) return fail("invalid_argument", "at most one orderBy per query");
      if (query.badLimit) return fail("invalid_argument", "limit must be between 1 and 1000");
      const bad = query.filters.find((f) =>
        ["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains"].indexOf(f.op) < 0
        || ((f.op === "in" || f.op === "not-in") && (!Array.isArray(f.value) || f.value.length > 30)));
      return bad ? fail("invalid_argument", "unsupported filter on " + bad.field + " (" + bad.op + ")") : null;
    }

    function makeQuery(spec) {
      const query = {
        where(field, op, value) {
          return makeQuery(Object.assign({}, spec, { filters: spec.filters.concat([{ field: field, op: op, value: value }]) }));
        },
        orderBy(field, dir) {
          return makeQuery(Object.assign({}, spec, { order: { field: field, dir: dir === "desc" ? "desc" : "asc" }, orders: spec.orders + 1 }));
        },
        limit(n) {
          const ok = Number.isInteger(n) && n >= 1 && n <= 1000;
          return makeQuery(Object.assign({}, spec, { limit: ok ? n : 0, badLimit: !ok }));
        },
        get() {
          return new Promise((resolve, reject) => {
            later(() => {
              const problem = queryProblem(spec);
              if (problem) reject(problem); else resolve(querySnapshot(runQuery(spec), null, META));
            }, dbControl.latencyMs);
          });
        },
        onSnapshot(next, error) {
          return subscribe({ kind: "query", query: spec, next: next, error: error }, queryProblem(spec));
        },
      };
      return query;
    }

    function newDocId() {
      idCounter++;
      let id = "";
      for (let i = 0; i < 14; i++) id += Math.floor(Math.random() * 36).toString(36);
      return id + idCounter.toString(36).padStart(6, "0");
    }

    function docRef(path) {
      checkPath(path, true);
      const ref = {
        id: path.slice(path.lastIndexOf("/") + 1),
        path: path,
        get() {
          return new Promise((resolve) => later(() => resolve(docSnapshot(path, META)), dbControl.latencyMs));
        },
        set(data) { return write("set", path, data); },
        update(data) { return write("update", path, data); },
        delete() { return write("delete", path); },
        acquire(opts) {
          return new Promise((resolve, reject) => {
            later(() => {
              if (!opts || typeof opts.holder !== "string" || !opts.holder) return reject(fail("invalid_argument", "acquire needs a holder"));
              if (!role().dataWrite) return reject(fail("invalid_argument", "this viewer may not write " + path));
              const now = Date.now();
              const lease = leases.get(path);
              if (lease && lease.expires > now && lease.holder !== opts.holder) {
                return resolve({ acquired: false, expiresAt: new Date(lease.expires).toISOString() });
              }
              const ttl = Math.min(600000, Math.max(1000, Number(opts.ttlMs) || 30000));
              const version = ((lease && lease.version) || 0) + 1;
              leases.set(path, { holder: opts.holder, expires: now + ttl, version: version });
              if (isObject(opts.data)) {
                docs.set(path, deepFreeze(merge(docs.get(path) || {}, clone(opts.data))));
                persist();
                scheduleDelivery();
              }
              return resolve({ acquired: true, version: version, expiresAt: new Date(now + ttl).toISOString(), holder: opts.holder });
            }, dbControl.latencyMs);
          });
        },
        onSnapshot(next, error) {
          return subscribe({ kind: "doc", path: path, next: next, error: error }, null);
        },
        collection(sub) { return collectionRef(path + "/" + sub); },
      };
      return Object.freeze(ref);
    }

    function collectionRef(path) {
      checkPath(path, false);
      const ref = makeQuery({ path: path, filters: [], order: null, orders: 0, limit: 0, badLimit: false });
      ref.path = path;
      ref.doc = (id) => docRef(path + "/" + (id === undefined ? newDocId() : id));
      ref.add = (data) => {
        const created = ref.doc();
        return created.set(data).then(() => created);
      };
      return Object.freeze(ref);
    }

    const db = Object.freeze({ doc: (path) => docRef(path), collection: (path) => collectionRef(path) });

    // ---------------------------------------------------------- user

    const me = Object.assign({ id: "u_demo_owner", name: "Alex" }, options.user || {});
    const people = Object.assign({ u_demo_owner: "Alex", u_demo_investor: "Sam", u_demo_partner: "Charlie" }, options.people || {});
    if (me.id) people[me.id] = me.name || "";
    const COLORS = ["#3b6fd4", "#2f8f6b", "#b3572f", "#7a54c2"];
    const colorOf = (id) => COLORS[Math.abs(Array.from(String(id)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % COLORS.length];
    const avatarOf = (name, color) => {
      const letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="' + color
        + '"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">' + letter + "</text></svg>";
      return "data:image/svg+xml," + encodeURIComponent(svg);
    };
    const profileOf = (id) => {
      const name = Object.prototype.hasOwnProperty.call(people, id) ? people[id] : "";
      const color = colorOf(id);
      return Object.freeze({ id: id, name: name, avatarUrl: avatarOf(name, color), color: color, email: null, isMe: id === me.id, guest: false });
    };
    const viewer = () => Object.freeze({
      id: me.id || null,
      name: me.name || "",
      avatarUrl: avatarOf(me.name, colorOf(me.id || "anon")),
      color: colorOf(me.id || "anon"),
      email: null,
      isOwner: role().isOwner,
      canEdit: role().canEdit,
    });
    const can = (name) => {
      if (options.can === null) return null; // la plateforme ne dit rien : à la page de laisser un écrit refusé trancher
      if (name === "data.write") return role().dataWrite;
      if (name === "files.write") return role().canEdit;
      if (name === "assets.write") return role().assets;
      if (name === "people.add") return role().isOwner;
      return false;
    };
    const user = Object.freeze({
      isOwner: () => Promise.resolve(role().isOwner),
      canEdit: () => Promise.resolve(role().canEdit),
      can: (name) => Promise.resolve(can(name)),
      me: () => Promise.resolve(viewer()),
      id: () => Promise.resolve(me.id || null),
      name: () => Promise.resolve(me.name || ""),
      avatarUrl: () => Promise.resolve(me.id ? viewer().avatarUrl : null),
      email: () => Promise.resolve(null),
      profiles: (ids) => {
        const out = {};
        (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (typeof id === "string") out[id] = profileOf(id); });
        return Promise.resolve(out);
      },
      search: (query) => {
        const q = String(query || "").toLowerCase();
        const hits = Object.keys(people).filter((id) => people[id] && (!q || people[id].toLowerCase().indexOf(q) >= 0));
        return Promise.resolve(hits.slice(0, 8).map(profileOf));
      },
    });

    // ---------------------------------------------------------- assets

    const assetStore = new Map();
    let assetCounter = 0;
    const assetLimits = { maxFiles: 500, maxBytes: 1024 * 1024 * 1024 };
    const isBlob = (b) => b && typeof b === "object" && typeof b.size === "number" && typeof b.slice === "function";
    const assets = Object.freeze({
      upload(blob, opts) {
        return new Promise((resolve, reject) => {
          later(() => {
            if (!role().assets) return reject(fail("not_granted", "assets are not granted to this view"));
            if (!isBlob(blob) || blob.size === 0) return reject(fail("invalid_request", "upload needs a non-empty Blob"));
            if (opts !== undefined && !isObject(opts)) return reject(fail("invalid_request", "options must be a plain object"));
            const type = (opts && opts.type) || blob.type || "";
            if (ASSET_TYPES.indexOf(type) < 0) return reject(fail("unsupported_type", 'content type "' + type + '" is not accepted'));
            const cap = type === "image/svg+xml" ? 2 : type === "text/css" || type === "text/javascript" ? 16 : 20;
            if (blob.size > cap * 1024 * 1024) return reject(fail("too_large", "over the " + cap + " MiB limit"));
            let used = 0;
            assetStore.forEach((a) => { used += a.sizeBytes; });
            if (assetStore.size >= assetLimits.maxFiles || used + blob.size > assetLimits.maxBytes) {
              return reject(fail("quota_or_state", "asset quota exhausted"));
            }
            assetCounter++;
            const id = ("a55e7" + "0".repeat(27) + assetCounter.toString(16)).slice(-27).padStart(32, "a55e7");
            let url = "/_blob/" + id;
            try {
              if (root.URL && typeof root.URL.createObjectURL === "function" && typeof document !== "undefined") url = root.URL.createObjectURL(blob);
            } catch (e) { /* pas d'URL objet : on garde le chemin de la plateforme */ }
            const record = { id: id, url: url, contentType: type, sizeBytes: blob.size, createdAt: new Date().toISOString(), blob: blob };
            assetStore.set(id, record);
            return resolve({ id: id, url: url, sizeBytes: blob.size, contentType: type });
          }, dbControl.latencyMs);
        });
      },
      list() {
        let bytes = 0;
        const list = Array.from(assetStore.values()).map((a) => {
          bytes += a.sizeBytes;
          return { id: a.id, url: a.url, contentType: a.contentType, sizeBytes: a.sizeBytes, createdAt: a.createdAt };
        });
        return Promise.resolve({ assets: list, usage: { files: list.length, bytes: bytes, maxFiles: assetLimits.maxFiles, maxBytes: assetLimits.maxBytes } });
      },
      delete(ref) {
        return new Promise((resolve, reject) => {
          later(() => {
            if (typeof ref !== "string" || !ref) return reject(fail("invalid_request", "delete needs an asset id or url"));
            const found = Array.from(assetStore.values()).find((a) => a.id === ref || a.url === ref);
            if (found) assetStore.delete(found.id);
            return resolve({ deleted: !!found });
          }, dbControl.latencyMs);
        });
      },
    });

    // ---------------------------------------------------------- downloads

    const downloadLog = [];
    const downloads = Object.freeze({
      save(request) {
        return new Promise((resolve, reject) => {
          later(async () => {
            if (!isObject(request) || typeof request.filename !== "string" || !request.filename || request.filename.length > 512) {
              return reject(fail("bad_request", "bad filename"));
            }
            const ext = (request.filename.match(/\.([A-Za-z0-9]+)$/) || [])[1];
            if (!ext || DOWNLOAD_EXTENSIONS.indexOf(ext.toLowerCase()) < 0) return reject(fail("rejected_extension", "extension not allowed"));
            const data = request.data;
            let bytes = null;
            let text = null;
            try {
              if (typeof data === "string") {
                text = data;
              } else if (isBlob(data)) {
                bytes = new Uint8Array(await data.arrayBuffer());
              } else if (data instanceof ArrayBuffer) {
                bytes = new Uint8Array(data.slice(0));
                try { structuredClone(data, { transfer: [data] }); } catch (e) { /* le vrai transfert vide le tampon d'origine */ }
              } else if (ArrayBuffer.isView(data)) {
                bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
              }
            } catch (e) {
              return reject(fail("bad_request", "unreadable data"));
            }
            const size = text !== null ? byteLength(text) : bytes ? bytes.length : 0;
            if (!size) return reject(fail("bad_request", "empty or invalid data"));
            if (mock.downloadDecision !== "accept") {
              return reject(fail(mock.downloadDecision === "decline" ? "declined" : mock.downloadDecision, "the viewer did not accept"));
            }
            if (text === null && TEXT_EXTENSIONS.indexOf(ext.toLowerCase()) >= 0 && typeof TextDecoder !== "undefined") {
              text = new TextDecoder().decode(bytes);
            }
            downloadLog.push({ filename: request.filename, size: size, text: text, bytes: bytes, at: new Date().toISOString() });
            return resolve({ status: "saved" });
          }, 0);
        });
      },
    });

    // ---------------------------------------------------------- sample

    const VENDORS = [
      [/applovin|axon/i, "Applovin Corporation", "AppLovin, publicité", "ads_applovin"],
      [/tiktok/i, "TikTok", "TikTok, publicité", "ads_tiktok"],
      [/facebk|facebook|meta platforms|\bmeta\b/i, "Meta Platforms", "Meta, publicité", "ads_meta"],
      [/klaviyo/i, "Klaviyo Inc", "Klaviyo, abonnement", "email_sms"],
      [/shopify/i, "Shopify", "Shopify, abonnement", "shopify_sub"],
    ];
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

    function readReceiptText(text) {
      const amount = (text.match(/[$€£]\s?(\d[\d,]*\.\d{2})/) || [])[1];
      if (!amount) return null;
      const vendor = VENDORS.find((v) => v[0].test(text));
      const long = text.match(new RegExp("(" + MONTHS.join("|") + ")\\s+(\\d{1,2}),\\s+(\\d{4})", "i"));
      const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      let date = "";
      if (long) date = long[3] + "-" + String(MONTHS.indexOf(long[1].toLowerCase()) + 1).padStart(2, "0") + "-" + long[2].padStart(2, "0");
      else if (iso) date = iso[0];
      const from = (text.match(/Receipt from\s+(.+?)(?:\s+Receipt|\s+\$|\n|$)/i) || [])[1];
      return {
        date: date,
        label: vendor ? vendor[2] : (from || "Reçu") + ", paiement",
        party: vendor ? vendor[1] : from || "",
        amount: "-" + amount.replace(/,/g, ""),
        direction: "out",
        currency: /€/.test(text) ? "EUR" : /£/.test(text) ? "GBP" : "USD",
        ref: (text.match(/Receipt (?:number\s+|#)([\w-]+)/i) || [])[1] || "",
        card: (text.match(/Payment method\s*-\s*(\d{4})/i) || [])[1] || "",
        categoryId: vendor ? vendor[3] : null,
        confidence: 0.9,
      };
    }

    const CANNED = [
      { date: "2026-11-21", label: "AppLovin, publicité", party: "Applovin Corporation", amount: "-94.77", direction: "out", currency: "USD", ref: "1182-9784", card: "0562", categoryId: "ads_applovin", confidence: 0.92 },
      { date: "2026-09-30", label: "Klaviyo, abonnement", party: "Klaviyo Inc", amount: "-1.00", direction: "out", currency: "USD", ref: "2648-3340-7176", card: "2487", categoryId: "email_sms", confidence: 0.88 },
      { date: "2026-11-18", label: "TikTok, publicité", party: "TikTok", amount: "-250.00", direction: "out", currency: "USD", ref: "", card: "0562", categoryId: "ads_tiktok", confidence: 0.7 },
    ];

    /** Réponses déterministes. Remplaçable : `window.__mock.sampleHandler = async (call) => ...`. */
    async function defaultSampleHandler(call) {
      if (call.kind === "json") {
        const marker = call.prompt.indexOf("<<<");
        const body = marker >= 0 ? call.prompt.slice(marker + 3, call.prompt.lastIndexOf(">>>")) : "";
        const items = [];
        const fromText = body ? readReceiptText(body) : null;
        if (fromText) items.push(fromText);
        call.images.forEach((image, i) => items.push(CANNED[i % CANNED.length]));
        return { items: items, notes: items.length ? "Réponse de démonstration (bouchon de développement)." : "Rien de lisible (bouchon de développement)." };
      }
      if (call.tools.length) {
        const tool = call.tools[0];
        let result;
        try { result = await tool.execute({}, { signal: call.signal }); } catch (e) { result = "Error: " + ((e && e.message) || e); }
        const shown = typeof result === "string" ? result : JSON.stringify(result);
        return "Réponse de démonstration. D'après l'outil " + tool.name + " : " + String(shown).slice(0, 400);
      }
      return "Réponse de démonstration à ta question : « " + call.prompt.slice(0, 160) + " ».";
    }

    function sampleProblem(input, opts) {
      const proto = isObject(opts) ? Object.getPrototypeOf(opts) : undefined;
      if (opts !== undefined && proto !== Object.prototype && proto !== null) return fail("invalid_request", "options must be a plain object");
      if (typeof input === "string") {
        if (!input.trim()) return fail("invalid_request", "input is empty");
      } else if (Array.isArray(input)) {
        const ok = input.length > 0 && input.every((t) => isObject(t) && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content);
        if (!ok || input[0].role !== "user" || input[input.length - 1].role !== "user") {
          return fail("invalid_request", "turns must be {role, content} objects starting and ending on a user turn");
        }
      } else {
        return fail("invalid_request", "input must be a string or a list of turns");
      }
      const total = typeof input === "string" ? byteLength(input) : input.reduce((n, t) => n + byteLength(t.content), 0);
      if (total > mock.sampleLimits.maxPromptBytes) return fail("prompt_too_large", "over 256 KiB of text");
      if (opts) {
        if (opts.onText !== undefined && typeof opts.onText !== "function") return fail("invalid_request", "onText must be a function");
        if (opts.signal !== undefined && !(opts.signal && typeof opts.signal.aborted === "boolean")) return fail("invalid_request", "signal must be an AbortSignal");
        if (opts.tools !== undefined) {
          if (!Array.isArray(opts.tools) || !opts.tools.every((t) => isObject(t) && /^[A-Za-z0-9_-]{1,128}$/.test(t.name || "") && typeof t.description === "string" && t.description && typeof t.execute === "function")) {
            return fail("invalid_request", "tools must be an array of {name, description, execute}");
          }
          if (opts.cache !== undefined && opts.cache !== false) return fail("invalid_request", "cache cannot be combined with tools");
        }
      }
      return null;
    }

    function runSample(kind, input, opts) {
      opts = opts === undefined ? {} : opts;
      const problem = sampleProblem(input, opts);
      const safe = isObject(opts) ? opts : {};
      const images = !safe.images ? [] : isBlob(safe.images) ? [safe.images] : Array.from(safe.images);
      const prompt = typeof input === "string" ? input : Array.isArray(input) && input.length ? String(input[input.length - 1].content) : "";
      const call = { kind: kind, input: input, prompt: prompt, options: opts, images: images, tools: Array.isArray(safe.tools) ? safe.tools : [], signal: safe.signal || null };
      mock.sampleCalls.push(call);
      const aborted = () => !!(safe.signal && safe.signal.aborted);
      return new Promise((resolve, reject) => {
        later(async () => {
          if (problem) return reject(problem);
          if (aborted()) return reject(fail("cancelled", "the signal was aborted"));
          if (mock.sampleConsent !== "granted") return reject(fail("not_granted", "the viewer did not allow this artifact to use Claude"));
          const limits = mock.sampleLimits;
          if (images.length) {
            if (!limits.images) return reject(fail("images_unavailable", "this view cannot send images"));
            const bad = images.length > limits.images.maxCount
              || images.some((b) => !isBlob(b) || limits.images.mediaTypes.indexOf(b.type) < 0 || b.size > limits.images.maxInputBytes);
            if (bad) return reject(fail("image_rejected", "too many images, wrong type, or too large"));
          }
          if (call.tools.length && !limits.tools) return reject(fail("tools_unavailable", "this view cannot run page tools"));
          let answer;
          try {
            answer = await mock.sampleHandler(call);
          } catch (e) {
            return reject(e && typeof e.code === "string" ? e : fail("upstream_error", String((e && e.message) || e)));
          }
          if (aborted()) return reject(fail("cancelled", "the signal was aborted"));
          const text = typeof answer === "string" ? answer : kind === "json" ? JSON.stringify(answer) : String((answer && answer.text) || "");
          if (!text.trim()) return reject(fail("empty_completion", "no text"));
          if (typeof safe.onText === "function") {
            const cut = kind === "json" ? text.length : Math.ceil(text.length / 2);
            let shown = "";
            for (const delta of [text.slice(0, cut), text.slice(cut)]) {
              if (!delta) continue;
              shown += delta;
              try { safe.onText({ text: shown, delta: delta }); } catch (e) { console.error(e); }
              await new Promise((r) => later(r, 0));
              if (aborted()) return reject({ code: "cancelled", message: "the signal was aborted", text: shown });
            }
          }
          if (kind !== "json") {
            return resolve({ text: text, truncated: !!(answer && answer.truncated), modelTierApplied: safe.modelTier === "quick" || safe.modelTier === "complex" ? safe.modelTier : "default" });
          }
          if (typeof answer !== "string") return resolve(clone(answer));
          // Lecture tolérante, comme la vraie : texte entier, bloc de code, puis de la première accolade à la dernière.
          const candidates = [text.trim()];
          const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
          if (fence) candidates.push(fence[1].trim());
          const start = Math.min.apply(null, [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0).concat([Infinity]));
          const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
          if (start < end) candidates.push(text.slice(start, end + 1));
          for (const candidate of candidates) {
            try { return resolve(JSON.parse(candidate)); } catch (e) { /* candidat suivant */ }
          }
          return reject({ code: "invalid_json", message: "the reply held no parseable JSON value", text: text });
        }, dbControl.latencyMs);
      });
    }

    const sample = function (input, opts) { return runSample("text", input, opts); };
    sample.json = function (input, opts) { return runSample("json", input, opts); };
    sample.limits = function () { return Promise.resolve(clone(mock.sampleLimits)); };
    Object.freeze(sample);

    // ---------------------------------------------------------- use() et pilotage

    const namespaces = { db: db, user: user, assets: assets, downloads: downloads, sample: sample };
    const promises = {};
    const useDelay = Number(options.useDelayMs) || 0;

    function use(name) {
      const available = Object.prototype.hasOwnProperty.call(namespaces, name) && served.indexOf(name) >= 0
        && (name !== "assets" || role().assets);
      if (!available) return new Promise((resolve) => later(() => resolve(null), useDelay));
      if (!promises[name]) promises[name] = new Promise((resolve) => later(() => resolve(namespaces[name]), useDelay));
      return promises[name];
    }

    const mock = {
      db: dbControl,
      downloads: downloadLog,
      downloadDecision: "accept",   // "accept", "decline", ou un code d'erreur ("rate_limited", "unavailable"...)
      sampleCalls: [],
      sampleConsent: "granted",     // "denied" : chaque appel rejette not_granted
      sampleHandler: defaultSampleHandler,
      sampleLimits: {
        maxPromptBytes: 262144,
        images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
        tools: { maxCount: 16 },
        modelTiers: ["default", "complex", "quick"],
      },
      people: people,
      get role() { return roleName; },
      /** Change le niveau du visiteur : "owner", "editor", "contributor" (écrit les données, pas de fichiers), "viewer" (lecture seule). */
      setRole(name) {
        if (!ROLES[name]) throw new Error("unknown role: " + name);
        roleName = name;
        delete promises.assets;
      },
      assets: {
        list: () => Array.from(assetStore.values()),
        limits: assetLimits,
      },
      /** Remet tout à zéro (documents, fichiers, journaux) et prévient les abonnés. */
      reset() {
        docs.clear();
        snapCache.clear();
        leases.clear();
        assetStore.clear();
        injected = [];
        downloadLog.length = 0;
        mock.sampleCalls.length = 0;
        dbControl.writes.length = 0;
        dbControl.overlaps = 0;
        dbControl.hold = false;
        dbControl.cacheOnly = false;
        if (storage) { try { storage.removeItem(STORAGE_KEY); } catch (e) { /* rien à effacer */ } }
        scheduleDelivery();
      },
    };

    restore();
    return { claude: Object.freeze({ use: use }), mock: mock };
  }

  root.__createMockClaude = createMockClaude;
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const instance = createMockClaude(window.__mockOptions || {});
    window.claude = instance.claude;
    window.__mock = instance.mock;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
