// Modèle de données : réglages (config), opérations, catégories, règles de partage du bénéfice.
// Logique pure : tout ce qui vient du stockage est considéré comme non fiable et passe par les normaliseurs.
import { CURRENCIES, formatMoney } from "./money.js";
import { isValidISO, monthOf, monthLabel, addDays } from "./dates.js";

export const SCHEMA_VERSION = 1;

/** Propriétaire d'un compte : l'entreprise. */
export const BUSINESS = "business";
/** Propriétaire d'un compte : pas encore attribué (pseudo associé "à attribuer"). */
export const UNKNOWN = "unknown";
/** Pseudo catégorie des opérations non classées. */
export const UNCATEGORIZED = "uncategorized";

/** Groupes de catégories, fixés dans le code. */
export const GROUPS = Object.freeze([
  { id: "sales", label: "Ventes", kind: "income" },
  { id: "ads", label: "Publicité", kind: "expense" },
  { id: "production", label: "Production des films", kind: "expense" },
  { id: "platform", label: "Plateforme et paiement", kind: "expense" },
  { id: "tools", label: "Logiciels et abonnements", kind: "expense" },
  { id: "people", label: "Créateurs et prestataires", kind: "expense" },
  { id: "finance", label: "Banque et change", kind: "expense" },
  { id: "admin", label: "Juridique, compta et impôts", kind: "expense" },
  { id: "other", label: "Divers", kind: "expense" },
].map(Object.freeze));

/** Plateformes de pub (liste fixe) et la catégorie de dépense de chacune. */
export const AD_PLATFORMS = Object.freeze([
  { id: "meta", label: "Meta", categoryId: "ads_meta" },
  { id: "tiktok", label: "TikTok", categoryId: "ads_tiktok" },
  { id: "applovin", label: "AppLovin", categoryId: "ads_applovin" },
  { id: "google", label: "Google", categoryId: "ads_google" },
  { id: "other", label: "Autre", categoryId: "ads_other" },
].map(Object.freeze));

/** Types de compte proposés dans les réglages. */
export const ACCOUNT_KINDS = Object.freeze([
  { id: "bank", label: "Compte bancaire" },
  { id: "card", label: "Carte" },
  { id: "paypal", label: "PayPal" },
  { id: "wallet", label: "Portefeuille en ligne" },
  { id: "cash", label: "Espèces" },
  { id: "other", label: "Autre" },
].map(Object.freeze));

/** Rôles d'un associé. */
export const PARTNER_ROLES = Object.freeze([
  { id: "founder", label: "Fondateur" },
  { id: "investor", label: "Investisseur" },
  { id: "partner", label: "Associé" },
].map(Object.freeze));

const CATEGORY_LIST = [
  ["sales_shopify", "Ventes Shopify", "income", "sales"],
  ["sales_other", "Autres ventes", "income", "sales"],
  ["refunds", "Remboursements clients", "income", "sales"],
  ["other_income", "Autres encaissements", "income", "sales"],
  ["ads_meta", "Pub Meta (Facebook, Instagram)", "expense", "ads"],
  ["ads_tiktok", "Pub TikTok", "expense", "ads"],
  ["ads_applovin", "Pub AppLovin", "expense", "ads"],
  ["ads_google", "Pub Google", "expense", "ads"],
  ["ads_other", "Autre pub", "expense", "ads"],
  ["production_ai", "Outils IA et rendu vidéo", "expense", "production"],
  ["production_other", "Autres coûts de production", "expense", "production"],
  ["shopify_sub", "Abonnement Shopify", "expense", "platform"],
  ["shopify_apps", "Apps Shopify", "expense", "platform"],
  ["fees_payment", "Frais de paiement (Shopify Payments, PayPal)", "expense", "platform"],
  ["chargebacks", "Litiges et rétrofacturations", "expense", "platform"],
  ["email_sms", "Email et SMS (Klaviyo)", "expense", "tools"],
  ["software", "Logiciels et abonnements", "expense", "tools"],
  ["domain_hosting", "Domaine et hébergement", "expense", "tools"],
  ["creators", "Créateurs UGC et influence", "expense", "people"],
  ["freelancers", "Freelances et prestataires", "expense", "people"],
  ["bank_fees", "Frais bancaires et change", "expense", "finance"],
  ["legal_admin", "Juridique, compta, LLC", "expense", "admin"],
  ["taxes", "Impôts et taxes", "expense", "admin"],
  ["shipping", "Livraison et impression", "expense", "other"],
  ["other_expense", "Autres dépenses", "expense", "other"],
];

