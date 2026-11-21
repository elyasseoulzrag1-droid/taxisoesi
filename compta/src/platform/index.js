// Point d'entrée de la couche plateforme : découvre ce que la vue sait faire et assemble le tout.
// Dans Claude, chaque capacité s'obtient uniquement par `await window.claude.use(nom)` (null = absente).
// Hors de Claude (pas de window.claude), l'appli tourne en mode local sur le localStorage de l'appareil.
import { createStore } from "./store.js";
import { createClaudeBackend } from "./backend-claude.js";
import { createLocalBackend } from "./backend-local.js";
import { createFiles, createLocalFiles } from "./files.js";
import { createExporter, createLocalExporter } from "./exporter.js";
import { createAi } from "./ai.js";
import { ANONYMOUS, LOCAL_USER, loadIdentity, makeResolveNames } from "./identity.js";

export { PlatformError } from "./errors.js";
export { createStore, diffPatch, DUMP_FORMAT, DUMP_VERSION } from "./store.js";
export { createClaudeBackend } from "./backend-claude.js";
export { createLocalBackend } from "./backend-local.js";
export { FILE_ACCEPT, MAX_FILE_BYTES } from "./files.js";
export { EXPORT_EXTENSIONS } from "./exporter.js";

/** Les capacités à déclarer à la publication de la page (voir api/platform.md). */
export const CAPABILITIES = Object.freeze({
  db: {},
  user: { scopes: ["profile"] },
  assets: {},
  downloads: {},
  sample: { images: true },
});

let current = null;

function dispose(platform) {
  try { if (platform && platform.store) platform.store.close(); } catch { /* déjà fermé */ }
}

function assemble(parts) {
  const platform = {
    mode: parts.mode,
    user: parts.user,
    store: parts.store || null,
    files: parts.files || null,
    exporter: parts.exporter || null,
    ai: parts.ai || null,
    persistent: parts.persistent !== false,
    resolveNames: parts.resolveNames,
    dispose() { dispose(platform); if (current === platform) current = null; },
  };
  return platform;
}

function localPlatform(options) {
  const backend = createLocalBackend(options.local || {});
  return assemble({
    mode: "local",
    user: LOCAL_USER,
    store: createStore(backend, options.store || {}),
    files: createLocalFiles(),
    exporter: createLocalExporter(),
    persistent: backend.persistent,
    resolveNames: makeResolveNames(null),
  });
}

async function claudePlatform(claude, options) {
  // use() ne rejette pas d'après le contrat ; on se protège quand même, et null veut dire "absente".
  const use = (name) => Promise.resolve().then(() => claude.use(name)).catch(() => null);
  const pending = { user: use("user"), assets: use("assets"), downloads: use("downloads"), sample: use("sample") };
  const db = await use("db");
  // Le store s'abonne dès que la base répond, sans attendre les autres capacités.
  const store = db ? createStore(createClaudeBackend(db), options.store || {}) : null;
  const [userNs, assets, downloads, sample] = await Promise.all([pending.user, pending.assets, pending.downloads, pending.sample]);
  const user = await loadIdentity(userNs);
  if (store && user.canWrite === false) store.setReadOnly(true);
  let ai = null;
  if (typeof sample === "function") {
    let limits = null;
    try { limits = typeof sample.limits === "function" ? await sample.limits() : null; } catch { limits = null; }
    ai = createAi(sample, limits);
  }
  return assemble({
    mode: store ? "claude" : "unavailable",
    user,
    store,
    files: assets && store ? createFiles(assets) : null,
    exporter: downloads ? createExporter(downloads) : null,
    ai,
    resolveNames: makeResolveNames(userNs),
  });
}

/**
 * Prépare la plateforme. Ne lève jamais et ne rejette jamais.
 * Dans une vue Claude, la promesse se résout dès que les capacités ont répondu (au pire après 10 s : mode "unavailable").
 * Rappeler initPlatform() ferme le store précédent (bouton "Réessayer").
 *
 * @param {{ root?: object, store?: object, local?: object }} [options] root : objet qui porte `claude` (défaut : window)
 * @returns {Promise<{
 *   mode: "claude"|"local"|"unavailable",
 *   user: { id: string|null, name: string, isOwner: boolean, canEdit: boolean, canWrite: boolean|null },
 *   store: object|null, files: object|null, exporter: object|null, ai: object|null,
 *   persistent: boolean,
 *   resolveNames(ids: string[]): Promise<{ [id: string]: string }>,
 *   dispose(): void
 * }>}
 */
export async function initPlatform(options = {}) {
  dispose(current);
  current = null;
  let platform;
  try {
    const root = options.root || (typeof window !== "undefined" ? window : globalThis);
    const claude = root && root.claude;
    platform = claude && typeof claude.use === "function" ? await claudePlatform(claude, options) : localPlatform(options);
  } catch (err) {
    console.error("[platform] initialisation impossible", err);
    platform = assemble({ mode: "unavailable", user: ANONYMOUS, resolveNames: makeResolveNames(null) });
  }
  if (current && current !== platform) dispose(current); // deux initialisations en parallèle : la dernière gagne
  current = platform;
  return platform;
}
