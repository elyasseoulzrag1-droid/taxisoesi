// Doublons et rapprochement bancaire. Logique pure : aucune écriture, aucun accès à la plateforme.
//
// Deux questions distinctes :
// - "ce brouillon existe-t-il déjà ?" (findDuplicate) : même identifiant externe, ou même compte, même montant, même jour à un jour près ;
// - "cette ligne de relevé correspond-elle à une opération déjà saisie ?" (matchBankLines) : dans ce cas l'opération
//   existante est pointée (applyBankMatch) et la ligne de relevé ne crée rien.
// Dans l'autre sens (relevé importé d'abord, détail ensuite), completeBankOp complète l'opération créée par le relevé.
import { daysBetween, isValidISO } from "./dates.js";
import { convert } from "./fx.js";
import { normalizeOp } from "./model.js";

/** Une ligne de relevé peut arriver jusqu'à 4 jours après la date de l'opération (délai de débit de la carte, virement). */
export const RECON_DAYS_AFTER = 4;
/** ... ou jusqu'à 2 jours avant (reçu daté après le paiement, fuseau horaire). */
export const RECON_DAYS_BEFORE = 2;
/** Écart toléré, en pour cent, entre le montant du relevé et un montant converti au taux du mois. */
export const RECON_TOLERANCE_PCT = 4;
/** Deux opérations de même montant sur le même compte sont des doublons probables jusqu'à un jour d'écart. */
export const DUPLICATE_DAYS = 1;

const NO_ACCOUNT = "";
const EMPTY = Object.freeze([]);
const bookIndexes = new WeakMap();