/** Catégories par défaut (identifiants stables), { [id]: Category }. */
export const DEFAULT_CATEGORIES = Object.freeze(
  Object.fromEntries(
    CATEGORY_LIST.map(([id, name, kind, group], i) => [
      id,
      Object.freeze({ id, name, kind, group, system: true, order: (i + 1) * 10, archived: false }),
    ]),
  ),
);

/** Origine d'une opération (champ `source`) et son libellé. */
export const SOURCES = Object.freeze({
  manual: "Saisie manuelle",
  shopify: "Shopify",
  meta: "Meta",
  tiktok: "TikTok",
  applovin: "AppLovin",
  google: "Google Ads",
  bank: "Relevé bancaire",
  revolut: "Revolut",
  slash: "Slash",
  scan: "Reçu scanné",
  text: "Texte collé",
  recurring: "Abonnement récurrent",
  claude: "Assistant Claude",
  demo: "Exemple",
});

const GROUP_IDS = GROUPS.map((g) => g.id);
const ACCOUNT_KIND_IDS = ACCOUNT_KINDS.map((k) => k.id);
const ROLE_IDS = PARTNER_ROLES.map((r) => r.id);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------------------------------------
// Petits outils de conversion de types (ne lèvent jamais d'exception).

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Entrée d'une liste indexée par identifiant, sans jamais confondre avec une propriété héritée ("constructor"...). */
function own(map, id) {
  if (!isObj(map) || typeof id !== "string" || !Object.prototype.hasOwnProperty.call(map, id)) return null;
  const value = map[id];
  return isObj(value) ? value : null;
}

