// Relevés bancaires au format CSV -> brouillons d'opérations.
// Un préréglage par banque bien documentée (Revolut, Revolut Business, Slash, Wise, Mercury, PayPal, Qonto, N26, Payoneer)
// et un importeur générique qui repère lui-même les colonnes date, libellé et montant (ou débit et crédit).
//
// Règles communes :
// - une ligne de relevé = un brouillon "pl" sur le compte choisi, montant signé dans la devise de la ligne ;
// - les frais donnés dans une colonne à part deviennent un second brouillon (catégorie Frais bancaires) ;
// - les lignes en attente, refusées, annulées et les changes entre devises du même compte sont ignorés, avec le décompte ;
// - identifiant externe "bank:<compte>:<identifiant de la banque, sinon empreinte de date + montant + libellé + rang>" :
//   il ne change pas quand on réimporte un relevé qui recouvre le précédent ;
// - compte personnel d'un associé : seules les lignes reconnues comme liées à l'entreprise sont cochées.
import { normHeader } from "./csv.js";
import { parseAmountToCents, formatMoney, detectCurrency } from "../money.js";
import { parseDateLoose, formatDate } from "../dates.js";
import { hashString } from "../ids.js";
import { suggestCategory, suggestAccount } from "../rules.js";
import { accountOwner, accountLabel, partnerLabel } from "../model.js";
import { attachMatches } from "../recon.js";

const MAX_LABEL = 140;
const MAX_PARTY = 60;
const MAX_ROW_WARNINGS = 12;
/** Au-delà de 10 milliards (en centimes), une cellule n'est pas un montant. */
const MAX_CENTS = 1e12;
const HEADER_SCAN_ROWS = 40;

/** Rôles de colonne connus. Une valeur de -1 veut dire "pas de colonne pour ce rôle". */
const ROLES = [
  "date", "valueDate", "label", "counterparty", "narrative", "amount", "debit", "credit", "currency", "fee", "feeCurrency",
  "balance", "reference", "id", "status", "type", "direction", "card", "cardLabel", "origAmount", "origCurrency", "account", "note",
];

/* ------------------------------------------------------------------ titres de colonnes reconnus */

// Titres normalisés par normHeader (minuscules, sans accents, ponctuation remplacée par une espace), par ordre de préférence.
const SYN = {
  date: [
    "date", "date operation", "date de l operation", "dateop", "date op", "date d operation", "operation date", "operation date local",
    "operation date utc", "started date", "date de debut", "date started utc", /^date started\b/, "transaction started utc", "date utc",
    "booking date", "transaction date", "date de transaction", "created on", "posting date", "post date", "posted date",
    "date de comptabilisation", "date compta", "date comptable", "datum", "fecha", "trans date", "date time", "timestamp",
    "posted at", "authorized at", "created at", "initiated at",
  ],
  valueDate: [
    "date de valeur", "date valeur", "dateval", "valeur", "value date", "settlement date", "settlement date local", "settlement date utc",
    "completed date", "date de fin", "date completed utc", /^date completed\b/, "transaction completed utc", "finished on", "settled at",
    "valuta", "date de reglement",
  ],
  amount: [
    "amount", "montant", /^amount (?:in )?(?:eur|usd|gbp|chf|cad|aud|mad|aed)$/, /^montant (?:en )?(?:eur|euros?|usd)$/,
    "montant operation en euro", "montant de l operation", "montant operation", "net", "net amount", "total amount",
    "total amount incl vat", "montant total ttc", "transaction amount", "betrag", "betrag eur", "importe", "importo", "value", "somme",
    "amount cents", "amountcents", "amount in cents",
  ],
  debit: [
    "debit", "debit euros", "debit eur", "debit amount", "montant debit", /^paid out\b/, "money out", "argent sortant", "argent retire",
    "withdrawal", "withdrawals", "retrait", "retraits", "sortie", "sorties", "depense", "depenses", "outflow", "soll", "cargo", "debits",
  ],
  credit: [
    "credit", "credit euros", "credit eur", "credit amount", "montant credit", /^paid in\b/, "money in", "argent entrant", "entree d argent",
    "deposit", "deposits", "depot", "depots", "entree", "entrees", "recette", "recettes", "inflow", "haben", "abono", "credits",
  ],
  currency: ["currency", "devise", "payment currency", "currency code", "ccy", "wahrung", "moneda", "divisa", "monnaie"],
  fee: ["fee", "fees", "frais", "commission", "fx fee", "processing fee", "fee amount", "frais bancaires"],
  feeCurrency: ["fee currency"],
  balance: [
    "balance", "solde", "running balance", "accountbalance", "account balance", "solde apres operation", "solde euros", "closing balance",
    "available balance", "saldo", "kontostand", "nouveau solde",
  ],
  id: ["id", "transaction id", "transferwise id", "wise id", "numero de transaction", "identifiant de transaction", "txn id"],
  reference: [
    "reference", "ref", "reference id", "reference number", "numero d operation", "numero operation", "payment reference",
    "reference de paiement", "transaction reference", "receipt id", "check number", "numero de cheque",
  ],
  status: ["status", "state", "etat", "statut", "transaction status"],
  type: [
    "type", "transaction type", "type de transaction", "type operation", "type d operation", "payment method", "methode de paiement",
    "mode de paiement", "transaction details type", "nature", "transaktionstyp", "libelle interbancaire",
  ],
  direction: ["direction", "balance impact", "impact sur le solde", "sens", "debit credit", "dr cr", "credit debit"],
  card: ["card last 4", "card last four", "card last four digits", "last four digits", "last 4", "card number", "numero de carte", "card", "carte"],
  cardLabel: ["card label", "card name", "name on card"],
  origAmount: [
    "orig amount", "original amount", "montant d origine", "montant original", "amount foreign currency", "montant devise etrangere",
    "betrag fremdwahrung", "transfer amount", "total amount incl vat local", "montant total ttc local", "foreign amount", "montant en devise",
  ],
  origCurrency: [
    "orig currency", "original currency", "devise d origine", "type foreign currency", "selectionnez la devise etrangere", "fremdwahrung",
    "transfer amount currency", "currency local", "devise local", "foreign currency", "devise etrangere",
  ],
  label: [
    "description", "libelle", "label", "libelle operation", "libelle de l operation", "nature de l operation", "details", "detail",
    "detail de l ecriture", "narrative", "transaction description", "bank description", "intitule", "designation", "motif", "communication",
    "objet", "subject", "item title", "titre de l objet", "verwendungszweck", "concepto", "descrizione", "memo", "additional description",
    "informations complementaires",
  ],
  counterparty: [
    "to from", "merchant", "merchant name", "counterparty", "counterparty name", "nom de la contrepartie", "contrepartie", "payee",
    "payee name", "partner name", "beneficiaire", "beneficiary", "beneficiary name", "recipient", "destinataire", "emetteur", "tiers",
    "libelle simplifie", "supplierfound", "target name", "store name", "vendor", "supplier", "fournisseur", "empfanger",
  ],
  note: ["note", "notes", "remarque", "comment", "commentaire", "memo"],
  account: ["product", "produit", "account", "account name", "source account", "accountlabel", "compte", "virtual account"],
};

// Titres qui trahissent un rapport de pub ou un export Shopify : ce n'est pas un relevé de banque.
const REPORT_HEADER = new RegExp("^(?:impressions?|clicks?|clics?|reach|couverture|campaign(?: name| id)?|campagne|nom de la campagne|" +
  "ad set name|ad name|ad group(?: name)?|adgroup name|cpm|cpc|ctr|roas|orders?|commandes?|sku|payout id|payout date|payout status|" +
  "charges|lineitem name|financial status|fulfillment status|spend|cost|amount spent.*|montant depense.*|purchases?|results?|resultats?)$");

/* ------------------------------------------------------------------ petits outils */

function isObj(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Texte d'une cellule : caractères de contrôle retirés, espaces (insécables comprises) réduites à une seule.
function squash(value) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\s\u00a0\u202f]+/g, " ").trim();
}

function fold(value) {
  return normHeader(value);
}

function short(text, max = 30) {
  const s = squash(text);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function plural(n, one, many) {
  return n + " " + (n > 1 ? many : one);
}

function cleanLabel(text) {
  const s = squash(text);
  return s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1).trimEnd() + "…" : s;
}

function currencyCode(value) {
  const s = squash(value);
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  return s ? detectCurrency(s) : null;
}