function isObj(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fold(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Identifiants des lignes de relevé déjà rattachées à l'opération (un mouvement entre comptes peut en porter deux).
function bankExtIds(op) {
  const out = [];
  const bank = op && op.bank;
  if (!isObj(bank)) return out;
  if (typeof bank.extId === "string" && bank.extId) out.push(bank.extId);
  if (isObj(bank.other) && typeof bank.other.extId === "string" && bank.other.extId) out.push(bank.other.extId);
  return out;
}

// Index du livre, construit une seule fois par livre (un livre ne change jamais après buildBook).
function indexOf(book) {
  if (!isObj(book)) return { byExtId: new Map(), byAccount: new Map() };
  let index = bookIndexes.get(book);
  if (index) return index;
  const byExtId = new Map();
  const byAccount = new Map();
  const add = (accountId, op) => {
    const key = accountId || NO_ACCOUNT;
    let list = byAccount.get(key);
    if (!list) { list = []; byAccount.set(key, list); }
    list.push(op);
  };
  for (const op of Array.isArray(book.ops) ? book.ops : []) {
    if (!isObj(op) || !op.id) continue;
    if (typeof op.extId === "string" && op.extId && !byExtId.has(op.extId)) byExtId.set(op.extId, op.id);
    for (const id of bankExtIds(op)) if (!byExtId.has(id)) byExtId.set(id, op.id);
    if (op.kind === "transfer") {
      add(op.fromAccountId, op);
      if (op.toAccountId !== op.fromAccountId) add(op.toAccountId, op);
    } else {
      add(op.accountId, op);
    }
  }
  index = { byExtId, byAccount };
  bookIndexes.set(book, index);
  return index;
}

function usableDate(value) {
  return typeof value === "string" && isValidISO(value);
}

function accountCurrency(book, config, accountId) {
  if (!accountId) return null;
  const state = isObj(book) && isObj(book.accounts) ? book.accounts[accountId] : null;
  if (isObj(state) && typeof state.currency === "string" && state.currency) return state.currency;
  const cfg = config || (isObj(book) ? book.config : null);
  const account = isObj(cfg) && isObj(cfg.accounts) ? cfg.accounts[accountId] : null;
  return isObj(account) && typeof account.currency === "string" && account.currency ? account.currency : null;
}

/* ------------------------------------------------------------------ doublons */

// Opération créée à partir d'une ligne de relevé (son identifiant externe commence par "bank:").
function fromBankLine(op) {
  return typeof op.extId === "string" && op.extId.startsWith("bank:");
}

/**
 * Cherche si un brouillon existe déjà dans le livre.
 * - Doublon certain : même identifiant externe (`extId`), y compris celui d'une ligne de relevé déjà pointée sur une opération.
 * - Doublon probable : même type, même compte, même montant signé, même devise, dates à un jour près.
 *   Un mouvement entre comptes est comparé sur ses deux comptes.
 * - Cas miroir du rapprochement : le brouillon ne vient pas d'un relevé (virement Shopify, reçu) et le livre contient
 *   déjà la ligne de relevé de même montant sur le même compte, datée de 2 jours avant à 4 jours après : doublon probable
 *   (completeBankOp sert alors à compléter l'opération du relevé au lieu d'en créer une seconde).
 * - Les opérations listées dans `draft._matchedOps` (déjà pointées par une autre ligne du même relevé) ne comptent pas.
 * @param {object} draft brouillon d'opération (kind, date, accountId, amountCents, currency, extId...)
 * @param {object} book livre calculé par buildBook
 * @returns {{ opId: string, exact: boolean } | null}
 */
export function findDuplicate(draft, book) {
  if (!isObj(draft) || !isObj(book)) return null;
  const index = indexOf(book);
  const selfId = draft.id || null;

  if (typeof draft.extId === "string" && draft.extId) {
    const hit = index.byExtId.get(draft.extId);
    if (hit && hit !== selfId) return { opId: hit, exact: true };
  }

  if (!usableDate(draft.date) || !Number.isInteger(draft.amountCents)) return null;
  const transfer = draft.kind === "transfer" || (draft.kind == null && (draft.fromAccountId != null || draft.toAccountId != null));
  const accountId = transfer ? draft.fromAccountId : draft.accountId;
  const candidates = index.byAccount.get(accountId || NO_ACCOUNT) || EMPTY;
  const draftFromBank = typeof draft.extId === "string" && draft.extId.startsWith("bank:");
  // Opérations déjà pointées par une autre ligne du même relevé (voir attachMatches) : elles ne sont plus disponibles.
  const taken = Array.isArray(draft._matchedOps) ? draft._matchedOps : EMPTY;

  let best = null;
  let bestGap = Infinity;
  for (const op of candidates) {
    if (op.amountCents !== draft.amountCents || op.currency !== draft.currency) continue;
    if (op.id === selfId || !usableDate(op.date)) continue;
    if (transfer) {
      if (op.kind !== "transfer") continue;
      if ((op.fromAccountId || NO_ACCOUNT) !== (draft.fromAccountId || NO_ACCOUNT)) continue;
      if ((op.toAccountId || NO_ACCOUNT) !== (draft.toAccountId || NO_ACCOUNT)) continue;
    } else if (op.kind !== "pl") {
      continue;
    }
    const signed = daysBetween(draft.date, op.date);
    const gap = Math.abs(signed);
    if (gap > DUPLICATE_DAYS) {
      // L'opération du livre est une ligne de relevé : elle peut suivre le brouillon de quelques jours.
      const mirrored = !transfer && !draftFromBank && fromBankLine(op) && signed <= RECON_DAYS_AFTER && signed >= -RECON_DAYS_BEFORE;
      if (!mirrored) continue;
    }
    if (taken.length && taken.includes(op.id)) continue;
    if (gap < bestGap || (gap === bestGap && best && op.id < best.id)) { best = op; bestGap = gap; }
  }
  return best ? { opId: best.id, exact: false } : null;
}

/* ------------------------------------------------------------------ rapprochement */

function sameSign(a, b) {
  return a !== 0 && b !== 0 && (a < 0) === (b < 0);
}

// Montant dans la devise du compte : exact si la devise est celle du compte ou si le montant débité est connu, sinon estimé.
function inAccountCurrency(cents, currency, settled, target, date, config) {
  if (currency === target) return { cents, exact: true };
  if (Number.isInteger(settled) && sameSign(settled, cents)) return { cents: settled, exact: true };
  return { cents: convert(cents, currency, target, date, config).cents, exact: false };
}

// Côté d'une opération vu depuis un compte : montant signé dans sa devise d'origine, ou null si elle ne peut pas être pointée.
function sideFor(op, accountId, accountCur) {
  if (!usableDate(op.date) || !Number.isInteger(op.amountCents) || op.amountCents === 0) return null;
  if (op.kind === "transfer") {
    if (op.fromAccountId === op.toAccountId) return null;
    const name = op.fromAccountId === accountId ? "from" : op.toAccountId === accountId ? "to" : null;
    if (!name) return null;
    if (op.reconciled) {
      // Déjà pointée sur le relevé de l'autre compte : ce côté-ci reste à pointer une fois.
      const bank = isObj(op.bank) ? op.bank : null;
      if (!bank || !bank.side || bank.side === name || bank.other) return null;
    }
    if (name === "from") return { name, cents: 0 - op.amountCents, currency: op.currency, settled: null };
    if (Number.isInteger(op.toAmountCents) && op.toAmountCents > 0) {
      return { name, cents: op.toAmountCents, currency: accountCur || op.currency, settled: null };
    }
    return { name, cents: op.amountCents, currency: op.currency, settled: null };
  }
  if (op.kind !== "pl" || op.accountId !== accountId || op.reconciled) return null;
  return { name: "pl", cents: op.amountCents, currency: op.currency, settled: op.settledCents };
}

function dayNumber(iso) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
}

// Opérations d'un compte qui peuvent encore être pointées, rangées par jour (calculé une fois par livre et par compte).
function candidatesByDay(index, accountId, accountCur) {
  if (!index.byDay) index.byDay = new Map();
  let byDay = index.byDay.get(accountId);
  if (byDay) return byDay;
  byDay = new Map();
  for (const op of index.byAccount.get(accountId) || EMPTY) {
    const side = sideFor(op, accountId, accountCur);
    if (!side) continue;
    const day = dayNumber(op.date);
    const list = byDay.get(day);
    if (list) list.push({ op, side });
    else byDay.set(day, [{ op, side }]);
  }
  index.byDay.set(accountId, byDay);
  return byDay;
}

function compareAmounts(line, side, accountCur, config, opDate) {
  if (!sameSign(line.amountCents, side.cents)) return null;
  const lineCur = line.currency || accountCur || side.currency;
  // Même devise des deux côtés : aucun taux de change en jeu, les montants doivent être identiques.
  if (lineCur === side.currency) return line.amountCents === side.cents ? { exact: true, diff: 0 } : null;
  const target = accountCur || lineCur;
  const a = inAccountCurrency(line.amountCents, lineCur, line.settledCents, target, line.date, config);
  const b = inAccountCurrency(side.cents, side.currency, side.settled, target, opDate, config);
  if (!sameSign(a.cents, b.cents)) return null;
  const diff = Math.abs(a.cents - b.cents);
  if (a.exact && b.exact) return diff === 0 ? { exact: true, diff: 0 } : null;
  const estimate = Math.abs(b.exact ? a.cents : b.cents);
  return diff * 100 <= RECON_TOLERANCE_PCT * estimate ? { exact: false, diff } : null;
}

function opCategories(op) {
  if (Array.isArray(op.splits) && op.splits.length) return op.splits.map((s) => s && s.categoryId).filter(Boolean);
  return op.categoryId ? [op.categoryId] : [];
}

// Indices qui départagent deux candidats de même montant : même tiers (2), même catégorie (1).
function affinity(line, op) {
  const lineParty = fold(line.party);
  const opParty = fold(op.party);
  if (lineParty && opParty && (lineParty === opParty || lineParty.includes(opParty) || opParty.includes(lineParty))) return 2;
  if (line.categoryId && opCategories(op).includes(line.categoryId)) return 1;
  return 0;
}

/**
 * Rapproche des lignes de relevé avec les opérations non pointées d'un compte.
 * Une ligne correspond à une opération quand : même compte, même sens, date du relevé entre 2 jours avant et 4 jours après
 * la date de l'opération, et même montant dans la devise du compte (exact si l'opération est dans la devise du compte ou
 * si son montant débité est connu ; sinon à 4 % près du montant converti au taux du mois).
 * Chaque ligne pointe au plus une opération et inversement. À choisir entre plusieurs candidats : montant exact d'abord,
 * puis même tiers ou même catégorie, puis le plus petit écart de date.
 * Un mouvement entre comptes peut être pointé une fois sur chacun de ses deux comptes.
 * @param {Array<{ date: string, amountCents: number, currency?: string, settledCents?: number, party?: string, categoryId?: string, accountId?: string }>} lines
 *   lignes de relevé (les brouillons de l'import conviennent) ; amountCents signé, settledCents = montant dans la devise du compte
 * @param {object} book livre calculé par buildBook
 * @param {string} accountId compte du relevé (à défaut, le compte porté par chaque ligne)
 * @returns {Map<number, string>} rang de la ligne -> identifiant de l'opération
 */
export function matchBankLines(lines, book, accountId) {
  const matches = new Map();
  if (!Array.isArray(lines) || !isObj(book)) return matches;
  const index = indexOf(book);
  const config = isObj(book.config) ? book.config : null;
  const pairs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isObj(line) || !usableDate(line.date) || !Number.isInteger(line.amountCents) || line.amountCents === 0) continue;
    const account = accountId || line.accountId;
    if (!account) continue;
    const accountCur = accountCurrency(book, config, account);
    const byDay = candidatesByDay(index, account, accountCur);
    const lineDay = dayNumber(line.date);
    // gap = jours entre l'opération et la ligne du relevé (positif : le relevé vient après).
    for (let gap = -RECON_DAYS_BEFORE; gap <= RECON_DAYS_AFTER; gap++) {
      for (const { op, side } of byDay.get(lineDay - gap) || EMPTY) {
        const amounts = compareAmounts(line, side, accountCur, config, op.date);
        if (!amounts) continue;
        pairs.push({ i, op, gap, exact: amounts.exact, diff: amounts.diff, affinity: affinity(line, op) });
      }
    }
  }

  pairs.sort((a, b) =>
    Number(b.exact) - Number(a.exact) ||
    b.affinity - a.affinity ||
    Math.abs(a.gap) - Math.abs(b.gap) ||
    a.diff - b.diff ||
    Number(a.gap < 0) - Number(b.gap < 0) ||
    a.i - b.i ||
    (a.op.date < b.op.date ? -1 : a.op.date > b.op.date ? 1 : 0) ||
    (a.op.id < b.op.id ? -1 : a.op.id > b.op.id ? 1 : 0));

  const usedOps = new Set();
  for (const pair of pairs) {
    if (matches.has(pair.i) || usedOps.has(pair.op.id)) continue;
    matches.set(pair.i, pair.op.id);
    usedOps.add(pair.op.id);
  }
  return matches;
}

