// Outils sur des valeurs JSON immuables : fusion façon db.update(), différences, tailles.

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Une clé de map acceptable (jamais "__proto__" et consorts). */
export function isSafeKey(key) {
  return typeof key === "string" && key !== "" && !UNSAFE_KEYS.has(key);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copie profonde limitée au JSON : undefined, fonctions et NaN disparaissent. Résultat modifiable. */
export function jsonClone(value) {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
}

/** Gèle en profondeur. Un objet déjà gelé est supposé gelé jusqu'en bas (c'est le cas de tout ce que produit ce module). */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Égalité profonde de deux valeurs JSON, insensible à l'ordre des clés.
 * loose : un membre null ou absent, c'est pareil (null = "effacé" dans les documents stockés).
 */
export function deepEqual(a, b, loose = false) {
  if (a === b) return true;
  if (loose && a == null && b == null) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const arrayA = Array.isArray(a);
  if (arrayA !== Array.isArray(b)) return false;
  if (arrayA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], loose)) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (!loose && keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (loose ? !deepEqual(a[key], b[key], true) : !(key in b) || !deepEqual(a[key], b[key], false)) return false;
  }
  if (loose) for (const key of keysB) if (!(key in a) && b[key] != null) return false;
  return true;
}

/**
 * Fusionne comme db.update() : les objets se fusionnent récursivement, tout le reste (tableaux compris) remplace.
 * Renvoie une nouvelle valeur gelée qui partage les branches intactes avec `target` (identité stable).
 * `patch` doit déjà être gelé.
 */
export function mergeDeep(target, patch) {
  if (!isPlainObject(patch)) return patch;
  const base = isPlainObject(target) ? target : null;
  const out = {};
  if (base) for (const key of Object.keys(base)) if (!UNSAFE_KEYS.has(key)) out[key] = base[key];
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const value = patch[key];
    out[key] = isPlainObject(value) && base && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  }
  return Object.freeze(out);
}

/**
 * Retire les membres null des objets (à tous les niveaux). Renvoie la même référence quand il n'y a rien à retirer.
 * Les null dans les tableaux sont conservés (ce sont des valeurs, pas des effacements).
 */
export function stripNulls(value) {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = stripNulls(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? Object.freeze(out) : value;
  }
  if (!isPlainObject(value)) return value;
  let changed = false;
  const out = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === null || item === undefined || UNSAFE_KEYS.has(key)) { changed = true; continue; }
    const next = stripNulls(item);
    if (next !== item) changed = true;
    out[key] = next;
  }
  return changed ? Object.freeze(out) : value;
}

/**
 * Patch minimal tel que mergeDeep(prev, patch) vaille `next` une fois les null retirés.
 * Un champ présent dans prev et absent de next est écrit à null (update() fusionne : il faut effacer explicitement).
 * Renvoie undefined quand il n'y a rien à écrire.
 */
export function diffPatch(prev, next) {
  if (!isPlainObject(prev) || !isPlainObject(next)) return deepEqual(prev, next, true) ? undefined : stripNulls(next);
  let out;
  for (const key of Object.keys(next)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const after = next[key];
    if (after === null || after === undefined) continue;
    const before = prev[key];
    if (isPlainObject(after) && isPlainObject(before)) {
      const sub = diffPatch(before, after);
      if (sub !== undefined) (out ??= {})[key] = sub;
    } else if (!deepEqual(before, after, true)) {
      (out ??= {})[key] = stripNulls(after);
    }
  }
  for (const key of Object.keys(prev)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (prev[key] != null && next[key] == null) (out ??= {})[key] = null;
  }
  return out;
}

/** Retire d'un patch ce qui ne changerait rien à `current`. Renvoie undefined quand il ne reste rien. */
export function prunePatch(current, patch) {
  if (!isPlainObject(patch)) return deepEqual(current, patch, true) ? undefined : patch;
  let out;
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const value = patch[key];
    const existing = isPlainObject(current) ? current[key] : undefined;
    if (value === null || value === undefined) {
      if (existing != null) (out ??= {})[key] = null;
    } else if (isPlainObject(value) && isPlainObject(existing)) {
      const sub = prunePatch(existing, value);
      if (sub !== undefined) (out ??= {})[key] = sub;
    } else if (!deepEqual(existing, value, true)) {
      (out ??= {})[key] = value;
    }
  }
  return out;
}

/**
 * Compose deux patchs successifs (a puis b) en un seul équivalent, ou null quand ce n'est pas exprimable
 * (a remplace un champ par une valeur simple puis b y fusionne un objet : un seul update() ne sait pas dire "remplace").
 */
export function mergePatches(a, b) {
  const out = {};
  for (const key of Object.keys(a)) out[key] = a[key];
  for (const key of Object.keys(b)) {
    const next = b[key];
    if (!(key in a) || !isPlainObject(next)) { out[key] = next; continue; }
    if (!isPlainObject(a[key])) return null;
    const merged = mergePatches(a[key], next);
    if (merged === null) return null;
    out[key] = merged;
  }
  return Object.freeze(out);
}

/** Longueur en octets UTF-8 d'une chaîne, sans allocation. */
export function utf8Length(text) {
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

/** Taille du JSON sérialisé, en octets (la limite d'un document de la base est de 256 Kio). */
export function jsonBytes(value) {
  const text = JSON.stringify(value);
  return text === undefined ? 0 : utf8Length(text);
}
