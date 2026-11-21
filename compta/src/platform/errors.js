// Erreurs de la couche plateforme : un code stable pour brancher, un message en français affichable tel quel.

/**
 * Erreur levée (ou promesse rejetée) par tout ce qui vit dans src/platform.
 * `message` : phrase en français, prête pour un toast. `code` : identifiant stable. `detail` : message technique d'origine.
 */
export class PlatformError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

/** Code d'une erreur quelconque ("" quand il n'y en a pas). */
export function codeOf(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "";
}

/** Message technique d'origine, pour la console. */
export function detailOf(error) {
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : "";
}

export const DB_MESSAGES = {
  read_only: "Tu es en lecture seule : tu ne peux pas modifier ces données.",
  too_large: "Ce document est devenu trop volumineux pour être enregistré. Allège-le (notes, détails) puis réessaie.",
  resource_exhausted: "Trop d'enregistrements d'un coup. Attends quelques secondes puis réessaie.",
  quota_exceeded: "L'espace de stockage est plein. Supprime des données ou des justificatifs dont tu n'as plus besoin, puis réessaie.",
  unavailable: "La base de données ne répond pas pour le moment. Réessaie dans un instant.",
  revoked: "Les données ne sont plus accessibles depuis cette page. Recharge la page pour continuer.",
  not_granted: "La base de données n'est pas disponible dans cette vue.",
  offline: "Connexion à la base impossible pour le moment : rien n'a été enregistré. Vérifie ta connexion puis réessaie.",
  internal: "Une erreur inattendue a empêché l'enregistrement. Réessaie, et si ça continue recharge la page.",
  closed: "Cette session de données est fermée. Recharge la page.",
};

const DB_CODES = new Set(["invalid_argument", "resource_exhausted", "quota_exceeded", "unavailable", "revoked"]);
const DB_LIFECYCLE = new Set(["not_granted", "capability_disabled", "capability_removed"]);

/**
 * Ramène une erreur de la base à un code connu.
 * Règle du contrat : un code inconnu se traite comme "unavailable". Une TypeError (chemin mal formé) est un bug : "internal".
 */
export function dbCode(error) {
  if (error instanceof PlatformError) return error.code;
  const code = codeOf(error);
  if (DB_CODES.has(code)) return code;
  if (DB_LIFECYCLE.has(code)) return "not_granted";
  if (code === "transform_error" || code === "internal" || error instanceof TypeError || error instanceof RangeError) return "internal";
  return "unavailable";
}

/** Erreur de base -> PlatformError en français (sans décider de la lecture seule : c'est le rôle du store). */
export function dbError(error) {
  if (error instanceof PlatformError) return error;
  const code = dbCode(error);
  return new PlatformError(code, DB_MESSAGES[code] || DB_MESSAGES.unavailable, { detail: detailOf(error) });
}