function bankInfo(line) {
  const own = isObj(line.bank) ? line.bank : {};
  const info = {
    date: usableDate(own.date) ? own.date : line.date,
    label: String(own.label || line.label || "").trim(),
  };
  if (typeof line.extId === "string" && line.extId) info.extId = line.extId;
  return info;
}

// Montant de la ligne dans la devise du compte, quand il est connu avec certitude.
function lineAccountCents(line, accountCur) {
  if (Number.isInteger(line.settledCents) && line.settledCents !== 0) return line.settledCents;
  if (!line.currency || !accountCur || line.currency === accountCur) return line.amountCents;
  return null;
}

/**
 * Pointe une opération avec la ligne de relevé qui lui correspond. Renvoie une nouvelle opération (l'originale n'est pas modifiée) :
 * `reconciled: true`, `bank: { date, label, extId }` (extId = identifiant de la ligne, pour la reconnaître à un prochain import)
 * et, quand l'opération est dans une autre devise que le compte, `settledCents` = le montant réellement débité ou crédité.
 * Pour un mouvement entre comptes : le côté pointé est noté dans `bank.side` ("from" ou "to"), le second relevé va dans
 * `bank.other`, et `toAmountCents` reçoit le montant arrivé quand le compte d'arrivée est dans une autre devise.
 * @param {object} op opération du livre (les champs calculés par buildBook sont retirés)
 * @param {object} line ligne de relevé ou brouillon : { date, label, amountCents, currency?, settledCents?, extId?, bank?, card?, accountId? }
 * @param {object} config configuration (devise des comptes)
 * @returns {object} opération mise à jour
 */
