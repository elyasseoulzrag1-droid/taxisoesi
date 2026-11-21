// Logique pure du champ de montant (sans DOM, testée dans tests/unit/ui-money-input.test.mjs).
import { CURRENCIES, centsToInput, detectCurrency, parseAmountToCents } from "../core/money.js";

/**
 * Montant montré dans le champ pour une valeur stockée.
 * En mode "out" (formulaire "Dépense"), on montre un nombre positif alors que la valeur stockée est négative.
 * @param {number|null} cents valeur stockée (signée)
 * @param {"out"|"in"|null} sign
 * @returns {number|null}
 */
export function shownCents(cents, sign) {
  if (cents == null || !Number.isFinite(cents)) return null;
  const shown = sign === "out" ? -cents : cents;
  return shown === 0 ? 0 : shown;
}

/**
 * Texte saisi -> centimes stockés (entier signé) ou null si le texte n'est pas un montant.
 * Mode "out" : "12,50" -> -1250 (et "-12,50" -> 1250, une dépense négative est un remboursement).
 * Mode "in" ou sans mode : le signe saisi est gardé tel quel.
 */
export function textToCents(text, sign) {
  const parsed = parseAmountToCents(text);
  if (parsed == null) return null;
  const stored = sign === "out" ? -parsed : parsed;
  return stored === 0 ? 0 : stored;
}

/** Centimes stockés -> texte du champ ("1234,56"), "" si absent. */
export function centsToText(cents, sign) {
  const shown = shownCents(cents, sign);
  return shown == null ? "" : centsToInput(shown);
}

/** Devise reconnue dans le texte saisi ("12 €", "$12", "12 usd"), ou null. */
export function currencyInText(text) {
  const code = detectCurrency(text);
  return code && CURRENCIES[code] ? code : null;
}

/** Symbole court d'une devise pour l'affichage dans le champ. */
export function currencySymbol(code) {
  return (CURRENCIES[code] && CURRENCIES[code].symbol) || code || "";
}