function toStr(v, fallback = "") {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function toNum(v, fallback) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** Entier pour les réglages : un nombre à virgule est arrondi. */
function toInt(v, fallback) {
  const n = toNum(v, null);
  if (n === null) return fallback;
  const r = Math.round(n);
  return Number.isSafeInteger(r) ? r : fallback;
}

/** Entier strict pour les montants d'opération : on ne devine jamais un montant mal formé. */
function strictInt(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d{1,15}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function normCurrency(v, fallback = null) {
  if (typeof v !== "string") return fallback;
  const code = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function normDate(v) {
  if (typeof v !== "string") return null;
  if (isValidISO(v)) return v;
  // Une date-heure ISO est acceptée : on garde le jour.
  if (v.length > 10 && (v[10] === "T" || v[10] === " ") && isValidISO(v.slice(0, 10))) return v.slice(0, 10);
  return null;
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/** Entrées [id, objet] d'une liste stockée (objet indexé par id, ou tableau d'objets avec id). Ignore null et le reste. */
function entriesOf(map) {
  if (Array.isArray(map)) {
    return map.filter(isObj).map((v) => [toStr(v.id).trim(), v]).filter(([k]) => k && k !== "__proto__");
  }
  if (!isObj(map)) return [];
  return Object.entries(map).filter(([k, v]) => k && k !== "__proto__" && isObj(v));
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortEntities(list) {
  return list.sort(
    (a, b) =>
      (toNum(a.order, 0) - toNum(b.order, 0)) ||
      String(a.name || "").localeCompare(String(b.name || ""), "fr") ||
      compareText(String(a.id), String(b.id)),
  );
}

// ---------------------------------------------------------------------------------------------
// Configuration

function normPartner(id, p) {
  const share = toNum(p.sharePct, null);
  return {
    ...p,
    id,
    name: toStr(p.name).trim() || "Associé",
    role: ROLE_IDS.includes(p.role) ? p.role : "partner",
    sharePct: share !== null && share >= 0 ? round4(share) : null,
    joinedOn: normDate(p.joinedOn),
    userId: typeof p.userId === "string" && p.userId ? p.userId : null,
    order: toNum(p.order, 0),
    archived: p.archived === true,
  };
}

function normCards(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" || typeof value === "number" ? String(value).split(/[\s,;]+/) : [];
  const out = [];
  for (const item of list) {
    const digits = toStr(item).replace(/\D/g, "");
    if (!digits) continue;
    const last4 = digits.slice(-4).padStart(4, "0");
    if (!out.includes(last4)) out.push(last4);
  }
  return out;
}

function normAccount(id, a, partners) {
  let owner = toStr(a.owner).trim();
  if (owner !== BUSINESS && !own(partners, owner)) owner = UNKNOWN;
  return {
    ...a,
    id,
    name: toStr(a.name).trim() || "Compte",
    kind: ACCOUNT_KIND_IDS.includes(a.kind) ? a.kind : "bank",
    owner,
    currency: normCurrency(a.currency, "USD"),
    cards: normCards(a.cards),
    openingCents: toInt(a.openingCents, 0),
    order: toNum(a.order, 0),
    archived: a.archived === true,
  };
}

function normCategories(stored) {
  const out = {};
  const raw = Object.fromEntries(entriesOf(stored));
  for (const id of Object.keys(DEFAULT_CATEGORIES)) {
    const base = DEFAULT_CATEGORIES[id];
    const over = own(raw, id) || {};
    // Une catégorie d'origine peut être renommée, réordonnée ou archivée, mais garde sa nature et son groupe.
    out[id] = {
      ...over,
      ...base,
      name: toStr(over.name).trim() || base.name,
      order: toNum(over.order, base.order),
      archived: over.archived === true,
    };
  }
  for (const id of Object.keys(raw)) {
    if (DEFAULT_CATEGORIES[id] || id === UNCATEGORIZED) continue;
    const c = raw[id];
    const kind = c.kind === "income" ? "income" : "expense";
    let group = GROUP_IDS.includes(c.group) ? c.group : kind === "income" ? "sales" : "other";
    if (kind === "income") group = "sales";
    else if (group === "sales") group = "other";
    out[id] = {
      ...c,
      id,
      name: toStr(c.name).trim() || "Catégorie",
      kind,
      group,
      system: false,
      order: toNum(c.order, 1000),
      archived: c.archived === true,
    };
  }
  return out;
}

function normRules(stored) {
  const out = {};
  for (const [id, r] of entriesOf(stored)) {
    const contains = toStr(r.contains).trim();
    const categoryId = toStr(r.categoryId).trim();
    if (!contains) continue;
    out[id] = {
      ...r,
      id,
      contains,
      categoryId: categoryId || null,
      accountId: typeof r.accountId === "string" && r.accountId ? r.accountId : null,
      order: toNum(r.order, 0),
      enabled: r.enabled !== false,
    };
  }
  return out;
}

function normRecurring(stored) {
  const out = {};
  for (const [id, r] of entriesOf(stored)) {
    const day = toInt(r.day, 1);
    out[id] = {
      ...r,
      id,
      label: toStr(r.label).trim() || "Abonnement",
      amountCents: toInt(r.amountCents, 0),
      currency: normCurrency(r.currency, "USD"),
      categoryId: typeof r.categoryId === "string" && r.categoryId ? r.categoryId : null,
      accountId: typeof r.accountId === "string" && r.accountId ? r.accountId : null,
      day: Math.min(31, Math.max(1, day)),
      start: typeof r.start === "string" && MONTH_RE.test(r.start) ? r.start : null,
      end: typeof r.end === "string" && MONTH_RE.test(r.end) ? r.end : null,
      active: r.active !== false,
    };
  }
  return out;
}

function normFx(stored) {
  const out = {};
  for (const [key, entry] of entriesOf(stored)) {
    const cur = normCurrency(key);
    if (!cur || cur === "USD") continue;
    const def = toNum(entry.default, null);
    const months = {};
    if (isObj(entry.months)) {
      for (const [month, value] of Object.entries(entry.months)) {
        const rate = toNum(value, null);
        if (MONTH_RE.test(month) && rate !== null && rate > 0) months[month] = rate;
      }
    }
    out[cur] = { default: def !== null && def > 0 ? def : null, months };
  }
  return out;
}

function normClosed(stored) {
  const out = {};
  if (!isObj(stored)) return out;
  for (const [month, value] of Object.entries(stored)) {
    if (!MONTH_RE.test(month) || value === null || value === undefined || value === false) continue;
    const v = isObj(value) ? value : {};
    out[month] = {
      at: typeof v.at === "string" && v.at ? v.at : null,
      by: typeof v.by === "string" && v.by ? v.by : null,
    };
  }
  return out;
}

function normShares(stored) {
  const out = {};
  if (!isObj(stored)) return out;
  for (const [partnerId, value] of Object.entries(stored)) {
    const pct = toNum(value, null);
    if (!partnerId || partnerId === "__proto__" || pct === null || pct < 0) continue;
    out[partnerId] = round4(pct);
  }
  return out;
}

function normShareRules(stored) {
  const out = {};
  for (const [id, r] of entriesOf(stored)) {
    out[id] = { ...r, id, from: normDate(r.from), shares: normShares(r.shares) };
  }
  return out;
}

function normalizeConfigUnsafe(input) {
  const raw = isObj(input) ? input : {};
  const b = isObj(raw.business) ? raw.business : {};
  const baseCurrency = normCurrency(b.baseCurrency);

  const partners = {};
  for (const [id, p] of entriesOf(raw.partners)) {
    if (id === BUSINESS || id === UNKNOWN) continue;
    partners[id] = normPartner(id, p);
  }
  const accounts = {};
  for (const [id, a] of entriesOf(raw.accounts)) accounts[id] = normAccount(id, a, partners);

  const out = {};
  // Les champs inconnus sont conservés (compatibilité avec une version plus récente), sauf les valeurs effacées.
  for (const key of Object.keys(raw)) {
    if (raw[key] !== null && raw[key] !== undefined && key !== "__proto__") out[key] = raw[key];
  }
  out.v = SCHEMA_VERSION;
  out.onboarded = raw.onboarded === true;
  out.demo = raw.demo === true;
  out.business = {
    ...b,
    name: toStr(b.name).trim() || "StarringYou",
    baseCurrency: baseCurrency && CURRENCIES[baseCurrency] ? baseCurrency : "USD",
    startDate: normDate(b.startDate),
    pivotDate: normDate(b.pivotDate),
    pivotLabel: toStr(b.pivotLabel).trim() || "Arrivée de l'investisseur",
    vat: b.vat === true,
  };
  out.partners = partners;
  out.accounts = accounts;
  out.categories = normCategories(raw.categories);
  out.rules = normRules(raw.rules);
  out.recurring = normRecurring(raw.recurring);
  out.fx = normFx(raw.fx);
  out.closed = normClosed(raw.closed);
  out.shareRules = normShareRules(raw.shareRules);
  return out;
}

/**
 * Configuration neuve : catégories par défaut, aucun associé, aucun compte, aucune règle de partage.
 * @returns {object} Config
 */
export function defaultConfig() {
  return normalizeConfigUnsafe(null);
}

/**
 * Remet une configuration stockée dans la forme attendue : valeurs par défaut, types corrigés, entrées
 * effacées (null) retirées, catégories d'origine toujours présentes. Ne lève jamais d'exception et ne
 * modifie pas son argument. Appliquée deux fois, elle donne le même résultat.
 * @param {*} raw configuration lue dans le stockage (ou n'importe quoi)
 * @returns {object} Config
 */
export function normalizeConfig(raw) {
  try {
    return normalizeConfigUnsafe(raw);
  } catch {
    return normalizeConfigUnsafe(null);
  }
}

// ---------------------------------------------------------------------------------------------
// Opérations

const OP_TEXT_FIELDS = ["party", "ref", "note", "source", "extId", "createdAt", "createdBy", "updatedAt", "updatedBy"];
const OP_FLAGS = ["needsReview", "estimated", "reconciled", "demo"];
/** Champs calculés par buildBook : jamais considérés comme des données de l'opération. */
const OP_DERIVED = ["baseCents", "fxEstimated", "month", "lines", "effects", "accountEffects", "ownerId", "fromOwnerId", "toOwnerId", "nature", "sharePeriod"];
/** Champs traités un par un : tout autre champ est recopié tel quel (compatibilité avec une version plus récente). */
const OP_HANDLED = new Set([
  "id", "kind", "date", "label", "amountCents", "currency",
  "accountId", "categoryId", "settledCents", "splits", "fromAccountId", "toAccountId", "toAmountCents",
  "card", "attachments", "bank", "meta",
  ...OP_TEXT_FIELDS, ...OP_FLAGS, ...OP_DERIVED,
]);

function normAttachments(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const a of value) {
    if (!isObj(a)) continue;
    const id = toStr(a.id).trim();
    if (!id) continue;
    out.push({ ...a, id, name: toStr(a.name), type: toStr(a.type), size: toNum(a.size, 0) });
  }
  return out;
}

function normSplits(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  for (const s of value) {
    if (!isObj(s)) return null;
    const amountCents = strictInt(s.amountCents);
    if (amountCents === null) return null;
    out.push({ categoryId: typeof s.categoryId === "string" && s.categoryId ? s.categoryId : null, amountCents });
  }
  return out;
}

function normalizeOpUnsafe(raw) {
  if (!isObj(raw)) return null;
  const id = toStr(raw.id).trim();
  if (!id) return null;
  let kind = raw.kind;
  if (kind === null || kind === undefined) kind = raw.fromAccountId != null || raw.toAccountId != null ? "transfer" : "pl";
  if (kind !== "pl" && kind !== "transfer") return null;
  const date = normDate(raw.date);
  if (!date) return null;
  const amountCents = strictInt(raw.amountCents);
  if (amountCents === null) return null;
  const currency = normCurrency(raw.currency);
  if (!currency) return null;
  if (kind === "transfer" && amountCents < 0) return null;

  // Les champs sont posés un par un, toujours dans le même ordre : pas de suppression après coup.
  const op = { id, kind, date, label: toStr(raw.label).trim(), amountCents, currency };
  const setText = (key, value) => {
    const text = toStr(value).trim();
    if (text) op[key] = text;
  };
  if (kind === "pl") {
    setText("accountId", raw.accountId);
    op.categoryId = typeof raw.categoryId === "string" && raw.categoryId ? raw.categoryId : null;
    const settled = strictInt(raw.settledCents);
    if (settled !== null) op.settledCents = settled;
    const splits = normSplits(raw.splits);
    if (splits) op.splits = splits;
  } else {
    setText("fromAccountId", raw.fromAccountId);
    setText("toAccountId", raw.toAccountId);
    const arrived = strictInt(raw.toAmountCents);
    if (arrived !== null && arrived > 0) op.toAmountCents = arrived;
  }
  for (const key of OP_TEXT_FIELDS) setText(key, raw[key]);
  setText("card", typeof raw.card === "number" ? String(raw.card).padStart(4, "0") : raw.card);
  for (const key of OP_FLAGS) if (raw[key] === true) op[key] = true;
  const attachments = normAttachments(raw.attachments);
  if (attachments.length) op.attachments = attachments;
  if (isObj(raw.bank)) op.bank = { ...raw.bank };
  if (isObj(raw.meta)) op.meta = raw.meta;
  for (const key of Object.keys(raw)) {
    if (OP_HANDLED.has(key) || key === "__proto__" || key[0] === "_") continue;
    const value = raw[key];
    if (value !== null && value !== undefined) op[key] = value;
  }
  return op;
}

/**
 * Remet une opération stockée dans la forme attendue, ou renvoie null si elle est inutilisable
 * (pas d'identifiant, date invalide, montant non entier, devise absente, type inconnu, virement négatif).
 * Les champs vides ou effacés (null) sont retirés ; une opération "pl" a toujours `categoryId` (texte ou null).
 * Ne lève jamais d'exception et ne modifie pas son argument.
 * @param {*} raw
 * @returns {object|null} Op
 */
export function normalizeOp(raw) {
  try {
    return normalizeOpUnsafe(raw);
  } catch {
    return null;
  }
}

/** Vrai pour un mouvement entre deux comptes (sans effet sur le bénéfice). */
export function isTransfer(op) {
  return !!op && op.kind === "transfer";
}

/** Vrai si le mois "AAAA-MM" est clôturé. */
export function isMonthClosed(config, month) {
  const closed = config && config.closed;
  return isObj(closed) && typeof month === "string" && Object.prototype.hasOwnProperty.call(closed, month) && !!closed[month];
}

function deMois(month) {
  const label = monthLabel(month);
  return /^[aeiouyéèêâîôû]/i.test(label) ? "d'" + label : "de " + label;
}

/**
 * Contrôle une opération avant de l'enregistrer.
 * @param {object} op opération (ou brouillon sans identifiant)
 * @param {object} config configuration normalisée
 * @param {object} [previous] version déjà enregistrée, en cas de modification : son mois ne doit pas être clôturé non plus
 * @returns {string[]} problèmes en français, [] si tout est bon
 */
export function validateOp(op, config, previous) {
  if (!isObj(op)) return ["Cette opération est illisible."];
  const problems = [];
  const cfg = isObj(config) ? config : {};
  const accounts = isObj(cfg.accounts) ? cfg.accounts : {};
  const categories = isObj(cfg.categories) ? cfg.categories : {};
  const transfer = op.kind === "transfer";
  if (op.kind !== "pl" && op.kind !== "transfer") problems.push("Le type d'opération est inconnu.");

  const date = typeof op.date === "string" && isValidISO(op.date) ? op.date : null;
  if (!date) problems.push("La date est manquante ou invalide.");
  else if (isMonthClosed(cfg, monthOf(date))) {
    problems.push(`Le mois ${deMois(monthOf(date))} est clôturé : rouvre-le pour ajouter ou modifier une opération à cette date.`);
  }
  if (isObj(previous) && typeof previous.date === "string" && isValidISO(previous.date)) {
    const before = monthOf(previous.date);
    if ((!date || before !== monthOf(date)) && isMonthClosed(cfg, before)) {
      problems.push(`Cette opération appartient au mois ${deMois(before)}, qui est clôturé : rouvre-le pour la modifier.`);
    }
  }

  const currency = normCurrency(op.currency);
  if (!currency) problems.push("La devise est manquante ou invalide.");
  const amount = Number.isSafeInteger(op.amountCents) ? op.amountCents : null;
  if (amount === null) problems.push("Le montant est manquant ou invalide.");
  else if (transfer && amount <= 0) problems.push("Le montant d'un mouvement entre comptes doit être positif.");
  else if (!transfer && amount === 0) problems.push("Le montant ne peut pas être zéro.");

  if (transfer) {
    const from = op.fromAccountId;
    const to = op.toAccountId;
    if (!from) problems.push("Choisis le compte de départ.");
    else if (!own(accounts, from)) problems.push("Le compte de départ n'existe plus.");
    if (!to) problems.push("Choisis le compte d'arrivée.");
    else if (!own(accounts, to)) problems.push("Le compte d'arrivée n'existe plus.");
    if (from && to && from === to) problems.push("Le compte de départ et le compte d'arrivée doivent être différents.");
    if (op.toAmountCents !== null && op.toAmountCents !== undefined && !(Number.isSafeInteger(op.toAmountCents) && op.toAmountCents > 0)) {
      problems.push("Le montant reçu sur le compte d'arrivée doit être positif.");
    }
    return problems;
  }

  if (!op.accountId) problems.push("Choisis le compte utilisé.");
  else if (!own(accounts, op.accountId)) problems.push("Le compte choisi n'existe plus.");
  if (op.categoryId !== null && op.categoryId !== undefined && !op.splits && !own(categories, op.categoryId)) {
    problems.push("La catégorie choisie n'existe plus.");
  }
  if (op.settledCents !== null && op.settledCents !== undefined) {
    if (!Number.isSafeInteger(op.settledCents)) problems.push("Le montant débité sur le compte est invalide.");
    else if (amount !== null && amount !== 0 && Math.sign(op.settledCents) !== Math.sign(amount)) {
      problems.push("Le montant débité sur le compte doit être dans le même sens que le montant de l'opération.");
    }
  }
  if (op.splits !== null && op.splits !== undefined) {
    if (!Array.isArray(op.splits) || op.splits.length === 0) {
      problems.push("La répartition par catégorie est vide.");
    } else {
      let sum = 0;
      let badAmount = false;
      let missingCategory = false;
      for (const split of op.splits) {
        if (!isObj(split) || !Number.isSafeInteger(split.amountCents)) { badAmount = true; continue; }
        sum += split.amountCents;
        if (split.categoryId !== null && split.categoryId !== undefined && !own(categories, split.categoryId)) missingCategory = true;
      }
      if (badAmount) problems.push("Une ligne de la répartition a un montant manquant ou invalide.");
      else if (amount !== null && sum !== amount) {
        const cur = currency || "USD";
        problems.push(
          `La répartition par catégorie (${formatMoney(sum, cur)}) ne correspond pas au montant de l'opération (${formatMoney(amount, cur)}).`,
        );
      }
      if (missingCategory) problems.push("Une catégorie de la répartition n'existe plus.");
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Lectures simples de la configuration

/**
 * À qui appartient l'argent d'un compte.
 * @returns {string} "business", l'identifiant d'un associé, ou "unknown" (compte absent ou pas encore attribué)
 */
export function accountOwner(config, accountId) {
  const account = own(config && config.accounts, accountId);
  if (!account) return UNKNOWN;
  if (account.owner === BUSINESS) return BUSINESS;
  return own(config.partners, account.owner) ? account.owner : UNKNOWN;
}

function listOf(map, opts) {
  const includeArchived = !!(opts && opts.includeArchived);
  const list = [];
  if (isObj(map)) {
    for (const id of Object.keys(map)) {
      const item = map[id];
      if (isObj(item) && (includeArchived || item.archived !== true)) list.push(item);
    }
  }
  return sortEntities(list);
}

/**
 * Associés triés par ordre puis par nom.
 * @param {object} config
 * @param {{ includeArchived?: boolean }} [opts]
 */
export function listPartners(config, opts) {
  return listOf(config && config.partners, opts);
}

/**
 * Comptes triés par ordre puis par nom.
 * @param {object} config
 * @param {{ includeArchived?: boolean, owner?: string }} [opts] owner : ne garder que les comptes de ce propriétaire
 */
export function listAccounts(config, opts) {
  const list = listOf(config && config.accounts, opts);
  if (opts && opts.owner) return list.filter((a) => accountOwner(config, a.id) === opts.owner);
  return list;
}

/**
 * Catégories triées par ordre puis par nom.
 * @param {object} config
 * @param {{ includeArchived?: boolean, kind?: "income"|"expense", group?: string }} [opts]
 */
export function listCategories(config, opts) {
  let list = listOf(config && config.categories, opts);
  if (opts && opts.kind) list = list.filter((c) => c.kind === opts.kind);
  if (opts && opts.group) list = list.filter((c) => c.group === opts.group);
  return list;
}

/** Compte débité par une carte (4 derniers chiffres), ou null. Les comptes actifs passent avant les archivés. */
export function accountForCard(config, last4) {
  const digits = toStr(last4).replace(/\D/g, "");
  if (!digits) return null;
  const wanted = digits.slice(-4).padStart(4, "0");
  const all = listOf(config && config.accounts, { includeArchived: true });
  const match = (a) => Array.isArray(a.cards) && a.cards.includes(wanted);
  const found = all.find((a) => !a.archived && match(a)) || all.find(match);
  return found ? found.id : null;
}

/** Libellé d'une catégorie, sûr même si elle manque ("Non classée", "Catégorie supprimée"). */
export function categoryLabel(config, id) {
  if (id === null || id === undefined || id === "" || id === UNCATEGORIZED) return "Non classée";
  const category = own(config && config.categories, id);
  return category && category.name ? category.name : "Catégorie supprimée";
}

/** Libellé d'un compte, sûr même s'il manque ("Compte supprimé"). */
export function accountLabel(config, id) {
  if (id === null || id === undefined || id === "") return "Aucun compte";
  const account = own(config && config.accounts, id);
  return account && account.name ? account.name : "Compte supprimé";
}

/** Libellé d'un associé ou d'un propriétaire de compte : "L'entreprise", "À attribuer", "Associé supprimé". */
export function partnerLabel(config, id) {
  if (id === BUSINESS) return "L'entreprise";
  if (id === UNKNOWN || id === null || id === undefined || id === "") return "À attribuer";
  const partner = own(config && config.partners, id);
  return partner && partner.name ? partner.name : "Associé supprimé";
}

/** Libellé d'un groupe de catégories ("Non classé" pour le pseudo groupe des opérations non classées). */
export function groupLabel(id) {
  const group = GROUPS.find((g) => g.id === id);
  return group ? group.label : "Non classé";
}

/** Libellé de l'origine d'une opération. */
export function sourceLabel(source) {
  return typeof source === "string" && Object.prototype.hasOwnProperty.call(SOURCES, source) ? SOURCES[source] : "Autre origine";
}

// ---------------------------------------------------------------------------------------------
// Partage du bénéfice : les parts changent dans le temps (règle en vigueur à la date de chaque opération).

/**
 * Règles de partage triées par date de début (null = depuis le début, en premier).
 * @returns {Array<{ id: string, from: string|null, shares: Object<string, number> }>}
 */
export function listShareRules(config) {
  const rules = [];
  for (const [id, r] of entriesOf(config && config.shareRules)) {
    rules.push({ id, from: normDate(r.from), shares: normShares(r.shares) });
  }
  return rules.sort((a, b) => compareText(a.from || "", b.from || "") || compareText(a.id, b.id));
}

function countSharers(shares) {
  let n = 0;
  for (const id of Object.keys(shares)) if (shares[id] > 0) n++;
  return n;
}

/**
 * Périodes de partage du bénéfice, consécutives et sans trou, de la plus ancienne à la plus récente.
 * Chaque règle ouvre une période qui dure jusqu'à la veille de la règle suivante. La première période
 * couvre aussi tout ce qui précède sa règle (`from` vaut null), la dernière n'a pas de fin (`to` vaut null).
 * Sans aucune règle : une seule période, avec les parts `sharePct` des associés actifs, ou des parts égales
 * entre associés actifs si aucune part n'est renseignée (`equal: true`).
 * @param {object} config
 * @returns {Array<{ index: number, ruleId: string|null, from: string|null, to: string|null, startsOn: string|null,
 *   shares: Object<string, number>, sharesTotal: number, equal: boolean, partnerCount: number }>}
 *   `from` et `to` sont utilisables tels quels comme filtre de période ; `startsOn` est la date à afficher
 *   comme début (date de la règle, sinon date de lancement de l'entreprise, sinon null).
 */
export function shareTimeline(config) {
  const cfg = isObj(config) ? config : {};
  const startDate = isObj(cfg.business) ? normDate(cfg.business.startDate) : null;
  const kept = [];
  for (const rule of listShareRules(cfg)) {
    // Deux règles à la même date : la plus récente (identifiant le plus grand) remplace l'autre.
    if (kept.length && (kept[kept.length - 1].from || "") === (rule.from || "")) kept[kept.length - 1] = rule;
    else kept.push(rule);
  }

  if (!kept.length) {
    const active = listPartners(cfg);
    const shares = {};
    let equal = false;
    let total = 0;
    for (const p of active) if (typeof p.sharePct === "number" && p.sharePct > 0) total += p.sharePct;
    if (total > 0) {
      for (const p of active) shares[p.id] = typeof p.sharePct === "number" && p.sharePct > 0 ? p.sharePct : 0;
    } else if (active.length) {
      equal = true;
      for (const p of active) shares[p.id] = 100 / active.length;
      total = 100;
    }
    return [{
      index: 0, ruleId: null, from: null, to: null, startsOn: startDate,
      shares, sharesTotal: round4(total), equal, partnerCount: countSharers(shares),
    }];
  }

  return kept.map((rule, index) => {
    const next = kept[index + 1];
    const to = next ? addDays(next.from, -1) : null;
    let startsOn = rule.from;
    if (index === 0 && !startsOn && startDate && (!to || startDate <= to)) startsOn = startDate;
    let total = 0;
    for (const id of Object.keys(rule.shares)) total += rule.shares[id];
    return {
      index,
      ruleId: rule.id,
      from: index === 0 ? null : rule.from,
      to,
      startsOn,
      shares: { ...rule.shares },
      sharesTotal: round4(total),
      equal: false,
      partnerCount: countSharers(rule.shares),
    };
  });
}

/**
 * Parts en vigueur à une date donnée : la période de `shareTimeline` qui contient la date.
 * @param {object} config
 * @param {string} date "AAAA-MM-JJ"
 */
export function sharesOn(config, date) {
  const timeline = shareTimeline(config);
  for (let i = timeline.length - 1; i > 0; i--) {
    if (typeof date === "string" && date >= timeline[i].from) return timeline[i];
  }
  return timeline[0];
}
