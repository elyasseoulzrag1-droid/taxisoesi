// Export de fichiers : uniquement par la capacité `downloads` dans Claude (le visiteur confirme chaque fichier).
import { PlatformError, codeOf, detailOf } from "./errors.js";

/** Extensions utilisées par l'appli (toutes dans la liste autorisée par la plateforme). */
export const EXPORT_EXTENSIONS = ["csv", "xlsx", "json", "pdf"];

const MESSAGES = {
  extension: "Ce format de fichier ne peut pas être enregistré depuis cette page.",
  too_large: "Ce fichier est trop volumineux pour être enregistré ici. Réduis la période exportée.",
  rate_limited: "Une demande d'enregistrement est déjà ouverte, ou tu en as fait trop d'un coup. Attends un instant puis réessaie.",
  bad_request: "Il n'y a rien à enregistrer (fichier vide ou nom invalide).",
  unavailable: "L'enregistrement de fichiers n'est pas disponible dans cette vue.",
};

function exportError(raw) {
  if (raw instanceof PlatformError) return raw;
  const code = codeOf(raw);
  const detail = detailOf(raw);
  if (code === "rejected_extension" || code === "extension_not_enabled") return new PlatformError(code, MESSAGES.extension, { detail });
  if (code === "too_large" || code === "rate_limited") return new PlatformError(code, MESSAGES[code], { detail });
  if (code === "bad_request" || code === "transform_error" || code === "request_unknown") return new PlatformError("bad_request", MESSAGES.bad_request, { detail });
  return new PlatformError("unavailable", MESSAGES.unavailable, { detail });
}

function checkRequest(filename, data) {
  const name = String(filename || "").trim();
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  if (!name || name.length > 240 || !EXPORT_EXTENSIONS.includes(ext)) throw new PlatformError("rejected_extension", MESSAGES.extension);
  const size = typeof data === "string" ? data.length
    : data && typeof data.size === "number" ? data.size
    : data && typeof data.byteLength === "number" ? data.byteLength : 0;
  if (!size) throw new PlatformError("bad_request", MESSAGES.bad_request);
  return name;
}

/**
 * @param {object} downloads espace de noms résolu par `await window.claude.use("downloads")`
 * @returns {{ save(filename: string, data: string|Blob|ArrayBuffer|ArrayBufferView): Promise<"saved"|"declined"> }}
 */
export function createExporter(downloads) {
  return {
    extensions: EXPORT_EXTENSIONS,
    async save(filename, data) {
      const name = checkRequest(filename, data);
      // Un ArrayBuffer serait transféré (donc vidé) par la plateforme : on en passe une copie pour laisser le tien intact.
      const payload = data instanceof ArrayBuffer ? data.slice(0) : data;
      try {
        await downloads.save({ filename: name, data: payload });
        return "saved";
      } catch (err) {
        if (codeOf(err) === "declined") return "declined";
        throw exportError(err);
      }
    },
  };
}

const MIME = {
  csv: "text/csv;charset=utf-8",
  json: "application/json",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Mode local uniquement (page ouverte hors de Claude, donc hors du bac à sable) : téléchargement classique du navigateur.
 * Renvoie null quand il n'y a pas de document (tests Node).
 */
export function createLocalExporter(doc = typeof document !== "undefined" ? document : null) {
  if (!doc || typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return {
    extensions: EXPORT_EXTENSIONS,
    async save(filename, data) {
      const name = checkRequest(filename, data);
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      try {
        const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const link = doc.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", name);
        link.style.display = "none";
        doc.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* déjà libérée */ } }, 30000);
        return "saved";
      } catch (err) {
        throw exportError(err);
      }
    },
  };
}
