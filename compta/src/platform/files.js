// Justificatifs : envoi et affichage de fichiers (capacité `assets`, ou mémoire de l'onglet en mode local).
import { newId } from "../core/ids.js";
import { PlatformError, codeOf, detailOf } from "./errors.js";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TYPES_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
const EXT_BY_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
/** Valeur pour l'attribut `accept` d'un champ de fichier. */
export const FILE_ACCEPT = Object.keys(EXT_BY_TYPE).join(",");

const MESSAGES = {
  heic: "Les photos HEIC (format iPhone) ne sont pas prises en charge : envoie une capture d'écran ou un PDF.",
  type: "Ce type de fichier n'est pas accepté. Formats possibles : PNG, JPEG, WebP, GIF ou PDF.",
  empty: "Ce fichier est vide.",
  too_large: "Ce fichier est trop lourd (20 Mo maximum). Réduis-le ou envoie une capture d'écran.",
  quota_or_state: "Impossible d'ajouter ce fichier : l'espace de stockage des justificatifs est plein, ou la page n'accepte plus de fichiers. Supprime des justificatifs inutiles puis réessaie.",
  rate_limited: "Trop d'envois d'un coup. Attends un instant puis réessaie.",
  upstream_auth: "Ta session a expiré. Recharge la page (ou reconnecte-toi) puis réessaie.",
  unavailable: "L'envoi de fichiers n'est pas disponible dans cette vue.",
  not_uploader: "Tu ne peux supprimer que les fichiers que tu as envoyés toi-même.",
  upstream_error: "L'envoi du fichier a échoué. Réessaie dans un instant.",
};

function fileError(raw) {
  if (raw instanceof PlatformError) return raw;
  const code = codeOf(raw);
  const detail = detailOf(raw);
  if (code === "too_large") return new PlatformError(code, MESSAGES.too_large, { detail });
  if (code === "unsupported_type") return new PlatformError(code, MESSAGES.type, { detail });
  if (code === "invalid_request") return new PlatformError(code, MESSAGES.empty, { detail });
  if (code === "quota_or_state" || code === "rate_limited" || code === "upstream_auth" || code === "not_uploader") {
    return new PlatformError(code, MESSAGES[code], { detail });
  }
  if (code === "not_granted" || code === "capability_disabled" || code === "capability_removed") {
    return new PlatformError("unavailable", MESSAGES.unavailable, { detail });
  }
  return new PlatformError("upstream_error", MESSAGES.upstream_error, { detail });
}

/**
 * Vérifie un fichier avant envoi et renvoie { type, name, size }.
 * Le type vient de blob.type quand il est exploitable, sinon de l'extension (les navigateurs se trompent souvent).
 */
export function describeFile(file, name) {
  const size = file && typeof file.size === "number" ? file.size : 0;
  const given = String(name || (file && file.name) || "").trim();
  const ext = (given.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || "";
  const declared = String((file && file.type) || "").split(";")[0].trim().toLowerCase();
  if (/hei[cf]/.test(declared) || ext === "heic" || ext === "heif") throw new PlatformError("unsupported_type", MESSAGES.heic);
  const type = EXT_BY_TYPE[declared] ? declared : TYPES_BY_EXT[ext] || (declared === "image/jpg" ? "image/jpeg" : "");
  if (!type) throw new PlatformError("unsupported_type", MESSAGES.type);
  if (!size) throw new PlatformError("invalid_request", MESSAGES.empty);
  if (size > MAX_FILE_BYTES) throw new PlatformError("too_large", MESSAGES.too_large);
  const safe = given.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").slice(-120);
  return { type, size, name: safe || "justificatif." + EXT_BY_TYPE[type] };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fichiers stockés avec l'Artifact.
 * @param {object} assets espace de noms résolu par `await window.claude.use("assets")`
 */
export function createFiles(assets, options = {}) {
  const retryDelayMs = options.retryDelayMs ?? 700;
  const urls = new Map(); // identifiants envoyés pendant cette visite -> URL d'affichage renvoyée par la plateforme
  async function once(run) {
    try {
      return await run();
    } catch (err) {
      if (codeOf(err) !== "store_unavailable") throw fileError(err);
      await pause(retryDelayMs); // seule erreur passagère du contrat : une nouvelle tentative, pas plus
      try { return await run(); } catch (again) { throw fileError(again); }
    }
  }
  return {
    accept: FILE_ACCEPT,
    maxBytes: MAX_FILE_BYTES,
    async upload(file, name) {
      const info = describeFile(file, name);
      const result = await once(() => assets.upload(file, { type: info.type }));
      if (!result || typeof result.id !== "string") throw new PlatformError("upstream_error", MESSAGES.upstream_error);
      if (typeof result.url === "string" && result.url) urls.set(result.id, result.url);
      return { id: result.id, name: info.name, type: result.contentType || info.type, size: Number(result.sizeBytes) || info.size };
    },
    /** URL d'affichage d'un justificatif à partir de son identifiant stocké. */
    urlFor(id) {
      if (typeof id !== "string" || !id) return "";
      return urls.get(id) || "/_blob/" + id;
    },
    async remove(id) {
      if (typeof id !== "string" || !id) return;
      await once(() => assets.delete(id));
      urls.delete(id);
    },
  };
}

/** Mode local : les fichiers vivent dans la mémoire de l'onglet (perdus au rechargement). */
export function createLocalFiles() {
  const urls = new Map();
  const canUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  return {
    accept: FILE_ACCEPT,
    maxBytes: MAX_FILE_BYTES,
    volatile: true,
    async upload(file, name) {
      const info = describeFile(file, name);
      const id = newId("local");
      urls.set(id, canUrl ? URL.createObjectURL(file) : "");
      return { id, name: info.name, type: info.type, size: info.size };
    },
    urlFor(id) {
      return urls.get(id) || "";
    },
    async remove(id) {
      const url = urls.get(id);
      if (url && canUrl) { try { URL.revokeObjectURL(url); } catch { /* déjà libérée */ } }
      urls.delete(id);
    },
  };
}
