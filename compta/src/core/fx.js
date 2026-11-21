// Change : chaque montant reste dans sa devise d'origine, la conversion passe toujours par le dollar (devise pivot).
import { DEFAULT_RATES } from "./fx-rates.js";

export const PIVOT = "USD";
export { DEFAULT_RATES };

/** Mois utilisé quand la date est absente : on prend alors le taux le plus récent connu. */
const LATEST = "9999-12";
const MONTH_RE = /^\d{4}-\d{2}$/;

const validRate = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

function normCurrency(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normMonth(value) {
  if (typeof value !== "string") return LATEST;
  const month = value.slice(0, 7);
  return MONTH_RE.test(month) ? month : LATEST;
}

/**
 * Cherche un taux dans une entrée { default, months } : le mois demandé, sinon le mois connu le plus proche
 * avant, sinon le plus proche après, sinon `default`. Renvoie null si l'entrée ne donne rien.
 */
function lookup(entry, month) {
  if (!entry || typeof entry !== "object") return null;
  const months = entry.months;
  if (months && typeof months === "object") {
    if (validRate(months[month])) return months[month];
    let earlier = null;
    let later = null;
    for (const key of Object.keys(months)) {
      if (!MONTH_RE.test(key) || !validRate(months[key])) continue;
      if (key < month) {
        if (earlier === null || key > earlier) earlier = key;
      } else if (key > month) {
        if (later === null || key < later) later = key;
      }
    }
    if (earlier !== null) return months[earlier];
    if (later !== null) return months[later];
  }
  return validRate(entry.default) ? entry.default : null;
}

/**
 * Valeur en USD d'une unité de `currency` pour un mois donné.
 * Ordre de recherche : taux saisi pour le mois, mois saisi le plus proche avant, le plus proche après,
 * taux par défaut saisi, puis les taux intégrés (même ordre). USD vaut toujours 1 ; une devise inconnue aussi.
 * @param {object} config configuration (seul `config.fx` est lu), peut être null
 * @param {string} currency code devise ("EUR")
 * @param {string} month "AAAA-MM" (une date "AAAA-MM-JJ" est acceptée) ; absent : taux le plus récent
 * @param {object} [builtin] table de secours, par défaut DEFAULT_RATES (utile pour les tests)
 * @returns {number}
 */
export function rateToPivot(config, currency, month, builtin = DEFAULT_RATES) {
  const cur = normCurrency(currency);
  if (!cur || cur === PIVOT) return 1;
  const key = normMonth(month);
  const own = lookup(config && config.fx ? config.fx[cur] : null, key);
  if (own !== null) return own;
  const fallback = lookup(builtin ? builtin[cur] : null, key);
  return fallback !== null ? fallback : 1;
}

/** Arrondi au centime le plus proche, symétrique (un débit et un crédit du même montant donnent des valeurs opposées). */
function roundCents(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(Math.abs(value));
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
}

function convertWith(rate, cents, from, to, date) {
  const f = normCurrency(from);
  const t = normCurrency(to);
  const amount = Number.isFinite(cents) ? cents : 0;
  if (f === t) return { cents: amount, estimated: false };
  const month = normMonth(date);
  return { cents: roundCents((amount * rate(f, month)) / rate(t, month)), estimated: true };
}

/**
 * Convertit des centimes d'une devise vers une autre au taux du mois de `date`, en passant par le dollar.
 * @param {number} cents montant entier en centimes
 * @param {string} from devise de départ
 * @param {string} to devise d'arrivée
 * @param {string} date "AAAA-MM-JJ" (ou "AAAA-MM") ; absente : taux le plus récent connu
 * @param {object} config configuration (config.fx), peut être null
 * @returns {{ cents: number, estimated: boolean }} `estimated` est vrai dès que les deux devises diffèrent
 */
export function convert(cents, from, to, date, config) {
  return convertWith((cur, month) => rateToPivot(config, cur, month), cents, from, to, date);
}

/**
 * Convertisseur avec mémoire pour une configuration donnée : mêmes résultats que `convert`,
 * mais chaque couple devise + mois n'est cherché qu'une fois (utilisé par buildBook sur des milliers d'opérations).
 * @param {object} config
 * @returns {{ rate(currency: string, month: string): number, convert(cents: number, from: string, to: string, date: string): { cents: number, estimated: boolean } }}
 */
export function createFx(config) {
  const cache = new Map();
  const rate = (currency, month) => {
    const key = currency + "|" + month;
    let value = cache.get(key);
    if (value === undefined) {
      value = rateToPivot(config, currency, month);
      cache.set(key, value);
    }
    return value;
  };
  return {
    rate: (currency, month) => rate(normCurrency(currency), normMonth(month)),
    convert: (cents, from, to, date) => convertWith(rate, cents, from, to, date),
  };
}
