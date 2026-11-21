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
 * Accepte "1 234,56", "1,234.56", "1.234,56", "-12.5", "(12.50)", "12,50-", "$94.77", "94,77 €", "\u221212" (moins typographique).
 * opts.decimal : "," ou "." pour forcer le séparateur décimal (sinon deviné).
 */
export function parseAmountToCents(input, opts = {}) {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\u2212\u2012\u2013\u2014]/g, "-");
  if (/-\s*$/.test(s)) { negative = !negative; s = s.replace(/-\s*$/, ""); }
  if (/^\s*-/.test(s)) { negative = !negative; s = s.replace(/^\s*-/, ""); }
  s = s.replace(/^\s*\+/, "");
  // On ne garde que chiffres et séparateurs.
  s = s.replace(/[^0-9.,'\s\u00a0\u202f]/g, "").replace(/['\s\u00a0\u202f]/g, "");
  if (!/[0-9]/.test(s)) return null;
  let decimalSep = opts.decimal || null;
  if (!decimalSep) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      decimalSep = lastComma > lastDot ? "," : ".";
    } else if (lastComma >= 0 || lastDot >= 0) {
      const sep = lastComma >= 0 ? "," : ".";
      const count = s.split(sep).length - 1;
      const after = s.length - 1 - s.lastIndexOf(sep);
      // Un seul séparateur suivi de 3 chiffres ("1,234" ou "1.234") : séparateur de milliers.
      decimalSep = count > 1 || after === 3 ? null : sep;
      if (count === 1 && after === 3 && s.indexOf(sep) === 0) decimalSep = sep; // ".125"
    }
  }
  let intPart = s;
  let fracPart = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    if (idx >= 0) { intPart = s.slice(0, idx); fracPart = s.slice(idx + 1); }
  }
  intPart = intPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "");
  if (!intPart && !fracPart) return null;
  const whole = intPart ? parseInt(intPart, 10) : 0;
  if (!Number.isFinite(whole)) return null;
  const frac = (fracPart + "000").slice(0, 3);
  let cents = whole * 100 + parseInt(frac.slice(0, 2) || "0", 10);
  if (parseInt(frac[2] || "0", 10) >= 5) cents += 1;
  return negative ? -cents : cents;
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
  if (value < 0 && Math.round(Math.abs(cents)) > 0) out = "-" + out;
  else if (opts.sign && value > 0) out = "+" + out;
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
