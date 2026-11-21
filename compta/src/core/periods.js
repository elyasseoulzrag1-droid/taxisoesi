// Périodes d'analyse : préréglages de la barre du haut, date pivot, et une période par règle de partage du bénéfice.
import { isValidISO, addDays, addMonths, monthOf, monthStart, monthEnd, daysBetween, formatDate, todayISO } from "./dates.js";
import { shareTimeline } from "./model.js";

/** Période utilisée quand rien n'est choisi, ou quand l'identifiant demandé n'existe plus. */
export const DEFAULT_PERIOD = "all";

/** Préfixe des périodes de partage : "share:" + identifiant de la règle. */
export const SHARE_PERIOD_PREFIX = "share:";

/** Préréglages fixes. Les périodes qui dépendent des réglages (pivot, partage) sont ajoutées par listPeriods. */
export const PERIOD_PRESETS = Object.freeze([
  { id: "this_month", label: "Ce mois-ci" },
  { id: "last_month", label: "Le mois dernier" },
  { id: "last_30", label: "30 derniers jours" },
  { id: "last_90", label: "90 derniers jours" },
  { id: "this_year", label: "Cette année" },
  { id: "all", label: "Depuis le début" },
  { id: "custom", label: "Période personnalisée" },
].map(Object.freeze));

const PRESET_LABELS = Object.fromEntries(PERIOD_PRESETS.map((p) => [p.id, p.label]));

const validDate = (v) => (typeof v === "string" && isValidISO(v) ? v : null);

/** Dates courtes pour un libellé ("29 sept.") ; l'année n'apparaît que si une des dates n'est pas dans l'année en cours. */
function shortDates(dates, today) {
  const year = today.slice(0, 4);
  const sameYear = dates.every((d) => d.slice(0, 4) === year);
  return dates.map((d) => (sameYear ? formatDate(d).replace(/\s\d{4}$/, "") : formatDate(d)));
}

