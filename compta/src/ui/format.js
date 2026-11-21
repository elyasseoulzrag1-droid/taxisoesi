// Mise en forme pour l'affichage (français). Fine couche au-dessus de src/core : aucun calcul métier ici.
// Tout ce qui s'affiche à l'écran passe par ces fonctions pour rester cohérent d'une page à l'autre.
import { CURRENCIES, formatMoney } from "../core/money.js";
import { formatDate, isValidISO, monthLabel, todayISO } from "../core/dates.js";

/** Signe moins typographique : même largeur qu'un chiffre, il s'aligne dans les colonnes. */
export const MINUS = "\u2212";
export const NBSP = "\u00a0";
/** Affiché quand il n'y a pas de valeur. */
export const EMPTY = "·";

const numberFormatters = new Map();
function numberFormatter(min, max) {
  const key = min + ":" + max;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormatters.set(key, f);
  }
  return f;
}

function typo(text) {
  return text.replace(/\u202f/g, NBSP).replace(/^-/, MINUS);
}

/**
 * Nombre au format français : fmtNumber(1234.5, 1) -> "1 234,5".
 * @param {number} n
 * @param {number} [digits] décimales maximum (0 par défaut)
 * @param {number} [minDigits] décimales minimum (0 par défaut)
 */
export function fmtNumber(n, digits = 0, minDigits = 0) {
  if (n == null || !Number.isFinite(n)) return "";
  const rounded = Number(n.toFixed(digits));
  return typo(numberFormatter(Math.min(minDigits, digits), digits).format(rounded === 0 ? 0 : rounded));
}

/**
 * Centimes -> "1 234,56 $" (format français, moins typographique).
 * @param {number|null} cents entier en centimes
 * @param {string} [currency] code devise, "USD" par défaut
 * @param {{ sign?: boolean, round?: boolean, code?: boolean, approx?: boolean, compact?: boolean }} [opts]
 *   sign : force le "+" sur un montant positif. round : sans les centimes (tableaux de bord).
 *   code : ajoute le code devise ("94,77 $ USD"). approx : préfixe "≈" (montant estimé par un taux de change).
 *   compact : abrège les grands montants ("12,5 k$"), pour les axes de graphiques.
 * @returns {string} "" si le montant est absent
 */
export function fmtMoney(cents, currency = "USD", opts = {}) {
  if (cents == null || !Number.isFinite(cents)) return "";
  let out = opts.compact ? fmtMoneyCompact(cents, currency) : typo(formatMoney(cents, currency, opts));
  if (opts.compact && opts.sign && cents > 0) out = "+" + out;
  if (opts.approx) out = "≈" + NBSP + out;
  return out;
}

/**
 * Montant abrégé pour les axes et les petites étiquettes : "950 $", "12,5 k$", "1,2 M$".
 * En dessous de 10 000 unités le montant reste entier (arrondi à l'unité).
 */
export function fmtMoneyCompact(cents, currency = "USD") {
  if (cents == null || !Number.isFinite(cents)) return "";
  const units = Math.abs(cents) / 100;
  if (units < 10000) return typo(formatMoney(cents, currency, { round: true }));
  const symbol = (CURRENCIES[currency] && CURRENCIES[currency].symbol) || currency;
  const big = units >= 1e6;
  const scaled = big ? units / 1e6 : units / 1000;
  const digits = scaled >= 100 ? 0 : 1;
  const body = fmtNumber(scaled, digits) + NBSP + (big ? "M" : "k") + symbol;
  return (cents < 0 ? MINUS : "") + body;
}

/**
 * Graduation d'axe pour un montant. Toutes les graduations d'un même axe prennent la même unité,
 * choisie d'après la plus grande : "500 $", "1 000 $" sous 10 000 ; "5 k$", "20 k$" au-delà ; puis "1,5 M$".
 * @param {number} cents valeur de la graduation
 * @param {string} [currency]
 * @param {number} [maxCents] plus grande graduation de l'axe en valeur absolue (par défaut : la valeur elle-même)
 */
