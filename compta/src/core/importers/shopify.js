// Importeurs des exports Shopify : liste des virements (payouts), transactions des virements, commandes, factures Shopify.
// Logique pure : chaque importeur reçoit le résultat de parseCsv et renvoie des brouillons d'opérations ou des statistiques.
// Règles communes : le fichier fait foi pour les montants (jamais recalculés quand le total est donné), une ligne illisible
// est ignorée avec un avertissement qui cite son numéro, et parse() ne lève jamais d'exception.

import { normHeader, findColumn } from "./csv.js";
import { parseAmountToCents, formatMoney, detectCurrency, pct } from "../money.js";
import { parseDateLoose, detectDateOrder, formatDate } from "../dates.js";
import { suggestCategory } from "../rules.js";

const SOURCE = "shopify";
const PARTY = "Shopify";
const PAYOUT_PREFIX = "shopify_payout:";
const BILL_PREFIX = "shopify_bill:";
// Clé d'un virement sans identifiant Shopify : date + montant en centimes (+ rang si deux virements identiques le même jour).
const DAY_KEY = /^\d{4}-\d{2}-\d{2}:-?\d+(?::\d+)?$/;
// Au-delà de dix milliards, une cellule n'est pas un montant (identifiant, texte collé) : elle est traitée comme illisible,
// ce qui garde aussi toutes les sommes dans les entiers sûrs.
const MAX_CENTS = 1e12;

/* ------------------------------------------------------------------ lecture du fichier */

function openFile(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const headers = Array.isArray(p.headers) ? p.headers.map((h) => (h == null ? "" : String(h))) : [];
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const lineNumbers = Array.isArray(p.lineNumbers) ? p.lineNumbers : [];
  const headerLine = Number.isInteger(p.headerLine) && p.headerLine > 0 ? p.headerLine : 1;
  return {
    headers,
    rows,
    names: new Set(headers.map(normHeader)),
    col: (...candidates) => findColumn(headers, candidates),
    line: (i) => (Number.isInteger(lineNumbers[i]) ? lineNumbers[i] : headerLine + 1 + i),
  };
}

function cell(row, index) {
  if (index < 0 || !Array.isArray(row) || row[index] == null) return "";
  return String(row[index]).trim();
}

// Séparateur décimal du fichier, déduit des cellules sans ambiguïté ("397.65", "1 289,50", "1,234.56").
// Sans cela "12.345" (trois décimales) serait lu comme douze mille. null = rien ne tranche, chaque cellule est devinée.
function sniffDecimal(rows, indexes) {
  let dot = 0;
  let comma = 0;
  const limit = Math.min(rows.length, 3000);
  for (let r = 0; r < limit; r++) {
    for (const index of indexes) {
      const s = cell(rows[r], index);
      if (!s) continue;
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      if (lastDot >= 0 && lastComma >= 0) {
        if (lastDot > lastComma) dot++; else comma++;
        continue;
      }
      const m = /([.,])(\d+)\D*$/.exec(s);
      if (!m || m[2].length === 3) continue;
      if (m[1] === ".") dot++; else comma++;
    }
  }
  if (dot && !comma) return ".";
  if (comma && !dot) return ",";
  return null;
}

// Lecteurs de montants d'un fichier : amt() renvoie null pour une cellule vide ou illisible, amt0() renvoie 0.
function moneyReaders(rows, indexes) {
  const decimal = sniffDecimal(rows, indexes.filter((i) => i >= 0));
  const opts = decimal ? { decimal } : {};
  const amt = (row, index) => {
    const raw = cell(row, index);
    if (!raw) return null;
    const cents = parseAmountToCents(raw, opts);
    return Number.isSafeInteger(cents) && Math.abs(cents) <= MAX_CENTS ? cents : null;
  };
  const amt0 = (row, index) => amt(row, index) || 0;
  return { amt, amt0 };
}

// Lecteur de dates d'un fichier : l'ordre jour/mois est deviné une fois sur la colonne (fichier repassé par un tableur).
function dateReader(rows, index) {
  const samples = [];
  for (let r = 0; r < rows.length && samples.length < 300; r++) {
    const s = cell(rows[r], index);
    if (s) samples.push(s);
  }
  const order = detectDateOrder(samples) === "MDY" ? "MDY" : "DMY";
  return (raw) => (raw ? parseDateLoose(raw, order) : null);
}

const TOTAL_WORD = /^(?:grand |sous |sub ?)?(?:total|totaux|totals)\b|^(?:somme|sum)\b/;