function lowerFirst(text) {
  if (text.length > 1 && text[1] !== text[1].toLowerCase()) return text; // sigle : on ne touche pas
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function rangeLabel(from, to, today, fallback) {
  if (from && to) {
    const [a, b] = shortDates([from, to], today);
    return `Du ${a} au ${b}`;
  }
  if (from) return `Depuis le ${shortDates([from], today)[0]}`;
  if (to) return `Jusqu'au ${shortDates([to], today)[0]}`;
  return fallback;
}

function sharePeriodLabel(period, today) {
  const n = period.partnerCount;
  const who = n > 0 ? `À ${n} associé${n > 1 ? "s" : ""}` : "Sans partage défini";
  const when = rangeLabel(period.startsOn, period.to, today, "depuis le début");
  return `${who} (${when.charAt(0).toLowerCase() + when.slice(1)})`;
}

function sharePeriods(config, today) {
  const timeline = shareTimeline(config);
  if (timeline.length < 2) return [];
  return timeline.map((period) => ({
    id: SHARE_PERIOD_PREFIX + period.ruleId,
    kind: "share",
    from: period.from,
    to: period.to,
    label: sharePeriodLabel(period, today),
  }));
}

function pivotPeriods(config, today) {
  const business = config && config.business;
  const pivot = business ? validDate(business.pivotDate) : null;
  if (!pivot) return [];
  const day = shortDates([pivot], today)[0];
  const what = typeof business.pivotLabel === "string" && business.pivotLabel.trim() ? ` (${lowerFirst(business.pivotLabel.trim())})` : "";
  return [
    { id: "before_pivot", kind: "pivot", from: null, to: addDays(pivot, -1), label: `Avant le ${day}${what}` },
    { id: "since_pivot", kind: "pivot", from: pivot, to: null, label: `Depuis le ${day}${what}` },
  ];
}

function customPeriod(custom, today) {
  let from = custom ? validDate(custom.from) : null;
  let to = custom ? validDate(custom.to) : null;
  if (from && to && from > to) [from, to] = [to, from];
  return { id: "custom", kind: "custom", from, to, label: rangeLabel(from, to, today, PRESET_LABELS.custom) };
}

function fixedPeriod(id, today) {
  const month = monthOf(today);
  const preset = (from, to) => ({ id, kind: "preset", from, to, label: PRESET_LABELS[id] });
  switch (id) {
    case "this_month":
      return preset(monthStart(month), monthEnd(month));
    case "last_month": {
      const previous = addMonths(month, -1);
      return preset(monthStart(previous), monthEnd(previous));
    }
    case "last_30":
      return preset(addDays(today, -29), today);
    case "last_90":
      return preset(addDays(today, -89), today);
    case "this_year":
      return preset(today.slice(0, 4) + "-01-01", today.slice(0, 4) + "-12-31");
    case "all":
      return preset(null, null);
    default:
      return null;
  }
}

/**
 * Toutes les périodes proposées dans le sélecteur, dans l'ordre d'affichage : les préréglages fixes, une
 * période par règle de partage du bénéfice (quand il y en a au moins deux), "avant" et "depuis" la date pivot
 * (sauf si une période de partage couvre déjà exactement les mêmes dates), puis la période personnalisée.
 * @param {object} config configuration normalisée
 * @param {string} [today] "AAAA-MM-JJ" (date du jour par défaut)
 * @param {{ from?: string|null, to?: string|null }} [custom] bornes de la période personnalisée
 * @returns {Array<{ id: string, kind: "preset"|"share"|"pivot"|"custom", from: string|null, to: string|null, label: string }>}
 */
export function listPeriods(config, today, custom) {
  const day = validDate(today) || todayISO();
  const out = [];
  for (const preset of PERIOD_PRESETS) if (preset.id !== "custom") out.push(fixedPeriod(preset.id, day));
  const shares = sharePeriods(config, day);
  out.push(...shares);
  for (const pivot of pivotPeriods(config, day)) {
    if (!shares.some((s) => s.from === pivot.from && s.to === pivot.to)) out.push(pivot);
  }
  out.push(customPeriod(custom, day));
  return out;
}

/**
 * Transforme un identifiant de période en dates. Les bornes sont incluses ; null veut dire "pas de borne".
 * Identifiants : "this_month", "last_month", "last_30", "last_90", "this_year", "all", "custom",
 * "before_pivot", "since_pivot", et "share:<identifiant de règle>" pour une période de partage du bénéfice.
 * Un identifiant inconnu (règle supprimée, pivot retiré) retombe sur "all".
 * @param {string} presetId
 * @param {object} config configuration normalisée
 * @param {string} [today] "AAAA-MM-JJ" (date du jour par défaut)
 * @param {{ from?: string|null, to?: string|null }} [custom] bornes quand presetId vaut "custom"
 * @returns {{ id: string, from: string|null, to: string|null, label: string }}
 */
export function resolvePeriod(presetId, config, today, custom) {
  const day = validDate(today) || todayISO();
  const id = typeof presetId === "string" ? presetId : DEFAULT_PERIOD;
  let found = null;
  if (id === "custom") found = customPeriod(custom, day);
  else if (id === "before_pivot" || id === "since_pivot") found = pivotPeriods(config, day).find((p) => p.id === id);
  else if (id.startsWith(SHARE_PERIOD_PREFIX)) {
    // Une seule règle : la période couvre tout, mais l'identifiant reste valable.
    const ruleId = id.slice(SHARE_PERIOD_PREFIX.length);
    const period = shareTimeline(config).find((p) => p.ruleId !== null && p.ruleId === ruleId);
    if (period) found = { id, from: period.from, to: period.to, label: sharePeriodLabel(period, day) };
  } else found = fixedPeriod(id, day);
  if (!found) found = fixedPeriod(DEFAULT_PERIOD, day);
  return { id: found.id, from: found.from, to: found.to, label: found.label };
}

/**
 * Période de comparaison : celle qui précède immédiatement, de même durée. Un mois entier donne le mois
 * précédent, une année entière l'année précédente. Renvoie null si la période n'a pas ses deux bornes.
 * @param {{ from: string|null, to: string|null }} period
 * @returns {{ from: string, to: string }|null}
 */
export function previousPeriod(period) {
  const from = period ? validDate(period.from) : null;
  const to = period ? validDate(period.to) : null;
  if (!from || !to || from > to) return null;
  const month = monthOf(from);
  if (from === monthStart(month) && to === monthEnd(month)) {
    const previous = addMonths(month, -1);
    return { from: monthStart(previous), to: monthEnd(previous) };
  }
  const year = from.slice(0, 4);
  if (from === year + "-01-01" && to === year + "-12-31") {
    const previous = String(Number(year) - 1).padStart(4, "0");
    return { from: previous + "-01-01", to: previous + "-12-31" };
  }
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}