export function applyBankMatch(op, line, config) {
  const updated = normalizeOp(op) || (isObj(op) ? { ...op } : {});
  if (!isObj(line)) return updated;
  const info = bankInfo(line);
  const amount = Number.isInteger(line.amountCents) ? line.amountCents : 0;

  if (updated.kind === "transfer") {
    let side = amount < 0 ? "from" : "to";
    if (line.accountId && line.accountId === updated.fromAccountId) side = "from";
    else if (line.accountId && line.accountId === updated.toAccountId) side = "to";
    const previous = isObj(updated.bank) ? updated.bank : null;
    if (updated.reconciled && previous && previous.side && previous.side !== side) {
      updated.bank = { ...previous, other: { ...info, side } };
    } else {
      updated.bank = { ...info, side };
    }
    updated.reconciled = true;
    if (side === "to") {
      const accountCur = accountCurrency(null, config, updated.toAccountId) || line.currency;
      const arrived = lineAccountCents(line, accountCur);
      if (accountCur && updated.currency !== accountCur && Number.isInteger(arrived) && arrived > 0) updated.toAmountCents = arrived;
    }
    return updated;
  }

  updated.reconciled = true;
  updated.bank = info;
  const accountCur = accountCurrency(null, config, updated.accountId) || line.currency || null;
  if (accountCur && updated.currency !== accountCur) {
    const settled = lineAccountCents(line, accountCur);
    if (Number.isInteger(settled) && sameSign(settled, updated.amountCents)) updated.settledCents = settled;
  }
  if (!updated.card && typeof line.card === "string" && /^\d{4}$/.test(line.card)) updated.card = line.card;
  return updated;
}