// Ligne de total ajoutée en bas du fichier : elle commence par "Total", ou ne contient que des nombres.
function isTotalRow(row) {
  if (!Array.isArray(row)) return false;
  let filled = 0;
  let numeric = 0;
  for (const value of row) {
    const s = value == null ? "" : String(value).trim();
    if (!s) continue;
    if (!filled && TOTAL_WORD.test(normHeader(s))) return true;
    filled++;
    if (/^[-+(]?[\d\s.,'\u00a0\u202f]*\d\)?$/.test(s)) numeric++;
  }
  return filled > 0 && numeric === filled;
}

function readCurrency(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (/^[A-Z]{3}$/.test(s)) return s;
  return detectCurrency(s);
}

function accountOf(ctx) {
  const accounts = ctx && ctx.config && ctx.config.accounts;
  const account = accounts && typeof accounts === "object" && ctx.accountId != null ? accounts[ctx.accountId] : null;
  return account && typeof account === "object" ? account : null;
}

// Devise utilisée quand le fichier n'en donne pas : option, puis compte choisi, puis devise de l'entreprise.
function fallbackCurrency(ctx) {
  const account = accountOf(ctx);
  return readCurrency(ctx && ctx.options && ctx.options.currency)
    || readCurrency(account && account.currency)
    || readCurrency(ctx && ctx.config && ctx.config.business && ctx.config.business.baseCurrency)
    || "USD";
}

/* ------------------------------------------------------------------ textes */

const money = (cents, currency) => formatMoney(cents, currency);
const neg = (cents) => (cents === 0 ? 0 : -cents);
const dayMonth = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const plural = (n, one, many) => n + " " + (n > 1 ? many : one);
const period = (from, to) => (from === to ? "le " + formatDate(from, "court") : "du " + formatDate(from, "court") + " au " + formatDate(to, "court"));

function quote(text) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return "\"" + (s.length > 40 ? s.slice(0, 40) + "..." : s) + "\"";
}

function emptyResult() {
  return { drafts: [], stats: null, warnings: [], info: [] };
}

// parse() ne doit jamais lever d'exception : un fichier inattendu donne un résultat vide et un avertissement.
function safely(parse) {
  return (parsed, ctx) => {
    try {
      return parse(parsed, ctx && typeof ctx === "object" ? ctx : {});
    } catch {
      const out = emptyResult();
      out.warnings.push("Ce fichier n'a pas pu être lu : rien n'a été importé. Vérifie que c'est bien un export CSV de Shopify, non modifié.");
      return out;
    }
  };
}

function sanity(f, check) {
  let seen = 0;
  let ok = 0;
  for (let i = 0; i < f.rows.length && seen < 5; i++) {
    seen++;
    if (check(f.rows[i])) ok++;
  }
  return seen === 0 || ok * 2 >= seen;
}

function safeDetect(detect) {
  return (parsed) => {
    try {
      const score = detect(openFile(parsed));
      return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
    } catch {
      return 0;
    }
  };
}

/* ------------------------------------------------------------------ virements : parties communes */

const STATUS_PAID = new Set(["paid", "deposited", "withdrawn", "succeeded", "success", "complete", "completed"]);
const STATUS_UPCOMING = new Set(["scheduled", "in transit", "processing"]);
const STATUS_FAILED = new Set(["failed", "failure", "canceled", "cancelled", "declined", "returned"]);

/**
 * Statut d'un virement Shopify.
 * @returns {{ cls: "paid"|"upcoming"|"pending"|"failed"|"unknown", code: string }} code : le statut du fichier, en minuscules
 */
function payoutStatus(raw) {
  const s = normHeader(raw);
  const code = s.replace(/ /g, "_");
  if (STATUS_PAID.has(s)) return { cls: "paid", code: "paid" };
  if (STATUS_UPCOMING.has(s)) return { cls: "upcoming", code };
  if (s === "pending") return { cls: "pending", code };
  if (STATUS_FAILED.has(s)) return { cls: "failed", code };
  return { cls: "unknown", code };
}

// Un identifiant de virement abîmé par un tableur ("1,34773E+11") ne doit pas servir de clé.
function cleanPayoutId(raw) {
  return /^[A-Za-z0-9_-]{3,40}$/.test(raw) ? raw : "";
}

function bookOps(book) {
  return book && Array.isArray(book.ops) ? book.ops : [];
}

/**
 * Fabrique les identifiants externes des virements : "shopify_payout:<identifiant Shopify>" quand le fichier le donne,
 * sinon "shopify_payout:<date>:<montant en centimes>".
 * La liste des virements n'a pas d'identifiant alors que l'export des transactions en a un : pour que le même virement
 * importé depuis les deux fichiers ne soit jamais compté deux fois, on reprend la clé de l'opération déjà enregistrée
 * (même date et même montant) quand elle existe dans le journal.
 */
function payoutKeyMaker(book) {
  const known = new Set();
  const twins = new Map();
  for (const op of bookOps(book)) {
    if (!op || typeof op.extId !== "string" || !op.extId.startsWith(PAYOUT_PREFIX)) continue;
    known.add(op.extId);
    if (DAY_KEY.test(op.extId.slice(PAYOUT_PREFIX.length))) continue;
    const base = op.date + ":" + op.amountCents;
    if (!twins.has(base)) twins.set(base, []);
    twins.get(base).push(op.extId);
  }
  const seen = new Map();
  return (payoutId, date, totalCents) => {
    const base = date + ":" + totalCents;
    const rank = (seen.get(base) || 0) + 1;
    seen.set(base, rank);
    const dayKey = PAYOUT_PREFIX + base + (rank > 1 ? ":" + rank : "");
    if (payoutId) {
      const idKey = PAYOUT_PREFIX + payoutId;
      return known.has(idKey) || !known.has(dayKey) ? idKey : dayKey;
    }
    if (known.has(dayKey)) return dayKey;
    const same = twins.get(base);
    return same && same[rank - 1] ? same[rank - 1] : dayKey;
  };
}

/**
 * Compare les brouillons aux virements Shopify déjà enregistrés et prévient quand le journal et le fichier se contredisent :
 * même virement avec un autre montant, estimation devenue un vrai virement, ou ancien virement "à vérifier" du même jour
 * avec un autre montant (estimation dépassée, export coupé) qui ferait compter deux fois les mêmes ventes.
 */
function payoutBookRemarks(out, book, drafts) {
  const existing = new Map();
  const uncertain = new Map();
  for (const op of bookOps(book)) {
    if (!op || typeof op.extId !== "string" || !op.extId.startsWith(PAYOUT_PREFIX) || !Number.isSafeInteger(op.amountCents)) continue;
    if (!existing.has(op.extId)) existing.set(op.extId, op);
    if (op.needsReview !== true && op.estimated !== true) continue;
    if (!uncertain.has(op.date)) uncertain.set(op.date, []);
    uncertain.get(op.date).push(op);
  }
  if (!existing.size) return;
  const claimed = new Set(drafts.map((d) => d.extId));
  for (const d of drafts) {
    const day = dayMonth(d.date);
    const old = existing.get(d.extId);
    if (old) {
      if (old.amountCents !== d.amountCents) {
        out.warnings.push(`Le virement du ${day} est déjà dans tes opérations pour ${money(old.amountCents, old.currency || d.currency)}, ` +
          `alors que le fichier indique ${money(d.amountCents, d.currency)} : il est reconnu comme déjà importé, corrige le montant de l'opération existante.`);
      } else if (old.estimated === true && !d.estimated) {
        out.info.push(`Le virement du ${day} (${money(d.amountCents, d.currency)}), importé comme estimation, est maintenant versé : tu peux le confirmer dans tes opérations.`);
      }
      continue;
    }
    for (const op of uncertain.get(d.date) || []) {
      if (claimed.has(op.extId) || op.currency !== d.currency || op.amountCents === d.amountCents) continue;
      claimed.add(op.extId);
      out.warnings.push(`Un virement Shopify du ${day} est déjà dans tes opérations avec un autre montant (${money(op.amountCents, op.currency)}, à vérifier) : ` +
        "si c'est le même virement, supprime l'ancien pour ne pas le compter deux fois.");
    }
  }
}

/**
 * Brouillon d'opération pour un virement : une seule opération "pl" au montant net, ventilée par catégorie.
 * @param {object} ctx
 * @param {{ date: string, totalCents: number, currency: string, splits: Array<[string, number]>, extId: string,
 *   review: boolean, estimated: boolean, ref?: string, notes?: string[], meta: object }} p
 *   splits : la somme doit valoir totalCents. notes : raisons du "À vérifier", montrées dans l'aperçu de l'import.
 */
function payoutDraft(ctx, p) {
  const draft = {
    kind: "pl",
    date: p.date,
    label: (p.totalCents < 0 ? "Prélèvement Shopify du " : "Virement Shopify du ") + dayMonth(p.date),
    ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
    amountCents: p.totalCents,
    currency: p.currency,
    splits: p.splits.filter((s) => s[1] !== 0).map((s) => ({ categoryId: s[0], amountCents: s[1] })),
    party: PARTY,
    source: SOURCE,
    extId: p.extId,
    needsReview: !!p.review,
    meta: p.meta,
  };
  if (p.ref) draft.ref = p.ref;
  if (p.estimated) draft.estimated = true;
  if (p.notes && p.notes.length) draft._note = p.notes.join(" ");
  return draft;
}

function otherBucket(cents) {
  return cents > 0 ? "other_income" : "other_expense";
}

function otherBucketName(cents) {
  return cents > 0 ? "\"Autres encaissements\"" : "\"Autres dépenses\"";
}

// Résumé commun aux deux importeurs de virements : période, totaux versés et à venir par devise.
function payoutSummary(out, ctx, drafts, intro) {
  const lines = [];
  if (!drafts.length) return lines;
  let from = drafts[0].date;
  let to = drafts[0].date;
  const byCurrency = new Map();
  for (const d of drafts) {
    if (d.date < from) from = d.date;
    if (d.date > to) to = d.date;
    let t = byCurrency.get(d.currency);
    if (!t) byCurrency.set(d.currency, t = { paid: 0, paidCents: 0, upcoming: 0, upcomingCents: 0, sales: 0, refunds: 0, fees: 0 });
    if (d.estimated) { t.upcoming++; t.upcomingCents += d.amountCents; continue; }
    t.paid++;
    t.paidCents += d.amountCents;
    for (const s of d.splits) {
      if (s.categoryId === "sales_shopify") t.sales += s.amountCents;
      else if (s.categoryId === "refunds") t.refunds += s.amountCents;
      else if (s.categoryId === "fees_payment") t.fees += s.amountCents;
    }
  }
  lines.push(intro + " " + period(from, to) + ".");
  const account = accountOf(ctx);
  const accountCurrency = readCurrency(account && account.currency);
  for (const [currency, t] of byCurrency) {
    if (t.paid) {
      lines.push(`Déjà versé : ${money(t.paidCents, currency)} en ${plural(t.paid, "virement", "virements")} (ventes ${money(t.sales, currency)}, ` +
        `remboursements ${money(t.refunds, currency)}, frais de paiement ${money(t.fees, currency)}).`);
    }
    if (t.upcoming) {
      lines.push(`Pas encore versé : ${money(t.upcomingCents, currency)} en ${plural(t.upcoming, "virement", "virements")}, ` +
        "importé comme estimation et marqué \"À vérifier\" : confirme-le quand l'argent est arrivé sur ton compte.");
    }
    if (accountCurrency && accountCurrency !== currency) {
      out.warnings.push(`Ces virements sont en ${currency} alors que le compte choisi est en ${accountCurrency} : ` +
        "vérifie que c'est bien le compte qui reçoit les virements Shopify.");
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ 1. liste des virements */

const PAYOUT_PARTS = ["charges", "refunds", "adjustments", "marketTax", "advances", "reserved", "fees", "duties", "labels"];

// Ce que les colonnes du fichier expliquent du total (hors montant reporté d'un virement échoué).
function explainedCents(e) {
  return e.charges + e.marketTax + e.refunds - e.fees + e.adjustments + e.reserved + e.advances + e.duties + e.labels;
}

// Un virement qui reprend le montant d'un virement échoué ("Retried Amount") en absorbe le détail :
// les ventes, remboursements et frais du virement échoué sont comptés là où l'argent a vraiment bougé.
function absorbRetry(entry, failed, depth) {
  if (!entry.retried) return;
  let best = null;
  for (const cand of failed) {
    if (cand.used || cand === entry || cand.currency !== entry.currency || cand.totalCents !== entry.retried || cand.date > entry.date) continue;
    if (!best || cand.date > best.date) best = cand;
  }
  if (!best) return;
  best.used = true;
  best.mergedInto = entry.date;
  if (depth < 8) absorbRetry(best, failed, depth + 1);
  for (const key of PAYOUT_PARTS) entry[key] += best[key];
  entry.retried = best.retried;
  entry.retriedFrom.push(best.date, ...best.retriedFrom);
}

function detectPayouts(f) {
  const h = f.names;
  if (!h.has("payout date") || h.has("transaction date") || !h.has("charges")) return 0;
  const core = ["status", "refunds", "fees", "total"].filter((name) => h.has(name)).length;
  let score;
  if (core === 4) score = h.has("retried amount") || h.has("reserved funds") ? 1 : 0.9;
  else if (core >= 2) score = 0.5;
  else return 0;
  const iDate = f.col("payout date");
  const iTotal = f.col("total");
  const ok = sanity(f, (row) => !!parseDateLoose(cell(row, iDate)) && (iTotal < 0 || parseAmountToCents(cell(row, iTotal)) !== null));
  return ok ? score : score * 0.5;
}

/**
 * Liste des virements (Finances > Versements > Exporter) : une opération par virement, au montant net ("Total").
 * Ventilation : ventes (Charges + taxe retenue), remboursements, frais de paiement, litiges et ajustements (Adjustments,
 * réserve, avances) ; ce que les colonnes n'expliquent pas va en "Autres encaissements" ou "Autres dépenses", avec un avertissement.
 * Versé : needsReview false. Pas encore versé (scheduled, in_transit) : gardé, estimated et needsReview.
 * Échoué ou annulé : ignoré, et son détail est repris par le virement qui porte son montant dans "Retried Amount".
 * @param {object} parsed résultat de parseCsv
 * @param {object} ctx { config, book, accountId, options }
 * @returns {{ drafts: object[], stats: null, warnings: string[], info: string[] }}
 */
function parsePayouts(parsed, ctx) {
  const out = emptyResult();
  const f = openFile(parsed);
  if (!f.rows.length) {
    out.warnings.push("Le fichier ne contient aucun virement.");
    return out;
  }
  const c = {
    date: f.col("payout date", /^payout date/, "date"),
    status: f.col("status", "payout status", "statut"),
    charges: f.col("charges", "gross"),
    refunds: f.col("refunds"),
    adjustments: f.col("adjustments", "adjustment"),
    marketTax: f.col("marketplace sales tax"),
    advances: f.col("advances", "advance"),
    reserved: f.col("reserved funds", "reserves", "reserve"),
    fees: f.col("fees", "fee"),
    retried: f.col("retried amount", "retried"),
    total: f.col("total", "net", "amount"),
    currency: f.col("currency", "devise"),
    bankRef: f.col("bank reference", "bank ref"),
    payoutId: f.col("payout id"),
    duties: f.col("duties and import taxes", /^duties/),
    labels: f.col("labels", "shipping labels"),
  };
  if (f.names.has("transaction date")) {
    out.warnings.push("Ce fichier est l'export des transactions, pas la liste des virements : choisis le type \"Transactions des virements Shopify\".");
    return out;
  }
  if (c.date < 0 || (c.total < 0 && c.charges < 0)) {
    out.warnings.push("Colonne \"Payout Date\" introuvable : ce fichier ne ressemble pas à l'export des virements Shopify (Finances > Versements > Exporter).");
    return out;
  }
  if (c.total < 0) out.warnings.push("Colonne \"Total\" absente : le montant de chaque virement est recalculé à partir des autres colonnes, vérifie-le avec ton relevé.");
  if (c.status < 0) out.warnings.push("Colonne \"Status\" absente : tous les virements sont considérés comme versés.");

  const { amt, amt0 } = moneyReaders(f.rows, [c.charges, c.refunds, c.adjustments, c.marketTax, c.advances, c.reserved, c.fees, c.retried, c.total, c.duties, c.labels]);
  const readDate = dateReader(f.rows, c.date);
  const fallback = fallbackCurrency(ctx);
  let assumedCurrency = false;

  const entries = [];
  for (let i = 0; i < f.rows.length; i++) {
    const row = f.rows[i];
    const line = f.line(i);
    const rawDate = cell(row, c.date);
    const date = readDate(rawDate);
    if (!date) {
      if (isTotalRow(row)) continue;
      out.warnings.push(rawDate
        ? `Ligne ${line} : date du virement illisible (${quote(rawDate)}), ligne ignorée.`
        : `Ligne ${line} : date du virement absente, ligne ignorée.`);
      continue;
    }
    const e = { index: i, line, date, used: false, mergedInto: null, retriedFrom: [] };
    for (const key of PAYOUT_PARTS) e[key] = amt0(row, c[key]);
    e.retried = amt0(row, c.retried);
    if (c.total >= 0) {
      e.totalCents = amt(row, c.total);
      if (e.totalCents === null) {
        out.warnings.push(`Ligne ${line} : montant total du virement du ${dayMonth(date)} absent ou illisible, ligne ignorée.`);
        continue;
      }
    } else {
      e.totalCents = explainedCents(e) + e.retried;
    }
    const status = c.status >= 0 ? payoutStatus(cell(row, c.status)) : { cls: "paid", code: "paid" };
    // "pending" n'existe pas dans cet export : on le traite comme un virement à venir.
    e.cls = status.cls === "pending" ? "upcoming" : status.cls;
    e.status = status.code;
    e.rawStatus = cell(row, c.status);
    e.currency = readCurrency(cell(row, c.currency));
    if (!e.currency) { e.currency = fallback; assumedCurrency = true; }
    e.bankRef = cell(row, c.bankRef);
    e.payoutId = cleanPayoutId(cell(row, c.payoutId));
    entries.push(e);
  }

  const failed = entries.filter((e) => e.cls === "failed");
  const kept = entries.filter((e) => e.cls !== "failed");
  // Les virements les plus anciens choisissent d'abord leur virement échoué.
  for (const e of kept.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.index - a.index))) absorbRetry(e, failed, 0);

  const extIdFor = payoutKeyMaker(ctx.book);
  const remarks = [];
  let zero = 0;
  for (const e of kept) {
    if (e.totalCents === 0) { zero++; continue; }
    const cur = e.currency;
    const where = `Virement du ${dayMonth(e.date)} (ligne ${e.line})`;
    const other = e.totalCents - explainedCents(e);
    const notes = [];
    if (e.cls === "upcoming") notes.push("Pas encore versé par Shopify : montant estimé.");
    if (other !== 0) {
      notes.push(`${money(Math.abs(other), cur)} non expliqués par le fichier.`);
      if (e.retried !== 0 && other === e.retried) {
        out.warnings.push(`${where} : ${money(Math.abs(other), cur)} viennent du report d'un virement échoué dont le détail n'est pas dans ce fichier. ` +
          `Ce montant est classé en ${otherBucketName(other)}, à vérifier.`);
      } else {
        out.warnings.push(`${where} : les colonnes du fichier n'expliquent pas ${money(Math.abs(other), cur)} du total (souvent des frais de litige). ` +
          `L'écart est classé en ${otherBucketName(other)}, à vérifier.`);
      }
    }
    if (e.cls === "unknown") {
      notes.push("Statut du virement non reconnu.");
      out.warnings.push(`${where} : statut ${e.rawStatus ? quote(e.rawStatus) : "absent"} non reconnu, virement importé et marqué "À vérifier".`);
    }
    if (e.reserved !== 0) {
      remarks.push(e.reserved < 0
        ? `Virement du ${dayMonth(e.date)} : Shopify a mis ${money(-e.reserved, cur)} en réserve (classé en "Litiges et rétrofacturations"). Ce montant reviendra dans un prochain virement.`
        : `Virement du ${dayMonth(e.date)} : Shopify a libéré ${money(e.reserved, cur)} de sa réserve.`);
    }
    if (e.totalCents < 0 && e.cls === "paid") {
      remarks.push(`Le ${dayMonth(e.date)}, Shopify a repris ${money(-e.totalCents, cur)} sur ton compte (plus de remboursements que de ventes) : c'est une sortie d'argent.`);
    }
    const meta = {};
    if (e.payoutId) meta.payoutId = e.payoutId;
    meta.status = e.status || "unknown";
    meta.grossCents = e.charges;
    meta.refundsCents = neg(e.refunds);
    meta.feesCents = e.fees;
    meta.adjustmentsCents = e.totalCents - e.charges - e.refunds + e.fees;
    if (e.reserved !== 0) meta.reservedCents = e.reserved;
    if (other !== 0) meta.unexplainedCents = other;
    if (e.retriedFrom.length) meta.retriedFrom = e.retriedFrom[0];
    if (e.bankRef) meta.bankRef = e.bankRef;
    meta.export = "payouts";
    out.drafts.push(payoutDraft(ctx, {
      date: e.date,
      totalCents: e.totalCents,
      currency: cur,
      splits: [
        ["sales_shopify", e.charges + e.marketTax],
        ["refunds", e.refunds],
        ["fees_payment", neg(e.fees)],
        ["chargebacks", e.adjustments + e.reserved + e.advances],
        ["taxes", e.duties],
        ["shipping", e.labels],
        [otherBucket(other), other],
      ],
      extId: extIdFor(e.payoutId, e.date, e.totalCents),
      review: e.cls !== "paid" || other !== 0,
      estimated: e.cls === "upcoming",
      ref: e.bankRef,
      notes,
      meta,
    }));
  }

  out.info.push(...payoutSummary(out, ctx, out.drafts, plural(out.drafts.length, "virement Shopify", "virements Shopify")), ...remarks);
  payoutBookRemarks(out, ctx.book, out.drafts);
  for (const e of failed) {
    const what = `Le virement ${/^cancel/.test(e.status) ? "annulé" : "échoué"} du ${dayMonth(e.date)} (${money(e.totalCents, e.currency)}) n'est pas importé : l'argent n'a pas bougé.`;
    out.info.push(e.mergedInto ? `${what} Son contenu est repris dans le virement du ${dayMonth(e.mergedInto)}.` : what);
  }
  if (zero) out.info.push(`${plural(zero, "virement à 0 ignoré", "virements à 0 ignorés")} : aucun argent n'a bougé.`);
  if (assumedCurrency) out.info.push(`Devise absente du fichier : montants lus en ${fallback}.`);
  if (!out.drafts.length && !out.warnings.length) out.warnings.push("Aucun virement à importer dans ce fichier.");
  return out;
}

/* ------------------------------------------------------------------ 2. transactions des virements */

// Le virement lui-même : absent des exports réels, mais présent dans l'API et dans certains fichiers reconstitués.
const TX_ITSELF = new Set(["payout", "transfer"]);
const TX_RETRY = /^(?:payout|transfer) (?:failure|failed|cancellation|cancel|canceled|cancelled|refund)$/;
const TX_SALES = new Set([
  "charge", "charge adjustment", "sale", "shop cash credit", "shop cash credit reversal",
  "marketplace sales tax", "marketplace sales tax reversal", "tax adjustment debit", "tax adjustment credit",
]);
const TX_REFUNDS = new Set(["refund", "refund failure", "refund adjustment", "shop cash refund debit", "shop cash refund debit reversal"]);
const TX_ADJUST = new Set(["adjustment", "credit", "debit", "merchant goodwill credit", "promotion credit"]);
const TX_ADJUST_PREFIX = /^(?:chargeback|dispute|reserve|reserved funds|fraud protect|seller protection|risk|anomaly|advance)\b/;

function txFamily(type) {
  if (TX_ITSELF.has(type)) return "self";
  if (TX_RETRY.test(type)) return "retry";
  if (TX_SALES.has(type)) return "sales";
  if (TX_REFUNDS.has(type)) return "refunds";
  if (/^bill(?:ing)? /.test(type)) return "bill";
  if (TX_ADJUST.has(type) || TX_ADJUST_PREFIX.test(type)) return "adjust";
  return "unknown";
}

function detectTransactions(f) {
  const h = f.names;
  if (!h.has("transaction date") || !h.has("payout date") || !h.has("type") || !h.has("net")) return 0;
  const score = h.has("payout status") && h.has("amount") && h.has("fee") ? 1 : 0.5;
  const iDate = f.col("transaction date");
  const iNet = f.col("net");
  const ok = sanity(f, (row) => !!parseDateLoose(cell(row, iDate)) && parseAmountToCents(cell(row, iNet)) !== null);
  return ok ? score : score * 0.5;
}

/**
 * Transactions des virements (Finances > Versements > Afficher les transactions > Exporter) : les lignes sont regroupées
 * par virement ("Payout ID", sinon date de virement + devise) et donnent les mêmes brouillons que la liste des virements,
 * avec une ventilation plus fine (les frais de litige vont avec les litiges, pas avec les frais de paiement).
 * Net du virement = somme des "Net". Les lignes "pending" n'appartiennent à aucun virement : elles sont seulement comptées.
 * @param {object} parsed résultat de parseCsv
 * @param {object} ctx { config, book, accountId, options }
 * @returns {{ drafts: object[], stats: null, warnings: string[], info: string[] }}
 */
function parseTransactions(parsed, ctx) {
  const out = emptyResult();
  const f = openFile(parsed);
  if (!f.rows.length) {
    out.warnings.push("Le fichier ne contient aucune transaction.");
    return out;
  }
  const c = {
    type: f.col("type", "transaction type"),
    order: f.col("order", "order name"),
    status: f.col("payout status"),
    payoutDate: f.col("payout date"),
    payoutId: f.col("payout id"),
    amount: f.col("amount", "gross"),
    fee: f.col("fee", "fees"),
    net: f.col("net"),
    currency: f.col("currency", "devise"),
  };
  if (c.payoutDate < 0 || (c.net < 0 && c.amount < 0)) {
    out.warnings.push("Colonnes \"Payout Date\" ou \"Net\" introuvables : ce fichier ne ressemble pas à l'export des transactions Shopify " +
      "(Finances > Versements > Afficher les transactions > Exporter).");
    return out;
  }
  if (c.status < 0) out.warnings.push("Colonne \"Payout Status\" absente : toutes les transactions sont considérées comme déjà versées.");

  const { amt } = moneyReaders(f.rows, [c.amount, c.fee, c.net]);
  const readDate = dateReader(f.rows, c.payoutDate);
  const fallback = fallbackCurrency(ctx);
  const noCurrencyColumn = c.currency < 0;
  let assumedCurrency = false;
  let brokenIds = 0;

  const groups = new Map();
  const pending = new Map();
  const skippedFailed = new Map();
  let pendingCount = 0;
  let failedCount = 0;
  let selfCount = 0;
  let txCount = 0;

  for (let i = 0; i < f.rows.length; i++) {
    const row = f.rows[i];
    const line = f.line(i);
    const rawType = cell(row, c.type);
    const type = normHeader(rawType);
    const family = txFamily(type);
    if (family === "self") { selfCount++; continue; }

    let net = amt(row, c.net);
    let amount = amt(row, c.amount);
    let fee = amt(row, c.fee);
    if (net === null && amount === null) {
      if (!isTotalRow(row)) out.warnings.push(`Ligne ${line} : montant net absent ou illisible, transaction ignorée.`);
      continue;
    }
    if (net === null) net = amount - (fee || 0);
    if (amount === null) amount = net + (fee || 0);
    if (fee === null) fee = amount - net;

    const status = c.status >= 0 ? payoutStatus(cell(row, c.status)) : { cls: "paid", code: "paid" };
    let currency = readCurrency(cell(row, c.currency));
    if (!currency) { currency = fallback; assumedCurrency = true; }

    if (status.cls === "pending") {
      pendingCount++;
      pending.set(currency, (pending.get(currency) || 0) + net);
      continue;
    }
    if (status.cls === "failed") {
      failedCount++;
      skippedFailed.set(currency, (skippedFailed.get(currency) || 0) + net);
      continue;
    }
    const rawPayoutDate = cell(row, c.payoutDate);
    const date = readDate(rawPayoutDate);
    if (!date) {
      if (isTotalRow(row)) continue;
      out.warnings.push(rawPayoutDate
        ? `Ligne ${line} : date du virement illisible (${quote(rawPayoutDate)}), transaction ignorée.`
        : `Ligne ${line} : date du virement absente, transaction ignorée.`);
      continue;
    }
    const rawId = cell(row, c.payoutId);
    const payoutId = cleanPayoutId(rawId);
    if (rawId && !payoutId) brokenIds++;

    const key = payoutId ? "id:" + payoutId + "|" + currency : "day:" + date + "|" + currency + "|" + status.cls;
    let g = groups.get(key);
    if (!g) {
      groups.set(key, g = {
        payoutId, currency, cls: status.cls, status: status.code, rawStatus: cell(row, c.status), line,
        dates: new Map(), totalCents: 0, sales: 0, gross: 0, refunds: 0, fees: 0, bill: 0, adjust: 0, reserved: 0, retry: 0, unknown: 0,
        unknownTypes: new Map(), txCount: 0, orders: new Set(),
      });
    }
    txCount++;
    g.txCount++;
    g.dates.set(date, (g.dates.get(date) || 0) + 1);
    g.totalCents += net;
    if (family === "sales") {
      g.sales += amount;
      g.fees += fee;
      if (type === "charge") {
        g.gross += amount;
        const order = cell(row, c.order);
        if (order) g.orders.add(order);
      }
    } else if (family === "refunds") {
      g.refunds += amount;
      g.fees += fee;
    } else if (family === "bill") {
      g.bill += net;
    } else if (family === "adjust") {
      g.adjust += net;
      if (/^reserve/.test(type)) g.reserved += net;
    } else if (family === "retry") {
      g.retry += net;
    } else {
      g.unknown += net;
      const label = rawType || "(type absent)";
      if (!g.unknownTypes.has(label)) g.unknownTypes.set(label, line);
    }
  }

  // Date d'un virement : celle que portent le plus de lignes (en cas d'égalité, la plus récente).
  const list = [];
  for (const g of groups.values()) {
    let date = "";
    let votes = 0;
    for (const [d, n] of g.dates) if (n > votes || (n === votes && d > date)) { date = d; votes = n; }
    g.date = date;
    list.push(g);
  }
  // Un export filtré par dates peut couper le premier et le dernier virement du fichier : on les signale.
  const sorted = list.filter((g) => g.totalCents !== 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0] || null;
  const last = sorted[sorted.length - 1] || null;

  const extIdFor = payoutKeyMaker(ctx.book);
  const idCurrencies = new Map();
  const remarks = [];
  let zero = 0;
  for (const g of list) {
    if (g.totalCents === 0) { zero++; continue; }
    const cur = g.currency;
    const where = `Virement du ${dayMonth(g.date)}`;
    const other = g.totalCents - (g.sales + g.refunds - g.fees + g.bill + g.adjust);
    const notes = [];
    if (g.cls === "upcoming") notes.push("Pas encore versé par Shopify : montant estimé.");
    if (g.cls === "unknown") notes.push("Statut du virement non reconnu.");
    if (g.unknownTypes.size) notes.push("Type de transaction inconnu.");
    if (other !== 0) notes.push(`${money(Math.abs(other), cur)} classés à part, à vérifier.`);
    if (g === first || g === last) notes.push("Peut être incomplet si l'export a été filtré par dates.");
    if (g.unknownTypes.size) {
      const types = [...g.unknownTypes].map(([label, line]) => `${quote(label)} (ligne ${line})`).join(", ");
      out.warnings.push(`${where} : type de transaction inconnu ${types}. ${money(g.unknown, cur)} classés en ${otherBucketName(g.unknown)}, à vérifier.`);
    }
    if (g.retry !== 0) {
      out.warnings.push(`${where} : il reprend ${money(g.retry, cur)} d'un virement échoué ou annulé dont le détail n'est pas connu. ` +
        `Ce montant est classé en ${otherBucketName(g.retry)}, à vérifier.`);
    }
    const gap = other - g.unknown - g.retry;
    if (gap !== 0) {
      out.warnings.push(`${where} : sur certaines lignes le net ne correspond pas au montant moins les frais. ` +
        `L'écart de ${money(Math.abs(gap), cur)} est classé en ${otherBucketName(other)}, à vérifier.`);
    }
    if (g.cls === "unknown") {
      out.warnings.push(`${where} (ligne ${g.line}) : statut ${g.rawStatus ? quote(g.rawStatus) : "absent"} non reconnu, virement importé et marqué "À vérifier".`);
    }
    if (g.bill !== 0) {
      out.warnings.push(`${where} : une facture Shopify a été payée avec ton solde Shopify (${money(Math.abs(g.bill), cur)}, classé en "Abonnement Shopify"). ` +
        "Si tu importes aussi les factures Shopify, ne la compte pas deux fois.");
    }
    if (g.reserved !== 0) {
      remarks.push(g.reserved < 0
        ? `${where} : Shopify a mis ${money(-g.reserved, cur)} en réserve (classé en "Litiges et rétrofacturations"). Ce montant reviendra dans un prochain virement.`
        : `${where} : Shopify a libéré ${money(g.reserved, cur)} de sa réserve.`);
    }
    if (g.totalCents < 0 && g.cls === "paid") {
      remarks.push(`Le ${dayMonth(g.date)}, Shopify a repris ${money(-g.totalCents, cur)} sur ton compte (plus de remboursements que de ventes) : c'est une sortie d'argent.`);
    }
    // Un même identifiant de virement dans deux devises (rare) : la deuxième devise reçoit une clé à part.
    let keyId = g.payoutId;
    if (keyId) {
      const seenCurrencies = idCurrencies.get(keyId) || [];
      if (seenCurrencies.length) {
        out.warnings.push(`${where} : le virement ${keyId} contient des lignes en ${seenCurrencies[0]} et en ${cur}, il est importé en deux opérations.`);
        keyId = keyId + "-" + cur;
      }
      seenCurrencies.push(cur);
      idCurrencies.set(g.payoutId, seenCurrencies);
    }
    const meta = {};
    if (g.payoutId) meta.payoutId = g.payoutId;
    meta.status = g.status || "unknown";
    meta.grossCents = g.gross;
    meta.refundsCents = neg(g.refunds);
    meta.feesCents = g.fees;
    meta.adjustmentsCents = g.totalCents - g.gross - g.refunds + g.fees;
    if (g.reserved !== 0) meta.reservedCents = g.reserved;
    if (other !== 0) meta.unexplainedCents = other;
    meta.txCount = g.txCount;
    meta.orderCount = g.orders.size;
    meta.export = "transactions";
    out.drafts.push(payoutDraft(ctx, {
      date: g.date,
      totalCents: g.totalCents,
      currency: cur,
      splits: [
        ["sales_shopify", g.sales],
        ["refunds", g.refunds],
        ["fees_payment", neg(g.fees)],
        ["chargebacks", g.adjust],
        ["shopify_sub", g.bill],
        [otherBucket(other), other],
      ],
      extId: extIdFor(keyId, g.date, g.totalCents),
      review: g.cls !== "paid" || other !== 0 || g.unknownTypes.size > 0 || g === first || g === last,
      estimated: g.cls === "upcoming",
      notes,
      meta,
    }));
  }

  out.info.push(...payoutSummary(out, ctx, out.drafts,
    `${plural(out.drafts.length, "virement Shopify reconstitué", "virements Shopify reconstitués")} à partir de ${plural(txCount, "transaction", "transactions")},`), ...remarks);
  payoutBookRemarks(out, ctx.book, out.drafts);
  if (first && last) {
    out.warnings.push(first === last
      ? `Le virement du ${dayMonth(first.date)} peut être incomplet si l'export a été filtré par dates : il est marqué "À vérifier", compare son montant avec ton relevé bancaire.`
      : `Le premier et le dernier virement du fichier (${dayMonth(first.date)} et ${dayMonth(last.date)}) peuvent être incomplets si l'export a été filtré par dates : ` +
        "ils sont marqués \"À vérifier\", compare leur montant avec ton relevé bancaire.");
  }
  if (pendingCount) {
    const sums = [...pending].map(([cur, cents]) => money(cents, cur)).join(" et ");
    out.info.push(`${plural(pendingCount, "transaction en attente", "transactions en attente")} de versement (${sums} net) : rien n'est créé pour l'instant, ` +
      "elles arriveront dans un prochain virement.");
  }
  if (failedCount) {
    const sums = [...skippedFailed].map(([cur, cents]) => money(cents, cur)).join(" et ");
    out.info.push(`${plural(failedCount, "transaction ignorée", "transactions ignorées")} (${sums} net) : le virement prévu a échoué ou a été annulé, l'argent n'a pas bougé.`);
  }
  if (selfCount) out.info.push(`${plural(selfCount, "ligne \"payout\" ignorée", "lignes \"payout\" ignorées")} : c'est le virement lui-même, pas une vente.`);
  if (zero) out.info.push(`${plural(zero, "virement à 0 ignoré", "virements à 0 ignorés")} : aucun argent n'a bougé.`);
  if (brokenIds) {
    out.warnings.push("Des identifiants de virement sont illisibles (fichier modifié par un tableur ?) : ces transactions sont regroupées par date de virement.");
  }
  if (assumedCurrency) {
    out.info.push(noCurrencyColumn
      ? `Le fichier n'indique pas la devise : montants lus en ${fallback}.`
      : `Devise absente sur certaines lignes : montants lus en ${fallback}.`);
  }
  if (!out.drafts.length && !out.warnings.length && !pendingCount) out.warnings.push("Aucun virement à importer dans ce fichier.");
  return out;
}

/* ------------------------------------------------------------------ 3. commandes (statistiques) */

function detectOrders(f) {
  const h = f.names;
  if (!h.has("name") || !h.has("lineitem quantity") || !h.has("lineitem price") || !h.has("created at")) return 0;
  const score = h.has("financial status") && h.has("total") ? 1 : 0.5;
  const iName = f.col("name");
  const iCreated = f.col("created at");
  const ok = sanity(f, (row) => !!cell(row, iName) && !!parseDateLoose(cell(row, iCreated)));
  return ok ? score : score * 0.5;
}

function readQuantity(raw) {
  if (!raw) return 1;
  if (/^\d{1,7}$/.test(raw)) return parseInt(raw, 10);
  const m = /^(\d{1,7})[.,]0+$/.exec(raw);
  return m ? parseInt(m[1], 10) : null;
}

// Moyen de paiement d'une commande : tout par Shopify Payments, tout par un autre moyen, un mélange, ou rien (commande gratuite).
function gatewayOf(method) {
  const parts = method.split(/\s+\+\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { kind: "none", label: "" };
  const shopify = parts.filter((part) => normHeader(part) === "shopify payments").length;
  if (shopify === parts.length) return { kind: "shopify", label: "Shopify Payments" };
  return { kind: shopify ? "mixed" : "other", label: [...new Set(parts)].join(" + ") };
}

/**
 * Commandes (Commandes > Exporter) : aucune opération, seulement des statistiques par jour au format ShopifyDay.
 * Jour = date de "Created at" telle qu'écrite (fuseau de la boutique). Une commande de plusieurs lignes compte une fois.
 * netCents = brut - remises - remboursements ; totalCents = total encaissé - remboursements.
 * @param {object} parsed résultat de parseCsv
 * @param {object} ctx { config, options: { excludeFreeOrders, currency } }
 * @returns {{ drafts: [], stats: { [month: string]: { shopify: { days: { [dd: string]: object } } } } | null, warnings: string[], info: string[] }}
 */
function parseOrders(parsed, ctx) {
  const out = emptyResult();
  const f = openFile(parsed);
  if (!f.rows.length) {
    out.warnings.push("Le fichier ne contient aucune commande.");
    return out;
  }
  const c = {
    name: f.col("name", "order name", "order"),
    status: f.col("financial status"),
    created: f.col("created at"),
    paid: f.col("paid at"),
    cancelled: f.col("cancelled at", "canceled at"),
    currency: f.col("currency", "devise"),
    subtotal: f.col("subtotal"),
    shipping: f.col("shipping"),
    taxes: f.col("taxes", "tax"),
    total: f.col("total"),
    discount: f.col("discount amount"),
    refunded: f.col("refunded amount"),
    method: f.col("payment method"),
    quantity: f.col("lineitem quantity"),
    item: f.col("lineitem name"),
    price: f.col("lineitem price"),
  };
  if (c.price < 0 && c.total < 0 && f.names.has("kind") && f.names.has("gateway")) {
    out.warnings.push("Ce fichier est l'historique des transactions des commandes : dans Shopify, choisis plutôt le bouton \"Exporter les commandes\".");
    return out;
  }
  if (c.name < 0 || (c.created < 0 && c.paid < 0) || (c.price < 0 && c.total < 0 && c.subtotal < 0)) {
    out.warnings.push("Colonnes \"Name\" ou \"Created at\" introuvables : ce fichier ne ressemble pas à l'export des commandes Shopify (Commandes > Exporter).");
    return out;
  }
  const { amt, amt0 } = moneyReaders(f.rows, [c.subtotal, c.shipping, c.taxes, c.total, c.discount, c.refunded, c.price]);
  const readDate = dateReader(f.rows, c.created >= 0 ? c.created : c.paid);
  const fallback = fallbackCurrency(ctx);
  const excludeFree = !!(ctx.options && ctx.options.excludeFreeOrders);
  let assumedCurrency = false;

  // Une commande de plusieurs articles occupe plusieurs lignes : seule la première porte les montants de la commande.
  const groups = new Map();
  for (let i = 0; i < f.rows.length; i++) {
    const row = f.rows[i];
    const name = cell(row, c.name);
    if (!name) {
      if (!isTotalRow(row)) out.warnings.push(`Ligne ${f.line(i)} : pas de numéro de commande, ligne ignorée.`);
      continue;
    }
    let g = groups.get(name);
    if (!g) groups.set(name, g = { name, rows: [], main: -1 });
    g.rows.push(i);
    if (g.main < 0 && ((c.total < 0 && c.status < 0) || cell(row, c.total) || cell(row, c.status))) g.main = i;
  }

  const orders = [];
  let voided = 0;
  let cancelled = 0;
  let freeSkipped = 0;
  for (const g of groups.values()) {
    const firstLine = f.line(g.rows[0]);
    if (g.main < 0) {
      out.warnings.push(`Commande ${g.name} (ligne ${firstLine}) : la ligne principale de la commande manque (fichier coupé ?), commande ignorée.`);
      continue;
    }
    const main = f.rows[g.main];
    let date = readDate(cell(main, c.created));
    for (let k = 0; !date && k < g.rows.length; k++) date = readDate(cell(f.rows[g.rows[k]], c.created));
    if (!date) date = readDate(cell(main, c.paid));
    if (!date) {
      if (g.rows.length === 1 && isTotalRow(main)) continue;
      out.warnings.push(`Commande ${g.name} (ligne ${firstLine}) : date de commande absente ou illisible, commande ignorée.`);
      continue;
    }
    const status = normHeader(cell(main, c.status));
    if (status === "voided" || status === "expired") { voided++; continue; }
    const refunds = Math.abs(amt0(main, c.refunded));
    if (cell(main, c.cancelled) && refunds === 0 && (status === "pending" || status === "authorized")) { cancelled++; continue; }

    let gross = 0;
    let tip = 0;
    for (const i of g.rows) {
      const row = f.rows[i];
      if (!cell(row, c.price)) continue;
      const price = amt(row, c.price);
      const quantity = readQuantity(cell(row, c.quantity));
      if (price === null || quantity === null || Math.abs(price * quantity) > MAX_CENTS) {
        out.warnings.push(`Ligne ${f.line(i)} : prix ou quantité illisible pour la commande ${g.name}, article ignoré.`);
        continue;
      }
      // Un pourboire est une ligne "Tip" : il est encaissé mais ce n'est pas une vente.
      if (normHeader(cell(row, c.item)) === "tip") { tip += price * quantity; continue; }
      gross += price * quantity;
    }
    const discounts = Math.abs(amt0(main, c.discount));
    const shipping = amt0(main, c.shipping);
    const tax = amt0(main, c.taxes);
    if (c.price < 0) gross = amt0(main, c.subtotal) + discounts;
    let charged;
    if (c.total >= 0) {
      charged = amt(main, c.total);
      if (charged === null) {
        out.warnings.push(`Commande ${g.name} (ligne ${f.line(g.main)}) : total illisible, commande ignorée.`);
        continue;
      }
    } else {
      charged = gross - discounts + shipping + tax;
    }
    if (charged === 0 && excludeFree) { freeSkipped++; continue; }
    let currency = readCurrency(cell(main, c.currency));
    if (!currency) { currency = fallback; assumedCurrency = true; }
    orders.push({ date, currency, gross, discounts, refunds, shipping, tax, charged, tip, gateway: gatewayOf(cell(main, c.method)) });
  }

  if (!orders.length) {
    if (voided || cancelled) out.info.push(`${plural(voided + cancelled, "commande annulée avant paiement ignorée", "commandes annulées avant paiement ignorées")}.`);
    if (!out.warnings.length) out.warnings.push("Aucune commande exploitable dans ce fichier.");
    return out;
  }

  // Un jour de statistiques n'a qu'une devise : on garde celle qui a le plus de commandes.
  const perCurrency = new Map();
  for (const o of orders) perCurrency.set(o.currency, (perCurrency.get(o.currency) || 0) + 1);
  let mainCurrency = orders[0].currency;
  for (const [currency, count] of perCurrency) if (count > perCurrency.get(mainCurrency)) mainCurrency = currency;
  for (const [currency, count] of perCurrency) {
    if (currency === mainCurrency) continue;
    out.warnings.push(`${plural(count, "commande", "commandes")} en ${currency} ${count > 1 ? "ignorées" : "ignorée"} : ` +
      `les statistiques d'un jour n'ont qu'une devise (ici ${mainCurrency}).`);
  }

  const stats = {};
  const totals = { orders: 0, gross: 0, discounts: 0, refunds: 0, net: 0, total: 0, charged: 0, free: 0 };
  const gateways = { other: new Map(), mixed: new Map() };
  const paidBy = { shopify: 0, other: 0, mixed: 0, none: 0 };
  let tipCents = 0;
  let from = null;
  let to = null;
  const days = new Set();
  for (const o of orders) {
    if (o.currency !== mainCurrency) continue;
    const month = o.date.slice(0, 7);
    const dd = o.date.slice(8, 10);
    if (!stats[month]) stats[month] = { shopify: { days: {} } };
    const table = stats[month].shopify.days;
    if (!table[dd]) {
      table[dd] = { orders: 0, grossCents: 0, discountsCents: 0, refundsCents: 0, shippingCents: 0, taxCents: 0, netCents: 0, totalCents: 0, currency: mainCurrency };
    }
    const day = table[dd];
    day.orders++;
    day.grossCents += o.gross;
    day.discountsCents += o.discounts;
    day.refundsCents += o.refunds;
    day.shippingCents += o.shipping;
    day.taxCents += o.tax;
    day.netCents += o.gross - o.discounts - o.refunds;
    day.totalCents += o.charged - o.refunds;
    days.add(o.date);
    if (!from || o.date < from) from = o.date;
    if (!to || o.date > to) to = o.date;
    totals.orders++;
    totals.gross += o.gross;
    totals.discounts += o.discounts;
    totals.refunds += o.refunds;
    totals.net += o.gross - o.discounts - o.refunds;
    totals.total += o.charged - o.refunds;
    totals.charged += o.charged;
    if (o.charged === 0) totals.free++;
    tipCents += o.tip;
    paidBy[o.gateway.kind] += o.charged;
    const labels = gateways[o.gateway.kind];
    if (labels) labels.set(o.gateway.label, (labels.get(o.gateway.label) || 0) + o.charged);
  }
  out.stats = stats;

  const cur = mainCurrency;
  out.info.push(`${plural(totals.orders, "commande lue", "commandes lues")} (${plural(f.rows.length, "ligne", "lignes")}) ${period(from, to)}, ` +
    `sur ${plural(days.size, "jour", "jours")}. Aucune opération n'est créée : ces chiffres alimentent les statistiques (commandes, panier moyen).`);
  out.info.push(`Ventes brutes ${money(totals.gross, cur)}, remises ${money(totals.discounts, cur)}, remboursements ${money(totals.refunds, cur)} : ` +
    `ventes nettes ${money(totals.net, cur)}. Total encaissé, livraison et taxes comprises, remboursements déduits : ${money(totals.total, cur)}.`);
  const detail = (labels) => [...labels].map(([label, cents]) => `${label} ${money(cents, cur)}`).join(", ");
  if (totals.charged > 0 && paidBy.other === 0 && paidBy.mixed === 0) {
    out.info.push(`Toutes les ventes payées (${money(totals.charged, cur)}) sont passées par Shopify Payments : tu les retrouves dans les virements Shopify.`);
  }
  if (paidBy.other !== 0) {
    const share = String(pct(paidBy.other, totals.charged)).replace(".", ",");
    out.info.push(`Ventes payées sans passer par Shopify Payments : ${money(paidBy.other, cur)} sur ${money(totals.charged, cur)} (${share} %). ` +
      `Elles n'arrivent pas par les virements Shopify. Détail : ${detail(gateways.other)}.`);
  }
  if (paidBy.mixed !== 0) {
    out.info.push(`Ventes payées en partie par Shopify Payments et en partie par un autre moyen : ${money(paidBy.mixed, cur)} (${detail(gateways.mixed)}). ` +
      "Seule la part Shopify Payments arrive par les virements Shopify.");
  }
  if (totals.free) out.info.push(`${plural(totals.free, "commande gratuite comptée", "commandes gratuites comptées")} dans le nombre de commandes (total à 0).`);
  if (freeSkipped) out.info.push(`${plural(freeSkipped, "commande gratuite ignorée", "commandes gratuites ignorées")}.`);
  if (voided || cancelled) out.info.push(`${plural(voided + cancelled, "commande annulée avant paiement ignorée", "commandes annulées avant paiement ignorées")}.`);
  if (tipCents) out.info.push(`Pourboires : ${money(tipCents, cur)}, comptés dans le total encaissé mais pas dans les ventes.`);
  if (totals.refunds) out.info.push("Les remboursements sont comptés le jour de la commande : ce fichier ne donne pas leur date.");
  if (assumedCurrency) out.info.push(`Devise absente du fichier : montants lus en ${fallback}.`);
  out.info.push(`Les jours du fichier remplacent les statistiques déjà enregistrées pour ces jours : vérifie que le premier (${dayMonth(from)}) ` +
    `et le dernier (${dayMonth(to)}) sont complets dans ton export.`);
  if (groups.size === 50) {
    out.warnings.push("Le fichier contient exactement 50 commandes : c'est peut-être seulement la page affichée dans Shopify. " +
      "Exporte plutôt par dates pour ne pas couper une journée.");
  }
  return out;
}

/* ------------------------------------------------------------------ 4. factures Shopify */

function detectBilling(f) {
  const h = f.names;
  if (!h.has("bill") || !h.has("amount")) return 0;
  let score;
  if (h.has("charge category")) score = 1;
  else if (h.has("description") || h.has("app")) score = 0.5;
  else return 0;
  const iBill = f.col("bill");
  return sanity(f, (row) => /\d/.test(cell(row, iBill))) ? score : score * 0.5;
}

/**
 * Catégorie d'une ligne de facture Shopify, d'après le code "Charge category" puis la description.
 * @returns {{ kind: string, categoryId: string, fallback: boolean }}
 */
function billCategory(code, description, app) {
  const text = normHeader(code);
  const hint = text || normHeader(description);
  // "application_fee" avant "subscription" : l'abonnement à une app reste une app.
  if (/\bapp(?:s|lications?)?\b/.test(hint) || (!text && app)) return { kind: "app", categoryId: "shopify_apps", fallback: false };
  if (/\bsubscription|\bplan\b|\babonnement/.test(hint)) return { kind: "sub", categoryId: "shopify_sub", fallback: false };
  if (/\btransaction/.test(hint)) return { kind: "fees", categoryId: "fees_payment", fallback: false };
  if (/\bshipping|\blabels?\b/.test(hint)) return { kind: "shipping", categoryId: "shipping", fallback: false };
  if (/\b(?:tax|taxes|vat|gst|tva)\b/.test(hint)) return { kind: "taxes", categoryId: "taxes", fallback: false };
  if (/\bdomain/.test(hint)) return { kind: "domain", categoryId: "domain_hosting", fallback: false };
  if (/\b(?:email|messaging|marketing)\b/.test(hint)) return { kind: "email", categoryId: "email_sms", fallback: false };
  if (/\btheme/.test(hint)) return { kind: "theme", categoryId: "shopify_apps", fallback: false };
  return { kind: "other", categoryId: "shopify_apps", fallback: true };
}

function billLabel(kind, description, app, code) {
  const name = app || description;
  if (kind === "sub") return "Abonnement Shopify";
  if (kind === "app") return name ? "App Shopify : " + name : "App Shopify";
  if (kind === "fees") return "Frais de transaction Shopify";
  if (kind === "shipping") return "Étiquettes d'expédition Shopify";
  if (kind === "taxes") return "Taxes sur facture Shopify";
  if (kind === "domain") return description ? "Nom de domaine Shopify : " + description : "Nom de domaine Shopify";
  if (kind === "email") return description ? "Shopify : " + description : "Shopify Email et messages";
  if (kind === "theme") return description ? "Thème Shopify : " + description : "Thème Shopify";
  return "Shopify : " + (description || code || "autre frais");
}

/**
 * Factures Shopify (Paramètres > Facturation > Exporter les factures) : une dépense par ligne de facture.
 * Clé externe : "shopify_bill:<numéro de facture>:<rang de la ligne dans la facture, à partir de 1>".
 * Un montant positif dans le fichier est une dépense (opération négative) ; un avoir devient une opération positive.
 * @param {object} parsed résultat de parseCsv
 * @param {object} ctx { config, accountId, options }
 * @returns {{ drafts: object[], stats: null, warnings: string[], info: string[] }}
 */
function parseBilling(parsed, ctx) {
  const out = emptyResult();
  const f = openFile(parsed);
  if (!f.rows.length) {
    out.warnings.push("Le fichier ne contient aucune ligne de facture.");
    return out;
  }
  const c = {
    bill: f.col("bill", "bill number", "bill no", "bill id", "invoice", "invoice number"),
    category: f.col("charge category", "category", "charge type"),
    description: f.col("description"),
    amount: f.col("amount", "total"),
    currency: f.col("currency", "devise"),
    start: f.col("start of billing cycle"),
    end: f.col("end of billing cycle"),
    date: f.col("date", "bill date"),
    chargeDate: f.col("charge date"),
    order: f.col("order"),
    app: f.col("app"),
    store: f.col("store name"),
    originalAmount: f.col("original amount"),
    originalCurrency: f.col("original currency"),
  };
  if (c.bill < 0 || c.amount < 0) {
    out.warnings.push("Colonnes \"Bill #\" ou \"Amount\" introuvables : ce fichier ne ressemble pas à l'export des factures Shopify " +
      "(Paramètres > Facturation > Factures précédentes > Exporter les factures).");
    return out;
  }
  const { amt } = moneyReaders(f.rows, [c.amount, c.originalAmount]);
  const readDate = dateReader(f.rows, c.date >= 0 ? c.date : c.chargeDate);
  const fallback = fallbackCurrency(ctx);
  let assumedCurrency = false;

  const bills = new Map();
  const perCurrency = new Map();
  let zero = 0;
  let from = null;
  let to = null;
  for (let i = 0; i < f.rows.length; i++) {
    const row = f.rows[i];
    const line = f.line(i);
    const bill = cell(row, c.bill).replace(/^#\s*/, "");
    if (!bill) {
      if (!isTotalRow(row)) out.warnings.push(`Ligne ${line} : numéro de facture absent, ligne ignorée.`);
      continue;
    }
    if (!/\d/.test(bill) && isTotalRow(row)) continue;
    // Le rang compte toutes les lignes de la facture, même ignorées : il reste le même d'un import à l'autre.
    let state = bills.get(bill);
    if (!state) bills.set(bill, state = { count: 0, drafts: [], totalCents: 0 });
    state.count++;
    const rank = state.count;
    const amount = amt(row, c.amount);
    if (amount === null) {
      const raw = cell(row, c.amount);
      out.warnings.push(`Ligne ${line} : montant ${raw ? "illisible (" + quote(raw) + ")" : "absent"} sur la facture ${bill}, ligne ignorée.`);
      continue;
    }
    if (amount === 0) { zero++; continue; }
    const date = readDate(cell(row, c.date)) || readDate(cell(row, c.chargeDate)) || readDate(cell(row, c.end));
    if (!date) {
      out.warnings.push(`Ligne ${line} : date absente ou illisible sur la facture ${bill}, ligne ignorée.`);
      continue;
    }
    let currency = readCurrency(cell(row, c.currency));
    if (!currency) { currency = fallback; assumedCurrency = true; }
    const code = cell(row, c.category);
    const description = cell(row, c.description);
    const app = cell(row, c.app);
    const found = billCategory(code, description, app);
    let categoryId = found.categoryId;
    // Une règle créée par l'utilisateur passe avant (exemple : une app d'emails facturée par Shopify).
    const hint = suggestCategory(ctx.config, { label: description, party: app, amountCents: neg(amount) });
    if (hint && hint.via === "rule") categoryId = hint.categoryId;
    const review = found.fallback && !(hint && hint.via === "rule");
    if (review) {
      out.warnings.push(`Ligne ${line} : type de frais ${code ? quote(code) : "absent"} non reconnu sur la facture ${bill}, ` +
        "ligne classée en \"Apps Shopify\" et marquée \"À vérifier\".");
    }
    const meta = { billNumber: bill, line: rank };
    if (code) meta.chargeCategory = code;
    if (app) meta.app = app;
    const store = cell(row, c.store);
    if (store) meta.store = store;
    const start = readDate(cell(row, c.start));
    const end = readDate(cell(row, c.end));
    const chargeDate = readDate(cell(row, c.chargeDate));
    const order = cell(row, c.order);
    if (start) meta.periodStart = start;
    if (end) meta.periodEnd = end;
    if (chargeDate) meta.chargeDate = chargeDate;
    if (order) meta.order = order;
    const originalCurrency = readCurrency(cell(row, c.originalCurrency));
    const originalAmount = amt(row, c.originalAmount);
    if (originalCurrency && originalCurrency !== currency && originalAmount !== null) {
      meta.originalCurrency = originalCurrency;
      meta.originalAmountCents = neg(originalAmount);
    }
    meta.export = "billing";
    const draft = {
      kind: "pl",
      date,
      label: `${billLabel(found.kind, description, app, code)} (facture ${bill}${amount < 0 ? ", avoir" : ""})`,
      ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
      amountCents: neg(amount),
      currency,
      categoryId,
      party: PARTY,
      ref: bill,
      source: SOURCE,
      extId: BILL_PREFIX + bill + ":" + rank,
      needsReview: review,
      meta,
    };
    if (review) draft._note = "Type de frais non reconnu.";
    out.drafts.push(draft);
    state.drafts.push(draft);
    state.totalCents += draft.amountCents;
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
    let t = perCurrency.get(currency);
    if (!t) perCurrency.set(currency, t = { total: 0, sub: 0, apps: 0, fees: 0 });
    t.total += amount;
    if (categoryId === "shopify_sub") t.sub += amount;
    else if (categoryId === "shopify_apps") t.apps += amount;
    else if (categoryId === "fees_payment") t.fees += amount;
  }

  // Le relevé bancaire montre un seul débit par facture : chaque ligne garde le total de sa facture pour le rapprochement.
  let billCount = 0;
  for (const state of bills.values()) {
    if (!state.drafts.length) continue;
    billCount++;
    for (const draft of state.drafts) {
      draft.meta.billTotalCents = state.totalCents;
      draft.meta.billLines = state.drafts.length;
    }
  }
  if (out.drafts.length) {
    out.info.push(`${plural(billCount, "facture Shopify", "factures Shopify")} (${plural(out.drafts.length, "ligne", "lignes")}) ${period(from, to)}.`);
    for (const [currency, t] of perCurrency) {
      const rest = t.total - t.sub - t.apps - t.fees;
      const parts = [];
      if (t.sub) parts.push(`abonnement ${money(t.sub, currency)}`);
      if (t.apps) parts.push(`apps ${money(t.apps, currency)}`);
      if (t.fees) parts.push(`frais de transaction ${money(t.fees, currency)}`);
      if (rest) parts.push(`autres ${money(rest, currency)}`);
      out.info.push(`Total facturé : ${money(t.total, currency)} (${parts.join(", ")}).`);
    }
    out.info.push("Le fichier ne dit pas si une facture a été payée, ni avec quoi : compare avec ton relevé. " +
      "Une facture payée avec ton solde Shopify est déjà déduite d'un virement Shopify, ne la compte pas deux fois.");
  }
  if (zero) out.info.push(`${plural(zero, "ligne à 0 ignorée", "lignes à 0 ignorées")} (essai gratuit ou frais offerts).`);
  if (assumedCurrency) out.info.push(`Devise absente du fichier : montants lus en ${fallback}.`);
  if (!out.drafts.length && !out.warnings.length && !zero) out.warnings.push("Aucune ligne de facture à importer dans ce fichier.");
  return out;
}

/* ------------------------------------------------------------------ registre */

/**
 * Importeurs Shopify.
 * Chaque entrée : { type, label, help, needs: { account, platform }, detect(parsed) -> 0..1, parse(parsed, ctx) -> { drafts, stats, warnings, info } }.
 * `parsed` est le résultat de parseCsv ; `ctx` = { config, book, accountId, platform, options }.
 * Options reconnues : `currency` (devise quand le fichier n'en donne pas), `excludeFreeOrders` (commandes à 0 hors statistiques).
 * @type {Array<{ type: string, label: string, help: string, needs: { account: boolean, platform: boolean },
 *   detect: (parsed: object) => number,
 *   parse: (parsed: object, ctx?: object) => { drafts: object[], stats: object|null, warnings: string[], info: string[] } }>}
 */
export const IMPORTERS = [
  {
    type: "shopify_payouts",
    label: "Virements Shopify (payouts)",
    help: "Dans Shopify : Finances > Versements > Exporter, puis \"Exporter les versements\". Une ligne par virement reçu sur ton compte.",
    needs: { account: true, platform: false },
    detect: safeDetect(detectPayouts),
    parse: safely(parsePayouts),
  },
  {
    type: "shopify_transactions",
    label: "Transactions des virements Shopify",
    help: "Dans Shopify : Finances > Versements > Afficher les transactions > Exporter. Donne le détail de chaque virement (ventes, frais, litiges).",
    needs: { account: true, platform: false },
    detect: safeDetect(detectTransactions),
    parse: safely(parseTransactions),
  },
  {
    type: "shopify_orders",
    label: "Commandes Shopify (statistiques)",
    help: "Dans Shopify : Commandes > Exporter, puis \"Exporter les commandes\". Sert aux statistiques par jour, aucune opération n'est créée.",
    needs: { account: false, platform: false },
    detect: safeDetect(detectOrders),
    parse: safely(parseOrders),
  },
  {
    type: "shopify_billing",
    label: "Factures Shopify (abonnement et apps)",
    help: "Dans Shopify : Paramètres > Facturation > Factures précédentes > menu \"...\" > Exporter les factures.",
    needs: { account: true, platform: false },
    detect: safeDetect(detectBilling),
    parse: safely(parseBilling),
  },
];
