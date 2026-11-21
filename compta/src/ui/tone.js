// Vocabulaire commun des tons de couleur du kit.
//   neutral : gris, sans message particulier      accent : couleur de l'appli (indigo)
//   in  : entrée d'argent, succès                  out : sortie d'argent, erreur, danger
//   warn : à vérifier                              info : information

const TONES = ["neutral", "accent", "in", "out", "warn", "info"];

// On accepte les mots courants pour éviter les fautes de frappe silencieuses.
const ALIASES = {
  default: "neutral",
  muted: "neutral",
  primary: "accent",
  success: "in",
  ok: "in",
  positive: "in",
  error: "out",
  danger: "out",
  negative: "out",
  warning: "warn",
};

/** Ramène un ton (ou un alias : "success", "error", "warning"...) à l'un des six tons du kit. */
export function normTone(tone, fallback = "neutral") {
  const t = ALIASES[tone] || tone;
  return TONES.includes(t) ? t : fallback;
}

/** Icône associée à un ton (bandeaux, notifications). */
export const TONE_ICON = {
  neutral: "info",
  accent: "sparkles",
  in: "check-circle",
  out: "alert",
  warn: "alert",
  info: "info",
};

/**
 * Couleur d'une série ou d'une entité (associé, plateforme pub) : index 0 -> var(--chart-1).
 * L'ordre est fixe et n'est jamais recyclé : au-delà de 8, tout le monde prend le gris "Autres".
 * @param {number} index position stable de l'entité (pas son rang du moment)
 */
export function seriesColor(index) {
  const i = Math.floor(Number(index));
  return Number.isFinite(i) && i >= 0 && i < 8 ? `var(--chart-${i + 1})` : "var(--chart-muted)";
}

/** Encre lisible posée sur seriesColor(index) (étiquette dans une barre, initiales d'un avatar). */
export function seriesInk(index) {
  const i = Math.floor(Number(index));
  return Number.isFinite(i) && i >= 0 && i < 8 ? `var(--chart-${i + 1}-ink)` : "var(--on-fill)";
}

const TONE_FILL = {
  in: "var(--chart-in)",
  out: "var(--chart-out)",
  accent: "var(--chart-accent)",
  neutral: "var(--chart-muted)",
  warn: "var(--warn-fill)",
  info: "var(--info-fill)",
};

const TONE_INK = {
  warn: "var(--on-fill-dark)",
  accent: "var(--on-accent)",
};

/**
 * Résout la couleur d'une marque de graphique : `color` explicite, sinon `tone`, sinon la série n° index.
 * @returns {{ fill: string, ink: string }}
 */
export function markColor({ color, tone } = {}, index = 0) {
  if (color) return { fill: color, ink: "var(--on-fill)" };
  if (tone) {
    const t = normTone(tone);
    return { fill: TONE_FILL[t], ink: TONE_INK[t] || "var(--on-fill)" };
  }
  return { fill: seriesColor(index), ink: seriesInk(index) };
}
