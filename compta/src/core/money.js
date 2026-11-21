// Montants : toujours des entiers en centimes. On ne stocke jamais de nombre à virgule.

export const CURRENCIES = {
  USD: { code: "USD", symbol: "$", name: "Dollar américain" },
  EUR: { code: "EUR", symbol: "€", name: "Euro" },
  GBP: { code: "GBP", symbol: "£", name: "Livre sterling" },
  CAD: { code: "CAD", symbol: "$ CA", name: "Dollar canadien" },
  AUD: { code: "AUD", symbol: "$ AU", name: "Dollar australien" },
  CHF: { code: "CHF", symbol: "CHF", name: "Franc suisse" },
  MAD: { code: "MAD", symbol: "DH", name: "Dirham marocain" },
  AED: { code: "AED", symbol: "AED", name: "Dirham des Émirats" },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

const SYMBOL_HINTS = [
  [/€|\beur\b/i, "EUR"],
  [/£|\bgbp\b/i, "GBP"],
  [/\bcad\b|ca\$|\$\s?ca\b/i, "CAD"],
  [/\baud\b|au\$|a\$/i, "AUD"],
  [/\bchf\b/i, "CHF"],
  [/\bmad\b|\bdh\b|\bdhs\b/i, "MAD"],
  [/\baed\b/i, "AED"],
  [/\$|\busd\b|\bus\$/i, "USD"],
];

/** Devine la devise à partir d'un texte ("$94.77", "12,50 €", "USD"). Renvoie un code ou null. */
export function detectCurrency(text) {
  if (text == null) return null;
  const s = String(text);
  for (const [re, code] of SYMBOL_HINTS) if (re.test(s)) return code;
  return null;
}

/**
 * Lit un montant écrit par un humain ou un export et renvoie des centimes (entier), ou null.
 * Accepte "1 234,56", "1,234.56", "1.234,56", "-12.5", "(12.50)", "12,50-", "$94.77", "94,77 €", "−12" (moins typographique),
 * "$-12.50", "USD -12.50", "12,50- €" : le signe est cherché avant le premier chiffre et après le dernier.
 * Cas ambigus : un seul séparateur suivi de 3 chiffres et précédé de 1 à 3 chiffres ("1,234", "1.234", "12.345") est lu comme
 * des milliers ; "0,125" et "1234,567" sont des décimales. Les demi-centimes sont arrondis en s'éloignant de zéro.
 * opts.decimal : "," ou "." pour forcer le séparateur décimal (sinon deviné).
 */
export function parseAmountToCents(input, opts = {}) {
  if (input == null) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // toFixed gomme les artefacts binaires (1.005 * 100 = 100.49999...) ; arrondi symétrique, jamais de -0.
    const rounded = Math.round(Number((Math.abs(input) * 100).toFixed(6)));
    return input < 0 && rounded > 0 ? -rounded : rounded;
  }
  // Toutes les variantes typographiques du signe moins deviennent "-".
  const s = String(input).trim().replace(/[−‐‑‒–—﹣－]/g, "-");
  const first = s.search(/[0-9]/);
  if (first < 0) return null;
  let last = s.length - 1;
  while (last > first && !(s.charCodeAt(last) >= 48 && s.charCodeAt(last) <= 57)) last--;
  const before = s.slice(0, first);
  // "12.-" et "12,-" (notation suisse et allemande) valent 12,00 : ce tiret n'est pas un signe.
  const after = s.slice(last + 1).replace(/^[.,]-+/, "");
  // Négatif : un "-" avant le premier chiffre ("-$12", "$-12", "USD -12") ou après le dernier ("12,50-", "12,50- €"),
  // ou des parenthèses comptables autour du nombre. Deux marques ne s'annulent pas : "(-12,50)" reste négatif.
  const openParen = before.lastIndexOf("(") > before.lastIndexOf(")");
  const closeAt = after.indexOf(")");
  const closeParen = closeAt >= 0 && (after.indexOf("(") < 0 || closeAt < after.indexOf("("));
  const negative = before.includes("-") || after.includes("-") || (openParen && closeParen);
  let core = s.slice(first, last + 1);
  // ".5" ou "$.50" : un séparateur décimal collé au premier chiffre (mais pas le point d'une abréviation comme "Fr.12").
  const lead = before.slice(-1);
  if ((lead === "." || lead === ",") && !/[0-9A-Za-z.,]/.test(before.slice(-2, -1))) core = lead + core;
  // On ne garde que chiffres et séparateurs (les espaces et apostrophes de milliers disparaissent).
  core = core.replace(/[^0-9.,]/g, "");
  let decimalSep = opts.decimal === "," || opts.decimal === "." ? opts.decimal : null;
  if (!decimalSep) {
    const lastComma = core.lastIndexOf(",");
    const lastDot = core.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      decimalSep = lastComma > lastDot ? "," : ".";
    } else if (lastComma >= 0 || lastDot >= 0) {
      const sep = lastComma >= 0 ? "," : ".";
      const pos = core.lastIndexOf(sep);
      const count = core.split(sep).length - 1;
      const digitsAfter = core.length - 1 - pos;
      // Un seul séparateur est un séparateur de milliers seulement s'il est suivi de 3 chiffres exactement et précédé
      // de 1 à 3 chiffres sans zéro en tête : "1,234" et "1.234" valent 1234, mais "0,125" et "1234,567" sont des décimales.
      const thousands = count > 1 || (digitsAfter === 3 && /^[1-9][0-9]{0,2}$/.test(core.slice(0, pos)));
      decimalSep = thousands ? null : sep;
    }
  }
  let intPart = core;
  let fracPart = "";
  if (decimalSep) {
    const idx = core.lastIndexOf(decimalSep);
    if (idx >= 0) { intPart = core.slice(0, idx); fracPart = core.slice(idx + 1); }
  }
  intPart = intPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "");
  if (!intPart && !fracPart) return null;
  const whole = intPart ? parseInt(intPart, 10) : 0;
  if (!Number.isFinite(whole)) return null;
  const frac = (fracPart + "000").slice(0, 3);
  let cents = whole * 100 + parseInt(frac.slice(0, 2) || "0", 10);
  if (parseInt(frac[2] || "0", 10) >= 5) cents += 1;
  return negative && cents !== 0 ? -cents : cents;
}

