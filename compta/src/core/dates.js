// Dates : on manipule des chaînes "AAAA-MM-JJ" (jour civil, sans fuseau) et des mois "AAAA-MM".

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_FR_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const MONTH_WORDS = {
  jan: 1, janv: 1, janvier: 1, january: 1,
  feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, juillet: 7, july: 7,
  aug: 8, aou: 8, aout: 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dec: 12, decembre: 12, december: 12,
};

const pad = (n) => String(n).padStart(2, "0");

export function isValidISO(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toISO(year, month, day) {
  const iso = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  return isValidISO(iso) ? iso : null;
}

/** Date du jour (fuseau de l'appareil) en "AAAA-MM-JJ". */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthOf(iso) {
  return typeof iso === "string" ? iso.slice(0, 7) : "";
}

export function currentMonth(now = new Date()) {
  return todayISO(now).slice(0, 7);
}

function toUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** "2026-11" + n mois -> "AAAA-MM". */
export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12 + 12) % 12 + 1)}`;
}

export function monthStart(month) {
  return month + "-01";
}

export function monthEnd(month) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(daysInMonth(y, m))}`;
}

/** Liste des mois de "AAAA-MM" à "AAAA-MM" inclus. */
export function monthRange(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  let cur = from;
  while (cur <= to && out.length < 600) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}

/** "2026-11" -> "novembre 2026" (ou "nov. 2026" en version courte). */
export function monthLabel(month, short = false) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  const name = (short ? MONTHS_FR_SHORT : MONTHS_FR)[m - 1] || "";
  return `${name} ${y}`;
}

/** "2026-11-21" -> "21 nov. 2026" ; style "long" -> "21 novembre 2026" ; style "court" -> "21/11/2026". */
export function formatDate(iso, style = "moyen") {
  if (!isValidISO(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (style === "court") return `${pad(d)}/${pad(m)}/${y}`;
  const day = d === 1 ? "1er" : String(d);
  if (style === "long") return `${day} ${MONTHS_FR[m - 1]} ${y}`;
  return `${day} ${MONTHS_FR_SHORT[m - 1]} ${y}`;
}

function fixYear(y) {
  if (y < 100) return y + (y < 70 ? 2000 : 1900);
  return y;
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Lit une date écrite de façon libre et renvoie "AAAA-MM-JJ" ou null.
 * Formats : 2026-11-21, 2026-11-21T11:15:29Z, 2026/11/21, 21/11/2026, 21-11-26, 21.11.2026, 11/21/2026 (order "MDY"),
 * "Nov 21, 2026", "November 21, 2026 at 3:14 AM PST", "21 nov. 2026", "21 novembre 2026", "1er mars 2026".
 * order : "DMY" (défaut), "MDY" ou "YMD" pour lever l'ambiguïté des formats numériques.
 */
export function parseDateLoose(input, order = "DMY") {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : todayISO(input);
  let s = String(input).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return toISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return toISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:[T\s,].*)?$/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = fixYear(+m[3]);
    let day, month;
    if (order === "MDY") { month = a; day = b; } else { day = a; month = b; }
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return toISO(y, month, day);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return toISO(+m[1], +m[2], +m[3]);
  const text = stripAccents(s.toLowerCase()).replace(/(\d)(?:er|st|nd|rd|th)\b/g, "$1");
  // "21 nov 2026", "21 novembre 2026"
  m = text.match(/(\d{1,2})\s+([a-z]{3,10})\.?,?\s+(\d{4})/);
  if (m && MONTH_WORDS[m[2]]) return toISO(+m[3], MONTH_WORDS[m[2]], +m[1]);
  // "nov 21, 2026", "november 21 2026"
  m = text.match(/([a-z]{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTH_WORDS[m[1]]) return toISO(+m[3], MONTH_WORDS[m[1]], +m[2]);
  // "nov 2026" -> premier du mois
  m = text.match(/^([a-z]{3,10})\.?\s+(\d{4})$/);
  if (m && MONTH_WORDS[m[1]]) return toISO(+m[2], MONTH_WORDS[m[1]], 1);
  return null;
}

/**
 * Devine l'ordre jour/mois d'une colonne de dates numériques à partir d'échantillons.
 * Renvoie "YMD", "DMY" ou "MDY" (défaut "DMY" si rien ne tranche).
 */
export function detectDateOrder(samples) {
  let dmy = 0, mdy = 0, ymd = 0;
  for (const raw of samples) {
    const s = String(raw || "").trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) { ymd++; continue; }
    const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  if (ymd > dmy && ymd > mdy) return "YMD";
  return mdy > dmy ? "MDY" : "DMY";
}

export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Vrai si iso est dans [from, to] (bornes facultatives, incluses). */
export function inRange(iso, from, to) {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}