/**
 * Repère, parmi les brouillons d'un relevé, ceux qui correspondent à une opération déjà saisie.
 * Un brouillon rapproché reçoit `_matchOf` (identifiant de l'opération) et reste coché : à l'enregistrement, l'opération
 * existante est pointée (applyBankMatch) et aucune nouvelle opération n'est créée.
 * Un brouillon dont l'identifiant externe est déjà dans le livre n'est jamais rapproché : c'est un doublon (déjà importé).
 * Un brouillon rapproché n'est jamais signalé comme doublon (`_dupOf` remis à null). Un brouillon non rapproché qui ressemble à
 * une opération pointée par une autre ligne reçoit `_matchedOps` (les opérations déjà prises), que findDuplicate laisse de côté.
 * @param {object[]} drafts brouillons de l'import
 * @param {object} book livre calculé par buildBook (sans livre, les brouillons sont renvoyés tels quels)
 * @param {string} accountId compte du relevé
 * @returns {object[]} nouveaux brouillons, dans le même ordre
 */
export function attachMatches(drafts, book, accountId) {
  if (!Array.isArray(drafts)) return [];
  if (!isObj(book)) return drafts.slice();
  const index = indexOf(book);
  const positions = [];
  const lines = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!isObj(draft)) continue;
    if (draft.kind != null && draft.kind !== "pl") continue;
    if (typeof draft.extId === "string" && draft.extId && index.byExtId.has(draft.extId)) continue;
    positions.push(i);
    lines.push(draft);
  }
  const found = matchBankLines(lines, book, accountId);
  const byDraft = new Map();
  for (const [k, opId] of found) byDraft.set(positions[k], opId);
  const claimedSet = new Set(found.values());
  const claimed = Array.from(claimedSet);
  return drafts.map((draft, i) => {
    if (!isObj(draft)) return draft;
    const opId = byDraft.get(i);
    if (opId) return { ...draft, _matchOf: opId, _selected: true, _dupOf: null, _dupExact: false };
    let out = draft._matchOf ? { ...draft, _matchOf: null } : draft;
    // Deux lignes identiques pour une seule opération saisie : la seconde ligne est un autre mouvement, pas un doublon de l'opération
    // que la première vient de pointer.
    if (claimed.length) {
      const dup = findDuplicate(out, book);
      if (dup && !dup.exact && claimedSet.has(dup.opId)) out = { ...out, _matchedOps: claimed };
    }
    return out;
  });
}