export function fmtMoneyAxis(cents, currency = "USD", maxCents) {
  if (cents == null || !Number.isFinite(cents)) return "";
  const max = Math.abs(maxCents == null || !Number.isFinite(maxCents) ? cents : maxCents) / 100;
  if (max < 10000 || cents === 0) return typo(formatMoney(cents, currency, { round: true }));
  const symbol = (CURRENCIES[currency] && CURRENCIES[currency].symbol) || currency;
  const big = max >= 1e6;
  const scaled = Math.abs(cents) / 100 / (big ? 1e6 : 1000);
  return (cents < 0 ? MINUS : "") + fmtNumber(scaled, Number.isInteger(scaled) ? 0 : scaled < 10 ? 1 : 0, 0) + NBSP + (big ? "M" : "k") + symbol;
}

/**
 * Formateur de graduations à passer en `formatAxis` à BarChart ou LineChart : moneyAxis("USD").
 * @returns {(cents: number, axis?: { max: number }) => string}
 */
export function moneyAxis(currency = "USD") {
  return (cents, axis) => fmtMoneyAxis(cents, currency, axis ? axis.max : undefined);
}

/**
 * Pourcentage : fmtPct(12.34) -> "12 %", fmtPct(12.34, 1) -> "12,3 %".
 * @param {number|null} value déjà en pourcentage (12.3 pour 12,3 %), comme pct() du noyau
 * @param {number} [digits] décimales (0 par défaut)
 * @param {{ sign?: boolean }} [opts] sign : force le "+" (évolutions)
 */
export function fmtPct(value, digits = 0, opts = {}) {
  if (value == null || !Number.isFinite(value)) return "";
  const body = fmtNumber(value, digits);
  const signed = opts.sign && Number(value.toFixed(digits)) > 0 ? "+" + body : body;
  return signed + NBSP + "%";
}

/**
 * Ratio : fmtRatio(2.345) -> "2,35". opts.times ajoute le signe multiplié : "×2,35".
 * @param {number|null} ratio
 * @param {{ digits?: number, times?: boolean }} [opts]
 */
export function fmtRatio(ratio, opts = {}) {
  if (ratio == null || !Number.isFinite(ratio)) return "";
  const body = fmtNumber(ratio, opts.digits == null ? 2 : opts.digits);
  return opts.times ? "×" + body : body;
}

/**
 * Date : fmtDate("2026-11-21") -> "21 nov. 2026".
 * style : "moyen" (défaut), "long" ("21 novembre 2026"), "court" ("21/11/2026"),
 * "jour" ("21 nov.", sans l'année), "auto" (sans l'année si c'est l'année en cours).
 */
export function fmtDate(iso, style = "moyen", today = todayISO()) {
  if (!isValidISO(iso)) return "";
  if (style === "jour" || (style === "auto" && iso.slice(0, 4) === String(today).slice(0, 4))) {
    return formatDate(iso, "moyen").replace(/\s\d{4}$/, "");
  }
  return formatDate(iso, style === "auto" ? "moyen" : style);
}

/** Mois : fmtMonth("2026-11") -> "novembre 2026" ; fmtMonth("2026-11", true) -> "nov. 2026". */
export function fmtMonth(month, short = false) {
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) return "";
  return monthLabel(month, short);
}

/** Choisit le singulier ou le pluriel (en français, 0 et 1 sont au singulier). */
export function pluralWord(n, one, many) {
  return Math.abs(Number(n) || 0) < 2 ? one : many;
}

/**
 * Nombre suivi du mot accordé : plural(3, "opération", "opérations") -> "3 opérations",
 * plural(1, "opération", "opérations") -> "1 opération", plural(0, ...) -> "0 opération".
 */
export function plural(n, one, many) {
  const count = Number(n) || 0;
  return fmtNumber(count) + NBSP + pluralWord(count, one, many);
}

/** Initiales pour un avatar : "Rock Martin" -> "RM", "sam" -> "S". */
export function initials(name) {
  const words = String(name == null ? "" : name)
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0])[0] || "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] || "" : "";
  return (first + last).toUpperCase();
}

/** Taille de fichier : fmtFileSize(12345) -> "12 Ko". */
export function fmtFileSize(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return fmtNumber(bytes) + NBSP + "o";
  if (bytes < 1e6) return fmtNumber(bytes / 1000, bytes < 10000 ? 1 : 0) + NBSP + "Ko";
  return fmtNumber(bytes / 1e6, 1) + NBSP + "Mo";
}

/** Part d'un total en pourcentage affichable : fmtShare(25, 200) -> "13 %" ("" si le total est nul). */
export function fmtShare(part, total, digits = 0) {
  if (!total || !Number.isFinite(part) || !Number.isFinite(total)) return "";
  return fmtPct((part / total) * 100, digits);
}