// Devise écrite dans le titre de la colonne : "Amount (EUR)", "Montant(EUROS)", "Paid Out (USD)".
function currencyFromHeader(header) {
  const s = String(header || "");
  const code = s.match(/\b(EUR|USD|GBP|CHF|CAD|AUD|MAD|AED)\b/i);
  if (code) return code[1].toUpperCase();
  if (/\beuros?\b|€/i.test(s)) return "EUR";
  if (/\bdollars?\b|\$/i.test(s)) return "USD";
  if (/£/.test(s)) return "GBP";
  return null;
}

/**
 * Lit un montant de relevé en centimes, ou null si la cellule ne contient pas un nombre.
 * Les symboles et codes de devise collés au nombre sont tolérés ("-5432,00€", "USD -12.50", "$1,250.00", "(12.34)", "12,34-").
 */
function parseMoney(cell, decimal) {
  const s = squash(cell);
  if (!s) return null;
  const bare = s.replace(/[\s'\u2019$€£¥]/g, "").replace(/^[A-Za-z]{1,4}(?=[-+(\u2212.,\d])/, "").replace(/[A-Za-z]{1,4}$/, "");
  if (!/^[-+\u2212(]*[.,]?\d[\d.,]*[-\u2212)]*$/.test(bare)) return null;
  const cents = parseAmountToCents(s, decimal === "," || decimal === "." ? { decimal } : {});
  // Un nombre d\u00e9mesur\u00e9 (identifiant, num\u00e9ro de compte) n'est pas un montant.
  return Number.isSafeInteger(cents) && Math.abs(cents) <= MAX_CENTS ? cents : null;
}

// Séparateur décimal d'un fichier, décidé sur toutes ses colonnes de montants : "," ou ".", "auto" si rien ne tranche.
// Indices : les deux séparateurs dans la même cellule (le dernier est le décimal), ou un séparateur unique qui n'est pas
// suivi de trois chiffres exactement ("12,5", "94.77", "0.1234"). "1,234" seul ne dit rien.
function detectDecimal(rows, columns) {
  let comma = false;
  let dot = false;
  for (const row of rows) {
    for (const c of columns) {
      const s = String(row[c] == null ? "" : row[c]).replace(/[^0-9.,]/g, "");
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      if (lastDot < 0 && lastComma < 0) continue;
      if (lastDot >= 0 && lastComma >= 0) {
        if (lastDot > lastComma) dot = true; else comma = true;
        continue;
      }
      const isDot = lastDot >= 0;
      const last = isDot ? lastDot : lastComma;
      const repeated = s.indexOf(isDot ? "." : ",") !== last;
      // Répété ("1.234.567") : c'est un séparateur de milliers, donc l'autre est le décimal.
      if (repeated) { if (isDot) comma = true; else dot = true; continue; }
      if (s.length - 1 - last !== 3) { if (isDot) dot = true; else comma = true; }
    }
  }
  if (comma && !dot) return ",";
  if (dot && !comma) return ".";
  return "auto";
}

// Vrai si le montant a plus de deux décimales significatives ("12.3456") : il sera arrondi au centime.
function hasExtraDecimals(raw, decimal) {
  if (decimal !== "," && decimal !== ".") return false;
  const s = String(raw).replace(/[^0-9.,]/g, "");
  const at = s.lastIndexOf(decimal);
  if (at < 0) return false;
  const fraction = s.slice(at + 1);
  return /^\d{3,}$/.test(fraction) && /[1-9]/.test(fraction.slice(2));
}

// Ordre jour/mois d'une colonne de dates. `ambiguous` : aucune valeur ne permet de trancher.
function detectOrder(rows, column, fallback) {
  let ymd = 0;
  let dmy = 0;
  let mdy = 0;
  let unclear = 0;
  for (const row of rows) {
    const s = squash(row[column]);
    if (!s) continue;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) { ymd++; continue; }
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
    else unclear++;
  }
  if (ymd && ymd >= dmy + mdy + unclear) return { order: "YMD", ambiguous: false };
  if (dmy || mdy) return { order: dmy >= mdy ? "DMY" : "MDY", ambiguous: false };
  return { order: fallback || "DMY", ambiguous: unclear > 0 };
}

// 4 derniers chiffres d'une carte : "0562", "5167 **** **** 0562", "Ads Meta (2487)", "•• 0562". null si la cellule n'en donne pas.
function last4(cell) {
  const s = squash(cell);
  if (!s) return null;
  if (/^\d{3,4}$/.test(s)) return s.padStart(4, "0");
  const masked = s.match(/(?:[*\u2022\u00b7#]+\s*|[xX.]{2,}\s*|\(\s*|\bending(?: in)?\s+|(?:^|[\s-])[xX])(\d{4})\s*\)?$/);
  if (masked) return masked[1];
  const digits = s.replace(/\D/g, "");
  return digits.length >= 12 && /\d{4}$/.test(s) ? digits.slice(-4) : null;
}

// Carte citée dans un libellé de banque française : "CARTE X1234", "CARTE 4974XXXXXXXX1234", "CB*1234".
function cardFromLabel(label) {
  const m = String(label || "").match(/\b(?:CARTE|CB)\s*(?:\d{4}[X*]{4,}|[X*]+)(\d{4})\b/i);
  return m ? m[1] : null;
}

// Nom du commerçant dans un libellé de banque : "CARTE 01/08 MONOPRIX" -> "MONOPRIX", "To Alice Martin" -> "Alice Martin",
// "Uber *Trip" -> "Uber". Avec `strict`, seulement quand le libellé commence par une formule connue (sinon null).
function merchantOf(label, strict) {
  let s = squash(label);
  const before = s;
  s = s.replace(/^(?:paiement (?:par )?carte|paiement cb|achat (?:cb|carte)|facture carte|carte|cb|pr[eé]l[eè]vement(?: sepa)?|prlv(?: sepa)?|vir(?:ement)?(?: sepa| inst(?:antan[eé])?)?(?: re[cç]u| [eé]mis)?)\b[\s:*.-]*(?:(?:du|de|pour|vers)\s+)?/i, "");
  s = s.replace(/^(?:Payment from|Payment to|Money added from|Deposit from|Transfer to|Transfer from|To|From) (?=\S)/, "");
  if (s === before) {
    if (strict) return null;
  } else {
    // Date de l'achat avant le nom, numéro de facture ou de carte après.
    s = s.replace(/^(?:x?\d{4}\s+)?\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+/i, "").replace(/^\d{6}\s+/, "");
    s = s.replace(/\s+(?:fact(?:ure)?\s+[\w.-]*\d[\w.-]*|carte\s+\S*\d{3,4}|cb\*\d{4}|\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)$/i, "");
  }
  s = s.replace(/\s*\*.*$/, "").trim();
  if (s.length < 2 || s.length > 40 || !/[A-Za-z]/.test(s) || /\d{6}/.test(s) || /\b(?:by|par|from|de)$/i.test(s)) return null;
  return s;
}

function uniqueJoin(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const key = fold(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(" ");
}

/* ------------------------------------------------------------------ lecture des colonnes */

function pick(norm, candidates, taken) {
  for (const candidate of candidates) {
    for (let i = 0; i < norm.length; i++) {
      if (!norm[i] || (taken && taken.has(i))) continue;
      if (typeof candidate === "string" ? norm[i] === candidate : candidate.test(norm[i])) return i;
    }
  }
  return -1;
}

function emptyMapping() {
  const m = {};
  for (const role of ROLES) m[role] = -1;
  return m;
}

function hasCore(m) {
  return m.date >= 0 && (m.amount >= 0 || (m.debit >= 0 && m.credit >= 0));
}

// Attribution automatique des rôles à partir des titres : chaque colonne ne sert qu'à un rôle.
function guessRoles(norm) {
  const taken = new Set();
  const take = (candidates) => {
    const i = pick(norm, candidates, taken);
    if (i >= 0) taken.add(i);
    return i;
  };
  const m = emptyMapping();
  m.date = take(SYN.date);
  m.valueDate = take(SYN.valueDate);
  if (m.date < 0 && m.valueDate >= 0) { m.date = m.valueDate; m.valueDate = -1; }
  m.amount = take(SYN.amount);
  if (m.amount < 0) {
    const debit = pick(norm, SYN.debit, taken);
    const credit = pick(norm, SYN.credit, taken);
    if (debit >= 0 && credit >= 0) { m.debit = debit; m.credit = credit; taken.add(debit); taken.add(credit); }
  }
  m.currency = take(SYN.currency);
  // Un montant "net" contient déjà les frais : la colonne des frais n'est alors qu'une information.
  if (m.amount < 0 || !/^net\b/.test(norm[m.amount])) m.fee = take(SYN.fee);
  m.feeCurrency = take(SYN.feeCurrency);
  m.balance = take(SYN.balance);
  m.id = take(SYN.id);
  m.reference = take(SYN.reference);
  m.status = take(SYN.status);
  m.type = take(SYN.type);
  m.direction = take(SYN.direction);
  m.card = take(SYN.card);
  m.cardLabel = take(SYN.cardLabel);
  m.origAmount = take(SYN.origAmount);
  m.origCurrency = take(SYN.origCurrency);
  m.label = take(SYN.label);
  m.counterparty = take(SYN.counterparty);
  // "Name" est le tiers dans un fichier PayPal, mais le titulaire du compte ailleurs.
  if (m.counterparty < 0) {
    const name = pick(norm, ["name", "nom"], taken);
    if (name >= 0 && (m.id >= 0 || m.label < 0)) { m.counterparty = name; taken.add(name); }
  }
  m.note = take(SYN.note);
  m.account = take(SYN.account);
  return m;
}

const views = new WeakMap();

/**
 * Vue de travail d'un fichier lu par parseCsv : titres normalisés, lignes, numéros de ligne.
 * Si la ligne d'en-tête retenue ne contient ni date ni montant, la vraie ligne de titres est cherchée dans les 40 premières lignes
 * (relevés qui commencent par plusieurs lignes de titre).
 */
function viewOf(parsed) {
  const cacheable = isObj(parsed);
  if (cacheable) {
    const hit = views.get(parsed);
    if (hit) return hit;
  }
  const source = cacheable ? parsed : {};
  let headers = Array.isArray(source.headers) ? source.headers.map((h) => (h == null ? "" : String(h))) : [];
  let rows = Array.isArray(source.rows) ? source.rows.filter(Array.isArray) : [];
  let lines = Array.isArray(source.lineNumbers) && source.lineNumbers.length === rows.length ? source.lineNumbers.slice() : rows.map((_, i) => i + 2);
  let norm = headers.map(normHeader);
  let roles = guessRoles(norm);
  if (!hasCore(roles)) {
    const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
    for (let r = 0; r < limit; r++) {
      const candidate = rows[r].map(normHeader);
      if (candidate.filter(Boolean).length < 3) continue;
      const guess = guessRoles(candidate);
      if (hasCore(guess) && (guess.label >= 0 || guess.counterparty >= 0)) {
        headers = rows[r].map((h) => (h == null ? "" : String(h)));
        norm = candidate;
        roles = guess;
        lines = lines.slice(r + 1);
        rows = rows.slice(r + 1);
        break;
      }
    }
  }
  const view = {
    headers, norm, rows, lines, roles,
    delimiter: typeof source.delimiter === "string" ? source.delimiter : ",",
    report: norm.some((h) => REPORT_HEADER.test(h)),
    french: norm.some((h) => /\b(?:libelle|montant|solde|devise|valeur|heure|etat|statut|numero|nom)\b/.test(h)),
  };
  if (cacheable) views.set(parsed, view);
  return view;
}

const has = (v, ...names) => names.some((name) => v.norm.includes(name));
const hasRe = (v, re) => v.norm.some((h) => re.test(h));
const col = (v, ...candidates) => pick(v.norm, candidates);

/* ------------------------------------------------------------------ statuts */

const KEEP = "keep";
const PENDING = "pending";
const DEAD = "dead";
const REVIEW = "review";

const STATUS_KEEP = new Set([
  "completed", "complete", "termine", "terminee", "settled", "posted", "sent", "success", "successful", "succeeded", "paid", "processed",
  "executed", "booked", "cleared", "effectue", "effectuee", "execute", "executee", "comptabilise", "comptabilisee", "refunded", "refund",
  "returned", "partially refunded", "rembourse", "remboursee", "regle", "reglee", "done", "ok",
]);
const STATUS_PENDING = new Set([
  "pending", "en attente", "processing", "en cours", "en cours de traitement", "in progress", "created", "scheduled", "authorized",
  "authorised", "pending approval", "in review", "on hold", "unverified", "active", "uncleared", "programme", "programmee",
]);
const STATUS_DEAD = new Set([
  "declined", "refuse", "refusee", "failed", "echoue", "echouee", "echec", "canceled", "cancelled", "annule", "annulee", "reverted",
  "reversed", "voided", "void", "expired", "expire", "expiree", "denied", "rejected", "rejete", "rejetee", "blocked", "deleted",
]);

function genericStatus(status) {
  if (!status || STATUS_KEEP.has(status)) return KEEP;
  if (STATUS_PENDING.has(status)) return PENDING;
  if (STATUS_DEAD.has(status)) return DEAD;
  return REVIEW;
}

const OUT_WORDS = new Set(["out", "outgoing", "debit", "dr", "d", "sortant", "sortie", "withdrawal", "paid out"]);
const IN_WORDS = new Set(["in", "incoming", "credit", "cr", "c", "entrant", "entree", "deposit", "paid in"]);
const NEUTRAL_WORDS = new Set(["neutral", "memo"]);

// Raisons d'ignorer une ligne : [singulier, pluriel], affichées après le nombre.
const SKIP = {
  pending: ["en attente", "en attente"],
  dead: ["refusée, annulée ou échouée", "refusées, annulées ou échouées"],
  exchange: ["change entre devises", "changes entre devises"],
  pocket: ["mouvement de poche ou d'épargne", "mouvements de poche ou d'épargne"],
  conversion: ["conversion entre soldes", "conversions entre soldes"],
  memo: ["ligne d'information", "lignes d'information"],
  hold: ["blocage temporaire", "blocages temporaires"],
  zero: ["à montant nul", "à montant nul"],
  empty: ["sans montant", "sans montant"],
};

/* ------------------------------------------------------------------ préréglages */

const TOPUP_NOTE = "Rechargement du compte : apport d'un associé ou virement entre tes comptes ? À vérifier.";
const MONEY_IN_NOTE = "Entrée d'argent à classer : vente, apport d'un associé ou virement entre tes comptes ?";

function revolutPost(r) {
  const type = r.key("type");
  if (/^(?:fee|frais)$/.test(type)) { r.category = "bank_fees"; r.partyOverride = "Revolut"; }
  else if (r.amountCents > 0 && /top ?up|recharge|ajout/.test(type)) r.note = TOPUP_NOTE;
}

const REVOLUT = {
  type: "bank_revolut",
  label: "Revolut (compte personnel)",
  help: "Dans l'appli Revolut : ouvre le compte, touche « ... » puis Relevé, choisis le format Excel (CSV) et la période. Un fichier par devise.",
  source: "revolut",
  name: "Revolut",
  dateOrder: "YMD",
  decimal: ".",
  fee: "cost",
  merchantLabel: true,
  score(v) {
    if (!has(v, "started date", "date de debut") || !has(v, "type") || !has(v, "description")) return 0;
    if (!has(v, "amount", "montant") || has(v, "payment currency", "fiat amount")) return 0;
    return has(v, "state", "etat") ? 0.95 : 0.85;
  },
  mapping(v) {
    return {
      date: col(v, "started date", "date de debut"),
      valueDate: col(v, "completed date", "date de fin"),
      label: col(v, "description"),
      amount: col(v, "amount", "montant"),
      fee: col(v, "fee", "frais"),
      currency: col(v, "currency", "devise"),
      balance: col(v, "balance", "solde"),
      type: col(v, "type"),
      status: col(v, "state", "etat", "status", "statut"),
      account: col(v, "product", "produit"),
    };
  },
  // Seules les lignes terminées comptent. État inconnu : la ligne est gardée (à vérifier) si le solde est renseigné.
  status(status, r) {
    if (!status || /^(?:completed?|termine)/.test(status)) return KEEP;
    if (STATUS_PENDING.has(status)) return PENDING;
    if (STATUS_DEAD.has(status)) return DEAD;
    return r.text("balance") ? REVIEW : PENDING;
  },
  pre(r) {
    if (/exchange|\bchange\b|echange/.test(r.key("type")) || /^(?:exchanged to|echange (?:en|contre|vers)|converti en)\b/.test(r.key("label"))) return "exchange";
    if (/savings|epargne|pocket|poche|vault|coffre/.test(r.key("account"))) return "pocket";
    return null;
  },
  post: revolutPost,
};

const REVOLUT_BUSINESS = {
  type: "bank_revolut_business",
  label: "Revolut Business",
  help: "Dans Revolut Business : Accueil, « ... », Relevés, Relevé de compte, choisis le compte et le format CSV.",
  source: "revolut",
  name: "Revolut",
  dateOrder: "YMD",
  decimal: ".",
  fee: "cost",
  merchantLabel: true,
  score(v) {
    if (!hasRe(v, /^date started\b/) || !has(v, "amount")) return 0;
    return has(v, "payment currency", "orig currency") ? 0.95 : 0;
  },
  mapping(v) {
    return {
      date: col(v, "date started utc", /^date started\b/),
      valueDate: col(v, "date completed utc", /^date completed\b/),
      id: col(v, "id"),
      type: col(v, "type"),
      status: col(v, "state"),
      label: col(v, "description"),
      reference: col(v, "reference"),
      card: col(v, "card number"),
      cardLabel: col(v, "card label", "card name"),
      origCurrency: col(v, "orig currency"),
      origAmount: col(v, "orig amount"),
      currency: col(v, "payment currency"),
      amount: col(v, "amount"),
      fee: col(v, "fee"),
      feeCurrency: col(v, "fee currency"),
      balance: col(v, "balance"),
      account: col(v, "account"),
    };
  },
  status(status) {
    if (!status || status === "completed") return KEEP;
    return STATUS_DEAD.has(status) ? DEAD : STATUS_PENDING.has(status) ? PENDING : REVIEW;
  },
  pre(r) {
    return r.key("type") === "exchange" ? "exchange" : null;
  },
  post: revolutPost,
};

// Slash ne publie pas le format de son export : colonnes reconnues d'après les colonnes du tableau de bord et les champs de son API.
const SLASH = {
  type: "bank_slash",
  label: "Slash",
  help: "Dans Slash : page Transactions, bouton Export en haut de la liste (fichier CSV).",
  source: "slash",
  name: "Slash",
  assumed: true,
  dateOrder: "MDY",
  decimal: ".",
  currency: "USD",
  fee: "cost",
  labelFrom: "counterparty",
  score(v) {
    if (v.report || !hasRe(v, /^amount(?: usd| cents)?$|^amountcents$/) || !has(v, "status", "detailed status")) return 0;
    if (has(v, "state", "payment currency", "gross", "net", "bank description", "transferwise id", "counterparty name", "booking date",
      "started date", "source account", "balance impact", "source currency")) return 0;
    if (!has(v, "to from", "merchant", "merchant name", "description")) return 0;
    if (!has(v, "card", "id", "transaction id", "card name", "card last 4")) return 0;
    return has(v, "to from") ? 0.85 : 0.6;
  },
  mapping(v) {
    return {
      date: col(v, "date", "posted at", "posted date", "date posted", "created at", "authorized at", "date utc", "transaction date", "timestamp", "posted", "created"),
      counterparty: col(v, "to from", "merchant", "merchant name", "counterparty", "name"),
      label: col(v, "description", "merchant description", "details"),
      narrative: col(v, "memo", "note", "notes"),
      amount: col(v, "amount", "amount usd", "amount cents", "amountcents", /^amount\b/),
      status: col(v, "status", "detailed status"),
      card: col(v, "card last 4", "card last four", "last 4", "last four", "card", "card number"),
      cardLabel: col(v, "card name", "card"),
      type: col(v, "type", "transaction type"),
      direction: col(v, "direction"),
      origAmount: col(v, "original amount"),
      origCurrency: col(v, "original currency", "original currency code"),
      fee: col(v, "fx fee", "fee"),
      currency: col(v, "currency"),
      id: col(v, "id", "transaction id"),
      account: col(v, "account", "virtual account", "account name"),
    };
  },
  status(status) {
    if (/^disput/.test(status)) return REVIEW;
    if (status === "reversed") return DEAD;
    return genericStatus(status);
  },
  post(r, env) {
    const status = r.key("status");
    if (/^refund/.test(status)) r.amountCents = Math.abs(r.amountCents);
    else if (env.unsigned()) {
      // Fichier sans aucun montant négatif : un paiement par carte est une sortie, le reste une entrée.
      const hint = r.key("type") + " " + r.key("direction");
      if (/\b(?:credit|deposit|incoming|in|cashback|refund|refunded|return|returned)\b/.test(hint)) r.amountCents = Math.abs(r.amountCents);
      else if (/\b(?:debit|withdrawal|outgoing|out|payment|purchase|fee)\b/.test(hint) || r.text("card")) r.amountCents = 0 - Math.abs(r.amountCents);
      env.flags.add("unsigned");
    }
    if (/^disput/.test(status)) r.category = "chargebacks";
  },
  intro(v, m) {
    const named = [["date", "date"], ["amount", "montant"], ["counterparty", "tiers"], ["label", "libellé"], ["status", "statut"], ["card", "carte"], ["id", "identifiant"]]
      .filter(([role]) => m[role] >= 0)
      .map(([role, word]) => word + " : « " + short(v.headers[m[role]], 24) + " »");
    return ["Format Slash supposé (Slash ne publie pas le format de son export). Colonnes reconnues : " + named.join(", ") +
      ". Vérifie quelques lignes avant d'importer."];
  },
};

const WISE = {
  type: "bank_wise",
  label: "Wise (relevé d'un solde)",
  help: "Sur wise.com : ouvre le solde, Relevés et rapports, relevé du solde au format CSV. Un fichier par devise.",
  source: "bank",
  name: "Wise",
  dateOrder: "DMY",
  decimal: ".",
  score(v) {
    return has(v, "transferwise id", "wise id") && has(v, "amount") && has(v, "currency") ? 0.95 : 0;
  },
  mapping(v) {
    return {
      id: col(v, "transferwise id", "wise id", "id"),
      date: col(v, "date"),
      amount: col(v, "amount"),
      currency: col(v, "currency"),
      label: col(v, "description"),
      reference: col(v, "payment reference"),
      balance: col(v, "running balance"),
      card: col(v, "card last four digits"),
      type: col(v, "transaction details type"),
      merchant: col(v, "merchant"),
      payee: col(v, "payee name"),
      payer: col(v, "payer name"),
    };
  },
  party(r) {
    return r.text("merchant") || (r.amountCents < 0 ? r.text("payee") : r.text("payer"));
  },
  pre(r) {
    if (/^balance\b/.test(r.key("id")) || /conversion|cross balance/.test(r.key("type")) || /^converted\b/.test(r.key("label"))) return "conversion";
    return null;
  },
  post(r) {
    // Avec l'option "frais sur une ligne à part", la ligne de frais porte le même identifiant que le transfert.
    if (/\bcharges for\b/.test(r.key("label"))) { r.category = "bank_fees"; r.idSuffix = ":fee"; r.partyOverride = "Wise"; }
  },
};

const WISE_HISTORY = {
  type: "bank_wise_history",
  label: "Wise (liste des transferts)",
  help: "Sur wise.com : Transactions, Télécharger la liste au format CSV. Toutes les devises sont dans le même fichier.",
  source: "bank",
  name: "Wise",
  dateOrder: "YMD",
  decimal: ".",
  fee: "cost",
  labelFrom: "counterparty",
  moneyRoles: ["sourceAmount", "targetAmount"],
  score(v) {
    return has(v, "id") && has(v, "status") && has(v, "direction") && has(v, "source currency") && has(v, "target currency") ? 0.95 : 0;
  },
  mapping(v) {
    return {
      id: col(v, "id"),
      status: col(v, "status"),
      direction: col(v, "direction"),
      date: col(v, "created on"),
      valueDate: col(v, "finished on"),
      reference: col(v, "reference"),
      note: col(v, "note"),
      fee: col(v, "source fee amount"),
      feeCurrency: col(v, "source fee currency"),
      sourceName: col(v, "source name"),
      sourceAmount: col(v, "source amount after fees", /^source amount\b/),
      sourceCurrency: col(v, "source currency"),
      targetName: col(v, "target name"),
      targetAmount: col(v, "target amount after fees", /^target amount\b/),
      targetCurrency: col(v, "target currency"),
    };
  },
  status(status) {
    if (status === "completed") return KEEP;
    return /cancel|refund|fail|reject/.test(status) ? DEAD : PENDING;
  },
  // Montants sans signe : le sens vient de la colonne Direction.
  custom(r, env) {
    const direction = r.key("direction");
    if (direction === "neutral") return { skip: "conversion" };
    const out = direction !== "in";
    const raw = r.text(out ? "sourceAmount" : "targetAmount");
    if (!raw) return { empty: true };
    const cents = parseMoney(raw, env.decimal);
    if (cents === null) return { error: "montant illisible (« " + short(raw) + " »)" };
    return { cents: out ? 0 - Math.abs(cents) : Math.abs(cents), currency: currencyCode(r.text(out ? "sourceCurrency" : "targetCurrency")) };
  },
  party(r) {
    return r.amountCents < 0 ? r.text("targetName") : r.text("sourceName");
  },
  post(r) {
    if (r.amountCents > 0) r.feeCents = 0;
  },
};

const MERCURY = {
  type: "bank_mercury",
  label: "Mercury",
  help: "Dans Mercury : page Transactions, Export, format CSV.",
  source: "bank",
  name: "Mercury",
  dateOrder: "MDY",
  decimal: ".",
  currency: "USD",
  labelFrom: "counterparty",
  score(v) {
    return has(v, "date utc", "date") && has(v, "description") && has(v, "amount") && has(v, "status") && has(v, "bank description") ? 0.95 : 0;
  },
  mapping(v) {
    return {
      date: col(v, "date utc", "date"),
      counterparty: col(v, "description"),
      narrative: col(v, "bank description"),
      amount: col(v, "amount"),
      status: col(v, "status"),
      reference: col(v, "reference"),
      note: col(v, "note"),
      card: col(v, "last four digits"),
      cardLabel: col(v, "name on card"),
      account: col(v, "source account"),
    };
  },
};

const PAYPAL = {
  type: "bank_paypal",
  label: "PayPal (téléchargement de l'activité)",
  help: "Dans PayPal : Rapports d'activité, Téléchargement de l'activité, type « Toutes les transactions », format CSV.",
  source: "bank",
  name: "PayPal",
  dateOrder: (v) => (v.french ? "DMY" : "MDY"),
  fee: "signed",
  feeCategory: "fees_payment",
  labelFrom: "counterparty",
  moneyRoles: ["net"],
  score(v) {
    return has(v, "transaction id", "numero de transaction") && has(v, "gross", "avant commission", "brut") && has(v, "net") ? 0.95 : 0;
  },
  mapping(v) {
    const gross = col(v, "gross", "avant commission", "brut");
    return {
      date: col(v, "date"),
      counterparty: col(v, "name", "nom"),
      type: col(v, "type"),
      status: col(v, "status", "etat", "statut"),
      currency: col(v, "currency", "devise"),
      amount: gross >= 0 ? gross : col(v, "net"),
      fee: gross >= 0 ? col(v, "fee", "commission", "frais") : -1,
      net: col(v, "net"),
      id: col(v, "transaction id", "numero de transaction"),
      label: col(v, "item title", "titre de l objet", "subject", "objet", "description"),
      balance: col(v, "balance", "solde"),
      direction: col(v, "balance impact", "impact sur le solde"),
      note: col(v, "note", "remarque"),
    };
  },
  status(status) {
    return status === "reversed" ? KEEP : genericStatus(status);
  },
  pre(r) {
    const type = r.key("type");
    if (r.key("direction") === "memo" || /shopping cart item|article du panier/.test(type)) return "memo";
    if (/currency conversion|conversion de devise/.test(type)) return "conversion";
    if (/\b(?:hold|release|authorization|autorisation|suspension|blocage|reserve)\b/.test(type)) return "hold";
    return null;
  },
  post(r) {
    const type = r.key("type");
    if (r.amountCents < 0 && /refund|remboursement/.test(type)) r.category = "refunds";
    else if (/withdrawal|retrait|virement|add funds|approvisionnement|bank deposit|charge from/.test(type)) {
      r.note = "Mouvement entre PayPal et ta banque : à enregistrer comme un mouvement entre comptes, pas comme une dépense ou une vente.";
    }
  },
};

const QONTO = {
  type: "bank_qonto",
  label: "Qonto",
  help: "Dans Qonto : Transactions, Exporter, export complet au format CSV.",
  source: "bank",
  name: "Qonto",
  dateOrder: "DMY",
  currency: "EUR",
  labelFrom: "counterparty",
  score(v) {
    return has(v, "counterparty name", "nom de la contrepartie") && has(v, "total amount incl vat", "montant total ttc") ? 0.9 : 0;
  },
  mapping(v) {
    return {
      status: col(v, "status", "statut"),
      id: col(v, "transaction id", "identifiant de transaction"),
      date: col(v, "operation date local", "operation date utc", "date de l operation local", "date de l operation utc", /^operation date\b/, /^date de l operation\b/),
      valueDate: col(v, "settlement date local", "settlement date utc", "date de la valeur local", "date de la valeur utc", /^settlement date\b/, /^date de (?:la )?valeur\b/),
      counterparty: col(v, "counterparty name", "nom de la contrepartie"),
      type: col(v, "payment method", "methode de paiement"),
      reference: col(v, "reference"),
      note: col(v, "note"),
      amount: col(v, "total amount incl vat", "montant total ttc"),
      currency: col(v, "currency", "devise"),
      origAmount: col(v, "total amount incl vat local", "montant total ttc local"),
      origCurrency: col(v, "currency local", "devise local"),
    };
  },
  post(r) {
    if (/subscription fees|frais d abonnement/.test(r.key("type"))) r.category = "bank_fees";
  },
};

const N26 = {
  type: "bank_n26",
  label: "N26",
  help: "Sur le site N26 : Téléchargements, relevé des transactions au format CSV.",
  source: "bank",
  name: "N26",
  dateOrder: "YMD",
  decimal: ".",
  currency: "EUR",
  labelFrom: "counterparty",
  score(v) {
    if (has(v, "booking date") && has(v, "partner name")) return 0.9;
    if (!hasRe(v, /^(?:amount|montant|betrag) eur$/)) return 0;
    return (has(v, "payee") && has(v, "transaction type")) || (has(v, "beneficiaire") && has(v, "type de transaction")) ||
      (has(v, "empfanger") && has(v, "transaktionstyp")) ? 0.9 : 0;
  },
  mapping(v) {
    return {
      date: col(v, "booking date", "date", "datum"),
      valueDate: col(v, "value date"),
      counterparty: col(v, "partner name", "payee", "beneficiaire", "empfanger"),
      narrative: col(v, "payment reference", "reference de paiement", "verwendungszweck"),
      type: col(v, "type", "transaction type", "type de transaction", "transaktionstyp"),
      amount: col(v, "amount eur", "montant eur", "betrag eur"),
      origAmount: col(v, "original amount", "amount foreign currency", "montant devise etrangere", "betrag fremdwahrung"),
      origCurrency: col(v, "original currency", "type foreign currency", "selectionnez la devise etrangere", "fremdwahrung"),
      account: col(v, "account name"),
    };
  },
};

const PAYONEER = {
  type: "bank_payoneer",
  label: "Payoneer",
  help: "Dans Payoneer : Activité, Transactions, icône CSV au-dessus de la liste.",
  source: "bank",
  name: "Payoneer",
  dateOrder: "MDY",
  decimal: ".",
  score(v) {
    return has(v, "transaction date") && has(v, "transaction id") && has(v, "credit amount") && has(v, "debit amount") ? 0.95 : 0;
  },
  mapping(v) {
    return {
      date: col(v, "transaction date"),
      id: col(v, "transaction id"),
      label: col(v, "description"),
      narrative: col(v, "additional description"),
      credit: col(v, "credit amount"),
      debit: col(v, "debit amount"),
      currency: col(v, "currency"),
      status: col(v, "status"),
      balance: col(v, "running balance"),
      target: col(v, "target"),
      source: col(v, "source"),
    };
  },
  party(r) {
    return r.amountCents < 0 ? r.text("target") : r.text("source");
  },
};

const GENERIC = {
  type: "bank_generic",
  label: "Autre banque (colonnes repérées automatiquement)",
  help: "Relevé de n'importe quelle banque au format CSV. Les colonnes date, libellé et montant (ou débit et crédit) sont repérées toutes seules, et tu peux les corriger.",
  source: "bank",
  name: null,
  generic: true,
  dateOrder: (v, decimal) => (v.french || v.delimiter === ";" || decimal === "," ? "DMY" : "MDY"),
  fee: "cost",
  score(v) {
    const m = v.roles;
    if (!hasCore(m) || (m.label < 0 && m.counterparty < 0)) return 0;
    if (v.report || has(v, "fiat amount")) return 0.05;
    let seen = 0;
    let dated = 0;
    for (let i = 0; i < v.rows.length && seen < 8; i++) {
      const raw = squash(v.rows[i][m.date]);
      if (!raw) continue;
      seen++;
      if (parseDateLoose(raw)) dated++;
    }
    return seen && !dated ? 0.05 : 0.2;
  },
  mapping(v) {
    return { ...v.roles };
  },
};

const PRESETS = [REVOLUT, REVOLUT_BUSINESS, SLASH, WISE, WISE_HISTORY, MERCURY, PAYPAL, QONTO, N26, PAYONEER, GENERIC];

/* ------------------------------------------------------------------ lecture d'un relevé */

// Colonnes à utiliser : celles du préréglage, corrigées par celles que l'utilisateur a choisies.
function resolveMapping(preset, v, given, exclusive) {
  const m = exclusive ? emptyMapping() : { ...emptyMapping(), ...preset.mapping(v) };
  if (isObj(given)) {
    for (const key of Object.keys(given)) {
      if (key === "dateOrder" || key === "decimal") { if (typeof given[key] === "string") m[key] = given[key]; } else if (Number.isInteger(given[key])) m[key] = given[key];
    }
  }
  for (const key of Object.keys(m)) {
    if (typeof m[key] === "number" && !(Number.isInteger(m[key]) && m[key] >= 0 && m[key] < v.headers.length)) m[key] = -1;
  }
  if (m.date < 0 && m.valueDate >= 0) { m.date = m.valueDate; m.valueDate = -1; }
  return m;
}

function moneyColumns(preset, m) {
  const roles = ["amount", "debit", "credit", "fee", "origAmount", "balance", ...(preset.moneyRoles || [])];
  return roles.map((role) => m[role]).filter((i) => Number.isInteger(i) && i >= 0);
}

function fileDecimal(preset, v, m) {
  if (m.decimal === "," || m.decimal === ".") return m.decimal;
  const found = detectDecimal(v.rows, moneyColumns(preset, m));
  return found === "auto" && preset.decimal ? preset.decimal : found;
}

function fileOrder(preset, v, m, decimal) {
  if (m.dateOrder === "YMD" || m.dateOrder === "DMY" || m.dateOrder === "MDY") return { order: m.dateOrder, ambiguous: false };
  const fallback = typeof preset.dateOrder === "function" ? preset.dateOrder(v, decimal) : preset.dateOrder;
  const found = detectOrder(v.rows, m.date, fallback);
  return { order: found.order, ambiguous: found.ambiguous && !!preset.generic };
}

function safeSuggest(config, input) {
  try {
    return suggestCategory(config, input);
  } catch {
    return null;
  }
}

function isIgnored(ignored, draft) {
  if (!ignored) return false;
  const key = ignoreKey(draft);
  if (ignored instanceof Set) return ignored.has(key);
  if (Array.isArray(ignored)) return ignored.includes(key);
  return isObj(ignored) && Object.prototype.hasOwnProperty.call(ignored, key) && !!ignored[key];
}

function readStatement(preset, v, override, ctx, out) {
  const options = isObj(ctx.options) ? ctx.options : {};
  const config = isObj(ctx.config) ? ctx.config : isObj(ctx.book) && isObj(ctx.book.config) ? ctx.book.config : null;
  const accountId = ctx.accountId == null ? "" : String(ctx.accountId);
  const account = config && isObj(config.accounts) && isObj(config.accounts[accountId]) ? config.accounts[accountId] : null;
  const accountCur = account ? currencyCode(account.currency) : null;
  const baseCur = config && isObj(config.business) ? currencyCode(config.business.baseCurrency) : null;
  let owner = "unknown";
  try { owner = accountOwner(config, accountId); } catch { owner = "unknown"; }
  const business = owner === "business";
  // Prénoms ou noms des associés : un libellé qui en contient un est sans doute un apport, un remboursement ou un retrait.
  const partners = [];
  if (config && isObj(config.partners)) {
    for (const id of Object.keys(config.partners)) {
      const partner = config.partners[id];
      const key = isObj(partner) && !partner.archived ? fold(partner.name) : "";
      if (key.length >= 3) partners.push({ id: partner.id || id, name: squash(partner.name), key: " " + key + " " });
    }
  }

  if (has(v, "fiat amount")) {
    out.warnings.push("Ce fichier est un export de compte crypto : il ne contient pas de mouvements bancaires à importer.");
    return;
  }
  const m = resolveMapping(preset, v, override || (isObj(options.mapping) ? options.mapping : null), !!override);
  if (m.date < 0 || !(m.amount >= 0 || (m.debit >= 0 && m.credit >= 0) || preset.custom)) {
    out.warnings.push("Je n'ai pas trouvé la colonne de la date ou celle du montant dans ce fichier. Indique-les à la main, ou choisis un autre type de fichier.");
    return;
  }

  const decimal = fileDecimal(preset, v, m);
  const { order, ambiguous } = fileOrder(preset, v, m, decimal);
  const amountInCents = m.amount >= 0 && /\bcents\b|amountcents/.test(v.norm[m.amount]);
  const headerCur = currencyFromHeader(v.headers[m.amount >= 0 ? m.amount : m.debit]);
  const flags = new Set();
  let unsignedCache = null;
  const env = {
    m, v, decimal, flags,
    // Vrai si la colonne des montants ne contient aucune valeur négative (fichier sans signe).
    unsigned() {
      if (unsignedCache === null) {
        unsignedCache = false;
        if (m.amount >= 0) {
          let seen = 0;
          let negative = false;
          for (const row of v.rows) {
            const cents = parseMoney(row[m.amount], decimal);
            if (cents === null) continue;
            seen++;
            if (cents < 0) { negative = true; break; }
          }
          unsignedCache = seen > 0 && !negative;
        }
      }
      return unsignedCache;
    },
  };

  const skipped = new Map();
  const skip = (reason) => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  const rowWarnings = [];
  let moreRowWarnings = 0;
  const warnRow = (line, why) => {
    if (rowWarnings.length < MAX_ROW_WARNINGS) rowWarnings.push("Ligne " + line + " ignorée : " + why + ".");
    else moreRowWarnings++;
  };
  const occurrences = new Map();
  const bump = (key) => {
    const n = occurrences.get(key) || 0;
    occurrences.set(key, n + 1);
    return n;
  };
  const drafts = [];
  const assumedCurrency = new Set();
  const foreignLines = new Map();
  const otherAccountCards = new Map();
  let rounded = 0;
  let unknownStatus = 0;

  for (let i = 0; i < v.rows.length; i++) {
    const cells = v.rows[i];
    const line = v.lines[i] || i + 2;
    try {
      let filled = 0;
      for (const cell of cells) if (squash(cell)) filled++;
      if (filled < 2) continue;

      const r = {
        cells, line, amountCents: 0, category: null, note: "", review: false, idSuffix: "", partyOverride: "", feeCents: null,
        text: (role) => (m[role] >= 0 ? squash(cells[m[role]]) : ""),
        key: (role) => (m[role] >= 0 ? fold(cells[m[role]]) : ""),
      };

      // Date : la ligne de titres répétée, les lignes de total et de solde n'en ont pas.
      const rawDate = r.text("date") || r.text("valueDate");
      if (rawDate && fold(rawDate) === v.norm[m.date]) continue;
      const date = rawDate ? parseDateLoose(rawDate, order) : null;
      if (!date) {
        const totalRow = cells.some((cell) => /\b(?:solde|total|totaux|sous total|subtotal|balance|opening|closing)\b/.test(fold(cell)));
        if (!totalRow) warnRow(line, rawDate ? "date illisible (« " + short(rawDate) + " »)" : "date manquante");
        continue;
      }

      if (m.status >= 0) {
        const status = r.key("status");
        const verdict = preset.status ? preset.status(status, r) : genericStatus(status);
        if (verdict === PENDING || verdict === DEAD) { skip(verdict); continue; }
        if (verdict === REVIEW) { r.review = true; unknownStatus++; }
      }
      const internal = preset.pre ? preset.pre(r, env) : null;
      if (internal) { skip(internal); continue; }
      if (!preset.custom && m.direction >= 0 && NEUTRAL_WORDS.has(r.key("direction"))) { skip("memo"); continue; }

      // Montant
      let amount;
      if (preset.custom) amount = preset.custom(r, env);
      else if (m.amount >= 0) {
        const raw = r.text("amount");
        const cents = raw ? parseMoney(raw, decimal) : null;
        if (!raw) amount = { empty: true };
        else if (cents === null) amount = { error: "montant illisible (« " + short(raw) + " »)" };
        else {
          amount = { cents: amountInCents ? Math.round(cents / 100) : cents };
          if (hasExtraDecimals(raw, decimal)) rounded++;
          if (m.direction >= 0 && env.unsigned()) {
            const direction = r.key("direction");
            if (OUT_WORDS.has(direction)) amount.cents = 0 - Math.abs(amount.cents);
            else if (IN_WORDS.has(direction)) amount.cents = Math.abs(amount.cents);
          }
        }
      } else {
        const rawDebit = r.text("debit");
        const rawCredit = r.text("credit");
        const debit = rawDebit ? parseMoney(rawDebit, decimal) : 0;
        const credit = rawCredit ? parseMoney(rawCredit, decimal) : 0;
        if (!rawDebit && !rawCredit) amount = { empty: true };
        else if (debit === null || credit === null) amount = { error: "montant illisible (« " + short(debit === null ? rawDebit : rawCredit) + " »)" };
        // La colonne débit contient un nombre positif (Fortuneo) ou déjà négatif (Caisse d'Epargne) : même résultat.
        else amount = { cents: credit - Math.abs(debit) };
      }
      if (!amount || amount.empty) { skip("empty"); continue; }
      if (amount.skip) { skip(amount.skip); continue; }
      if (amount.error) { warnRow(line, amount.error); continue; }
      r.amountCents = amount.cents;

      // Frais dans une colonne à part
      if (m.fee >= 0 && preset.fee) {
        const fee = parseMoney(r.text("fee"), decimal);
        if (fee) r.feeCents = preset.fee === "signed" ? fee : 0 - Math.abs(fee);
      }
      if (preset.post) preset.post(r, env);
      if (!Number.isInteger(r.amountCents)) { warnRow(line, "montant illisible"); continue; }
      if (r.amountCents === 0) { skip("zero"); continue; }

      // Devise : colonne, sinon titre de la colonne, sinon devise du compte.
      let currency = amount.currency || currencyCode(r.text("currency")) || headerCur;
      if (!currency) {
        currency = accountCur || preset.currency || baseCur || "USD";
        assumedCurrency.add(currency);
      }
      if (accountCur && currency !== accountCur) foreignLines.set(currency, (foreignLines.get(currency) || 0) + 1);

      // Montant d'origine (devise du reçu) quand la banque le donne : le montant de la ligne devient le montant débité.
      let amountCents = r.amountCents;
      let opCurrency = currency;
      let settledCents = null;
      if (m.origAmount >= 0 && m.origCurrency >= 0 && (!accountCur || currency === accountCur)) {
        const origCurrency = currencyCode(r.text("origCurrency"));
        const origAmount = parseMoney(r.text("origAmount"), decimal);
        if (origCurrency && origCurrency !== currency && origAmount) {
          settledCents = amountCents;
          amountCents = amountCents < 0 ? 0 - Math.abs(origAmount) : Math.abs(origAmount);
          opCurrency = origCurrency;
        }
      }

      // Libellé, tiers, catégorie
      const description = r.text("label");
      const narrative = r.text("narrative");
      const counterparty = r.partyOverride || (preset.party ? squash(preset.party(r)) : r.text("counterparty"));
      const typeText = r.text("type");
      const shown = preset.labelFrom === "counterparty" ? counterparty || description || narrative : description || counterparty || narrative;
      const label = cleanLabel(shown || typeText) || "Mouvement sans libellé";
      const bankLabel = cleanLabel(description || narrative || counterparty || typeText) || label;
      // Sans colonne "tiers", le nom du commerçant est tiré du libellé (jamais du type d'opération).
      const guessedParty = (counterparty ? merchantOf(counterparty, true) || counterparty : shown ? merchantOf(label, !preset.merchantLabel) : "") || "";
      const suggestion = safeSuggest(config, { label: uniqueJoin([label, description, narrative]), party: guessedParty, amountCents });
      const categoryId = suggestion ? suggestion.categoryId : r.category || null;
      let party = squash((suggestion && suggestion.party) || guessedParty);
      if (party.length > MAX_PARTY) party = "";

      // Carte
      const cardCell = r.text("card");
      const card = last4(cardCell) || cardFromLabel(bankLabel);
      const cardLabel = [r.text("cardLabel"), cardCell].find((text) => text && !/^\d+$/.test(text)) || "";
      if (card && config && !otherAccountCards.has(card)) {
        let cardAccount = null;
        try { cardAccount = suggestAccount(config, { card }); } catch { cardAccount = null; }
        if (cardAccount && cardAccount !== accountId) otherAccountCards.set(card, cardAccount);
      }

      // Identifiant externe, stable d'un import à l'autre
      const bankId = r.text("id");
      let extId;
      if (bankId) {
        const n = bump("id|" + bankId + r.idSuffix);
        extId = "bank:" + accountId + ":" + bankId + r.idSuffix + (n ? "#" + (n + 1) : "");
      } else {
        const key = [date, r.amountCents, currency, fold(bankLabel)].join("|");
        extId = "bank:" + accountId + ":" + hashString(key + "|" + bump(key));
      }

      const valueDate = m.valueDate >= 0 && m.valueDate !== m.date ? parseDateLoose(r.text("valueDate"), order) : null;
      const reference = r.text("reference");
      const ref = reference && reference.length <= 40 ? reference : bankId && bankId.length <= 24 ? bankId : "";
      const selected = business || !!suggestion;

      const draft = { kind: "pl", date, label, accountId, amountCents, currency: opCurrency, categoryId };
      if (settledCents !== null) draft.settledCents = settledCents;
      if (party) draft.party = party;
      if (ref) draft.ref = ref;
      if (card) draft.card = card;
      const noteText = r.text("note");
      if (noteText) draft.note = noteText.slice(0, 200);
      draft.source = preset.source;
      draft.extId = extId;
      if (!categoryId || r.review) draft.needsReview = true;
      draft.reconciled = true;
      draft.bank = { date: valueDate || date, label: bankLabel };
      const meta = {};
      if (typeText && typeText.length <= 40) meta.type = typeText;
      if (cardLabel) meta.cardLabel = cardLabel.slice(0, 60);
      if (bankId && bankId !== ref) meta.txId = bankId;
      if (Object.keys(meta).length) draft.meta = meta;
      draft._selected = selected;
      let note = "";
      if (r.review) {
        note = "Statut inconnu sur le relevé (« " + short(r.text("status")) + " ») : vérifie que l'argent a bien bougé.";
      } else if (!categoryId) {
        const haystack = " " + fold(label + " " + party + " " + bankLabel) + " ";
        const partner = partners.find((p) => haystack.includes(p.key));
        if (partner) {
          draft._partnerId = partner.id;
          note = amountCents > 0
            ? partner.name + " apparaît dans le libellé : si c'est un apport, enregistre cette entrée comme un mouvement entre comptes, pas comme une vente."
            : partner.name + " apparaît dans le libellé : si c'est un remboursement, un retrait ou un règlement entre associés, enregistre cette sortie comme un mouvement entre comptes, pas comme une dépense.";
        } else {
          note = r.note || (business && amountCents > 0 ? MONEY_IN_NOTE : "");
        }
      }
      if (note) draft._note = note;
      drafts.push(draft);

      if (r.feeCents) {
        const feeDraft = {
          kind: "pl", date, accountId,
          label: cleanLabel((preset.name ? "Frais " + preset.name : "Frais bancaires") + " : " + label),
          amountCents: r.feeCents,
          currency: currencyCode(r.text("feeCurrency")) || currency,
          categoryId: preset.feeCategory || "bank_fees",
        };
        if (preset.name) feeDraft.party = preset.name;
        if (card) feeDraft.card = card;
        feeDraft.source = preset.source;
        feeDraft.extId = extId + ":fee";
        feeDraft.reconciled = true;
        feeDraft.bank = { date: valueDate || date, label: bankLabel };
        feeDraft._selected = selected;
        drafts.push(feeDraft);
        flags.add("fees");
      }
    } catch {
      warnRow(line, "ligne illisible");
    }
  }

  // Lignes que l'utilisateur a déjà écartées, puis rapprochement avec les opérations déjà saisies.
  let result = drafts;
  if (options.ignored) {
    result = result.map((draft) => (isIgnored(options.ignored, draft)
      ? { ...draft, _selected: false, _note: "Ligne écartée lors d'un import précédent." } : draft));
  }
  let matched = 0;
  if (isObj(ctx.book)) {
    try {
      result = attachMatches(result, ctx.book, accountId);
      matched = result.filter((draft) => draft._matchOf).length;
    } catch {
      matched = 0;
    }
  }
  out.drafts = result;

  // Résumé pour l'aperçu
  const info = out.info;
  if (!result.length) {
    out.warnings.push("Aucun mouvement à importer dans ce fichier.");
  } else {
    let first = result[0].date;
    let last = result[0].date;
    const totals = new Map();
    for (const draft of result) {
      if (draft.date < first) first = draft.date;
      if (draft.date > last) last = draft.date;
      let t = totals.get(draft.currency);
      if (!t) { t = { outCount: 0, outCents: 0, inCount: 0, inCents: 0 }; totals.set(draft.currency, t); }
      if (draft.amountCents < 0) { t.outCount++; t.outCents += draft.amountCents; } else { t.inCount++; t.inCents += draft.amountCents; }
    }
    const parts = [];
    for (const [currency, t] of totals) {
      const bits = [];
      if (t.outCount) bits.push(plural(t.outCount, "sortie", "sorties") + " (" + formatMoney(0 - t.outCents, currency) + ")");
      if (t.inCount) bits.push(plural(t.inCount, "entrée", "entrées") + " (" + formatMoney(t.inCents, currency) + ")");
      parts.push(bits.join(", "));
    }
    info.push(plural(result.length, "mouvement lu", "mouvements lus") + " du " + formatDate(first) + " au " + formatDate(last) + " : " + parts.join(" ; ") + ".");
    if (!business) {
      const kept = result.filter((draft) => draft._selected).length;
      const who = owner === "unknown" ? "Compte pas encore attribué à l'entreprise" : "Compte personnel (" + partnerLabel(config, owner) + ")";
      info.push(who + " : " + plural(kept, "ligne cochée", "lignes cochées") + " sur " + result.length +
        ", celles que j'ai reconnues comme liées à l'entreprise. Coche toi-même les autres si elles la concernent.");
    }
    if (matched) {
      info.push(plural(matched, "ligne correspond", "lignes correspondent") + " à des opérations déjà saisies : elles seront pointées, sans créer de doublon.");
    }
  }
  if (skipped.size) {
    let total = 0;
    const reasons = [];
    for (const [reason, count] of skipped) {
      total += count;
      const words = SKIP[reason] || [reason, reason];
      reasons.push(count + " " + (count > 1 ? words[1] : words[0]));
    }
    info.push(plural(total, "ligne ignorée", "lignes ignorées") + " : " + reasons.join(", ") + ".");
  }
  if (assumedCurrency.size && result.length) {
    const currency = Array.from(assumedCurrency)[0];
    info.push("Pas de colonne devise dans ce fichier : montants lus en " + currency + (accountCur === currency ? " (devise du compte)." : "."));
  }
  if (flags.has("fees") && preset.generic) {
    info.push("La colonne des frais a été importée à part (catégorie Frais bancaires). Si tes montants contiennent déjà les frais, décoche ces lignes.");
  }
  if (preset.intro && result.length) info.push(...preset.intro(v, m));

  // Avertissements
  out.warnings.push(...rowWarnings);
  if (moreRowWarnings) out.warnings.push(plural(moreRowWarnings, "autre ligne illisible ignorée", "autres lignes illisibles ignorées") + ".");
  if (ambiguous && result.length) {
    out.warnings.push("Les dates de ce fichier peuvent se lire dans les deux sens (jour/mois ou mois/jour). Je les ai lues comme " +
      (order === "MDY" ? "mois/jour/année" : "jour/mois/année") + " : vérifie une date avant d'importer.");
  }
  if (flags.has("unsigned")) {
    out.warnings.push("Aucun montant négatif dans ce fichier : j'ai compté les paiements par carte comme des sorties d'argent et le reste comme des entrées. Vérifie le sens de quelques lignes avant d'importer.");
  }
  if (unknownStatus) {
    out.warnings.push(plural(unknownStatus, "ligne a un statut que je ne connais pas : elle est gardée", "lignes ont un statut que je ne connais pas : elles sont gardées") + " avec la mention « À vérifier ».");
  }
  if (rounded) {
    out.warnings.push(plural(rounded, "montant avait plus de deux décimales : il a été arrondi", "montants avaient plus de deux décimales : ils ont été arrondis") + " au centime.");
  }
  for (const [currency, count] of foreignLines) {
    out.warnings.push(plural(count, "ligne est", "lignes sont") + " en " + currency + " alors que le compte « " + accountLabel(config, accountId) +
      " » est en " + accountCur + " : vérifie que tu importes ce relevé dans le bon compte.");
  }
  for (const [card, otherId] of otherAccountCards) {
    out.warnings.push("La carte " + card + " est rattachée au compte « " + accountLabel(config, otherId) + " » dans tes réglages, mais ce relevé est importé dans « " +
      accountLabel(config, accountId) + " ».");
  }
}

function runPreset(preset, parsed, override, ctx) {
  const out = { drafts: [], stats: null, warnings: [], info: [] };
  let v = null;
  try { v = viewOf(parsed); } catch { v = null; }
  if (!v || !v.headers.length) {
    out.warnings.push("Ce fichier est vide ou illisible : aucune ligne à importer.");
    return out;
  }
  try {
    readStatement(preset, v, override, isObj(ctx) ? ctx : {}, out);
  } catch {
    out.drafts = [];
    out.warnings.push("Ce fichier n'a pas pu être lu. Vérifie qu'il s'agit bien d'un relevé exporté au format CSV, ou indique les colonnes à la main.");
  }
  return out;
}

/* ------------------------------------------------------------------ API */

function presetByType(type) {
  return PRESETS.find((preset) => preset.type === type) || null;
}

/**
 * Importeurs de relevés bancaires, du plus précis au plus général.
 * Chaque entrée : { type, label, help, needs, detect(parsed) -> 0..1, parse(parsed, ctx) -> { drafts, stats: null, warnings, info } }.
 * `parse` ne lève jamais d'exception. `ctx.options.mapping` corrige des colonnes (rangs), `ctx.options.ignored` liste les clés
 * (voir ignoreKey) des lignes que l'utilisateur a déjà écartées : elles restent décochées.
 * Champs d'aperçu posés sur les brouillons (jamais enregistrés) : `_selected`, `_note` (remarque en français), `_matchOf`
 * (opération déjà saisie que la ligne va pointer, quand `ctx.book` est fourni), `_partnerId` (associé dont le nom figure dans
 * une ligne sans catégorie : apport, remboursement ou retrait probable).
 * Chaque brouillon porte `reconciled: true` et `bank: { date, label }` : une opération créée depuis un relevé est déjà pointée.
 */
export const IMPORTERS = PRESETS.map((preset) => ({
  type: preset.type,
  label: preset.label,
  help: preset.help,
  needs: { account: true, platform: false },
  detect(parsed) {
    try {
      const v = viewOf(parsed);
      if (!v.headers.length) return 0;
      const score = Number(preset.score(v)) || 0;
      return score < 0 ? 0 : score > 1 ? 1 : score;
    } catch {
      return 0;
    }
  },
  parse(parsed, ctx) {
    return runPreset(preset, parsed, null, ctx);
  },
}));

/**
 * Devine le rôle de chaque colonne d'un relevé, pour l'écran où l'utilisateur vérifie ou corrige les colonnes.
 * @param {object} parsed résultat de parseCsv
 * @param {string} [type] type d'importeur ("bank_revolut"...) : ses colonnes sont alors reprises telles quelles
 * @returns {{ date: number, label: number, counterparty: number, amount: number, debit: number, credit: number, currency: number,
 *   fee: number, balance: number, reference: number, dateOrder: "YMD"|"DMY"|"MDY", decimal: "."|","|"auto" }}
 *   rangs de colonnes (-1 = absente). D'autres rôles sont aussi renvoyés (valueDate, id, status, type, direction, card, cardLabel,
 *   origAmount, origCurrency, narrative, note, account, feeCurrency).
 */
export function guessMapping(parsed, type) {
  try {
    const v = viewOf(parsed);
    const preset = presetByType(type) || GENERIC;
    const m = resolveMapping(preset, v, null, false);
    m.decimal = fileDecimal(preset, v, m);
    m.dateOrder = m.date >= 0 ? fileOrder(preset, v, m, m.decimal).order : "DMY";
    return m;
  } catch {
    return { ...emptyMapping(), dateOrder: "DMY", decimal: "auto" };
  }
}

/**
 * Lit un relevé avec les colonnes choisies par l'utilisateur (rangs de colonnes, -1 ou absent = pas de colonne).
 * Mêmes règles et même résultat que les importeurs. `ctx.options.preset` (type d'importeur) garde les règles propres à une banque
 * (lignes à ignorer, sens des frais) ; sans lui, les règles générales s'appliquent.
 * @param {object} parsed résultat de parseCsv
 * @param {object} mapping voir guessMapping ; dateOrder et decimal absents ou "auto" = devinés
 * @param {{ config?: object, book?: object, accountId?: string, options?: object }} ctx
 * @returns {{ drafts: object[], stats: null, warnings: string[], info: string[] }}
 */
export function parseBankRows(parsed, mapping, ctx) {
  const options = isObj(ctx) && isObj(ctx.options) ? ctx.options : {};
  const preset = presetByType(options.preset) || GENERIC;
  return runPreset(preset, parsed, isObj(mapping) ? mapping : {}, ctx);
}

/**
 * Clé courte d'une ligne de relevé, à ranger dans `meta/ignored` quand l'utilisateur choisit de ne pas l'importer.
 * @param {{ extId?: string }} draft
 * @returns {string}
 */
export function ignoreKey(draft) {
  return hashString(isObj(draft) && draft.extId ? draft.extId : "");
}