/** Centimes -> texte pour un champ de saisie ("1234,56"). */
export function centsToInput(cents) {
  if (cents == null || !Number.isFinite(cents)) return "";
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const str = Math.floor(abs / 100) + "," + String(abs % 100).padStart(2, "0");
  return neg ? "-" + str : str;
}

const formatters = new Map();
function formatter(currency, digits) {
  const key = currency + ":" + digits;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formatters.set(key, f);
  }
  return f;
}

/**
 * Centimes -> "1 234,56 €" (format français).
 * opts.sign : true pour forcer le signe "+" sur les montants positifs.
 * opts.round : true pour arrondir à l'unité (tableaux de bord).
 * opts.code : true pour suffixer le code devise quand le symbole est ambigu ("94,77 $ USD").
 */
export function formatMoney(cents, currency = "EUR", opts = {}) {
  if (cents == null || !Number.isFinite(cents)) return "";
  const digits = opts.round ? 0 : 2;
  const value = cents / 100;
  let out = formatter(currency, digits).format(Math.abs(value)).replace(/\u202f/g, "\u00a0");
  if (opts.code) out += "\u00a0" + currency;
  // Pas de signe devant un montant affich\u00e9 \u00e0 z\u00e9ro (ex. -0,40 arrondi \u00e0 l'unit\u00e9).
  const shownZero = Math.round(opts.round ? Math.abs(value) : Math.abs(cents)) === 0;
  if (value < 0 && !shownZero) out = "-" + out;
  else if (opts.sign && value > 0 && !shownZero) out = "+" + out;
  return out;
}

/** Somme d'entiers en ignorant les valeurs vides. */
export function sumCents(values) {
  let total = 0;
  for (const v of values) if (Number.isFinite(v)) total += v;
  return total;
}

/** Pourcentage arrondi à une décimale, ou null si le dénominateur est nul. */
export function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}