/**
 * Cas inverse de applyBankMatch : la ligne de relevé est déjà une opération du livre (créée par un import de relevé) et le
 * détail arrive ensuite, par exemple le virement Shopify avec ses ventes, ses remboursements et ses frais, ou un reçu scanné
 * (findDuplicate le signale alors comme doublon probable). Plutôt que de créer une seconde opération, on complète celle du relevé.
 * Renvoie une nouvelle opération : date, libellé, tiers, référence, catégorie ou ventilation, source, identifiant externe et
 * détails du brouillon ; le relevé reste dans `bank` (avec l'identifiant de la ligne, pour la reconnaître à un prochain import)
 * et l'opération reste pointée. Si le brouillon est dans une autre devise que la ligne de relevé, son montant devient le montant
 * de l'opération et celui du relevé devient `settledCents`. Une ventilation n'est reprise que si elle tombe juste.
 * @param {object} op opération du livre issue d'un relevé
 * @param {object} draft brouillon plus détaillé du même mouvement
 * @returns {object} opération complétée
 */
export function completeBankOp(op, draft) {
  const base = normalizeOp(op) || (isObj(op) ? { ...op } : {});
  if (!isObj(draft) || base.kind !== "pl" || (draft.kind != null && draft.kind !== "pl")) return base;
  const out = { ...base };
  const bank = isObj(base.bank) ? { ...base.bank } : { date: base.date, label: base.label };
  if (!bank.extId && fromBankLine(base)) bank.extId = base.extId;
  out.bank = bank;
  out.reconciled = true;

  if (usableDate(draft.date)) out.date = draft.date;
  for (const key of ["label", "party", "ref", "note", "source", "extId", "card"]) {
    if (typeof draft[key] === "string" && draft[key].trim()) out[key] = draft[key].trim();
  }
  if (isObj(draft.meta)) out.meta = { ...(isObj(base.meta) ? base.meta : {}), ...draft.meta };
  if (Array.isArray(draft.attachments) && draft.attachments.length) {
    const known = new Set((base.attachments || []).map((a) => a && a.id));
    out.attachments = [...(base.attachments || []), ...draft.attachments.filter((a) => isObj(a) && a.id && !known.has(a.id))];
  }

  // Montant : le relevé fait foi pour le compte ; un reçu dans une autre devise garde son montant d'origine.
  const sameCurrency = !draft.currency || draft.currency === base.currency;
  if (!sameCurrency && Number.isInteger(draft.amountCents) && sameSign(draft.amountCents, base.amountCents) && !Number.isInteger(base.settledCents)) {
    out.settledCents = base.amountCents;
    out.amountCents = draft.amountCents;
    out.currency = draft.currency;
  }
  const splits = Array.isArray(draft.splits) && draft.splits.length ? draft.splits : null;
  const splitsFit = splits && splits.every((s) => isObj(s) && Number.isInteger(s.amountCents)) &&
    splits.reduce((sum, s) => sum + s.amountCents, 0) === out.amountCents;
  if (splitsFit) {
    out.splits = splits.map((s) => ({ categoryId: s.categoryId || null, amountCents: s.amountCents }));
    out.categoryId = typeof draft.categoryId === "string" && draft.categoryId ? draft.categoryId : null;
  } else if (typeof draft.categoryId === "string" && draft.categoryId) {
    out.categoryId = draft.categoryId;
    delete out.splits;
  }
  delete out.estimated;
  if (draft.needsReview === true || (!out.splits && !out.categoryId)) out.needsReview = true;
  else delete out.needsReview;
  return out;
}
