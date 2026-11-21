// Le livre de comptes : à partir des réglages et des opérations stockées, calcule tout ce que l'appli affiche.
// Bénéfice (comptabilité de trésorerie), soldes des comptes, comptes d'associés, partage du bénéfice.
// Logique pure : aucune date du jour, aucun accès plateforme, mêmes entrées = mêmes sorties.
import {
  normalizeConfig, normalizeOp, accountOwner, listPartners, listAccounts, shareTimeline,
  categoryLabel, accountLabel, AD_PLATFORMS, BUSINESS, UNKNOWN, UNCATEGORIZED,
} from "./model.js";
import { createFx } from "./fx.js";
import { pct, centsToInput } from "./money.js";
import { isValidISO, addDays, addMonths, monthStart, monthEnd } from "./dates.js";

/** Date fictive très lointaine : donne le taux de change le plus récent connu. */
const LATEST = "9999-12-31";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PLATFORM_BY_CATEGORY = Object.fromEntries(AD_PLATFORMS.map((p) => [p.categoryId, p.id]));
const PLATFORM_IDS = AD_PLATFORMS.map((p) => p.id);
const SHARE_UNITS = 10000; // les parts sont lues au dix-millième de point

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Arrondi symétrique (les moitiés s'éloignent de zéro), sans jamais produire -0. */
function roundSym(value) {
  if (!Number.isFinite(value)) return 0;
  const r = Math.round(Math.abs(value));
  if (r === 0) return 0;
  return value < 0 ? 0 - r : r;
}

function compareOpsDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca !== cb) return ca < cb ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function newPosition(id) {
  return {
    id,
    netCents: 0,
    advancedCents: 0,
    collectedCents: 0,
    contributedCents: 0,
    withdrawnCents: 0,
    settledCents: 0,
    profitShareCents: 0,
    equityCents: 0,
    sharePct: 0,
    entries: [],
  };
}

/**
 * Répartit un montant entre associés selon leurs parts, par la méthode du plus fort reste : chacun reçoit
 * la partie entière de sa quote-part, puis les centimes restants vont aux plus grands restes (à égalité : la plus
 * grosse part, puis l'ordre donné). Une perte (montant négatif) se répartit comme un bénéfice, avec le signe moins.
 * Quand les parts font 100 %, la somme des montants est exactement le montant de départ ; sinon elle vaut
 * le montant multiplié par le total des parts (arrondi au centime).
 * @param {number} totalCents montant entier à répartir (bénéfice ou perte)
 * @param {Object<string, number>} shares parts en pourcentage par associé
 * @param {{ equal?: boolean, order?: string[] }} [opts] equal : parts strictement égales (1/n chacun) ;
 *   order : ordre des associés pour départager les égalités
 * @returns {Object<string, number>} centimes par associé
 */
export function allocateByShares(totalCents, shares, opts = {}) {
  const out = {};
  const source = shares && typeof shares === "object" ? shares : {};
  const order = Array.isArray(opts.order) ? opts.order : [];
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const ids = Object.keys(source)
    .filter((id) => typeof source[id] === "number" && Number.isFinite(source[id]) && source[id] >= 0)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  if (!ids.length) return out;
  const total = Number.isFinite(totalCents) ? Math.round(totalCents) : 0;
  const negative = total < 0;
  const abs = BigInt(Math.abs(total));
  const equal = opts.equal === true;
  const denom = equal ? BigInt(ids.length) : BigInt(100 * SHARE_UNITS);
  let weightSum = 0n;
  let floorSum = 0n;
  const parts = ids.map((id, index) => {
    const weight = equal ? 1n : BigInt(Math.round(source[id] * SHARE_UNITS));
    const product = abs * weight;
    const floor = product / denom;
    weightSum += weight;
    floorSum += floor;
    return { id, index, weight, floor, rest: product % denom };
  });
  // Cible : le montant réellement attribué (tout le montant quand les parts font 100 %).
  const targetProduct = abs * weightSum;
  let target = targetProduct / denom;
  if ((targetProduct % denom) * 2n >= denom) target += 1n;
  let left = target - floorSum;
  const byRest = parts.slice().sort((a, b) => {
    if (a.rest !== b.rest) return a.rest > b.rest ? -1 : 1;
    if (a.weight !== b.weight) return a.weight > b.weight ? -1 : 1;
    return a.index - b.index;
  });
  for (let i = 0; left > 0n && i < byRest.length; i++) {
    byRest[i].floor += 1n;
    left -= 1n;
  }
  for (const part of parts) {
    const cents = Number(part.floor);
    out[part.id] = cents === 0 ? 0 : negative ? 0 - cents : cents;
  }
  return out;
}

/**
 * Construit le livre à partir des réglages et des opérations brutes (telles que stockées).
 * Les opérations illisibles sont ignorées (comptées dans `checks.skippedOps`), un compte ou une catégorie
 * manquants sont tolérés (propriétaire "unknown", ligne non classée). La configuration est normalisée ici :
 * `book.config` est la version normalisée. Rien de ce qui est passé en argument n'est modifié.
 * @param {object} config configuration (normalisée ou non)
 * @param {object[]} ops opérations brutes
 * @returns {object} Book (voir la référence d'API)
 */
export function buildBook(config, ops) {
  const cfg = normalizeConfig(config);
  const base = cfg.business.baseCurrency;
  const fx = createFx(cfg);
  const categories = new Map(Object.entries(cfg.categories));
  const timeline = shareTimeline(cfg);
  const periodStarts = timeline.map((p) => p.from);
  const lastPeriod = timeline.length - 1;
  const periodIndex = (date) => {
    for (let i = lastPeriod; i > 0; i--) if (date >= periodStarts[i]) return i;
    return 0;
  };

  // Comptes connus, puis comptes absents des réglages créés à la volée (propriétaire inconnu).
  const accounts = new Map();
  for (const id of Object.keys(cfg.accounts)) {
    const a = cfg.accounts[id];
    const owner = accountOwner(cfg, id);
    const opening = owner === BUSINESS ? a.openingCents : 0;
    accounts.set(id, {
      id, owner, currency: a.currency, openingCents: opening, balanceCents: opening,
      baseFlowCents: 0, approx: false, opCount: 0, missing: false,
    });
  }
  const missingAccountIds = [];
  const accountState = (id, currency) => {
    let acc = accounts.get(id);
    if (!acc) {
      acc = { id, owner: UNKNOWN, currency, openingCents: 0, balanceCents: 0, baseFlowCents: 0, approx: false, opCount: 0, missing: true };
      accounts.set(id, acc);
      missingAccountIds.push(id);
    }
    return acc;
  };

  const positions = new Map();
  const partnerOrder = listPartners(cfg, { includeArchived: true }).map((p) => p.id);
  for (const id of partnerOrder) positions.set(id, newPosition(id));
  const position = (id) => {
    let pos = positions.get(id);
    if (!pos) {
      pos = newPosition(id);
      positions.set(id, pos);
    }
    return pos;
  };

  // 1. Lecture : on écarte ce qui est inutilisable, une seule version par identifiant (la plus récente).
  const unique = new Map();
  let skippedOps = 0;
  const stamp = (op) => op.updatedAt || op.createdAt || "";
  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = normalizeOp(raw);
    if (!op) { skippedOps++; continue; }
    const seen = unique.get(op.id);
    if (!seen || stamp(seen) <= stamp(op)) unique.set(op.id, op);
  }
  const list = Array.from(unique.values()).sort(compareOpsDesc);

  const resolveLine = (categoryId, baseCents, amountCents) => {
    const category = categoryId ? categories.get(categoryId) : null;
    if (category) return { categoryId, baseCents, amountCents, group: category.group, kind: category.kind };
    return { categoryId: UNCATEGORIZED, baseCents, amountCents, group: UNCATEGORIZED, kind: baseCents < 0 ? "expense" : "income" };
  };

  const buildLines = (op, baseCents) => {
    if (!op.splits) return [resolveLine(op.categoryId, baseCents, op.amountCents)];
    const parts = [];
    let sum = 0;
    for (const split of op.splits) {
      parts.push(split);
      sum += split.amountCents;
    }
    // Répartition incomplète : l'écart reste visible dans une ligne non classée.
    if (sum !== op.amountCents) parts.push({ categoryId: null, amountCents: op.amountCents - sum });
    const scaled = [];
    let total = 0;
    let largest = 0;
    for (let i = 0; i < parts.length; i++) {
      const native = parts[i].amountCents;
      let value;
      if (op.currency === base) value = native;
      else if (op.amountCents !== 0) value = roundSym((native * baseCents) / op.amountCents);
      else value = fx.convert(native, op.currency, base, op.date).cents;
      scaled.push(value);
      total += value;
      if (Math.abs(native) > Math.abs(parts[largest].amountCents)) largest = i;
    }
    // L'arrondi est corrigé sur la plus grosse ligne : les lignes font exactement le montant de l'opération.
    if (total !== baseCents) scaled[largest] += baseCents - total;
    return parts.map((part, i) => resolveLine(part.categoryId, scaled[i], part.amountCents));
  };

  let profitCents = 0;
  const periodProfit = timeline.map(() => 0);
  const months = new Set();
  const todo = { uncategorized: 0, needsReview: 0, estimated: 0, noAttachment: 0 };
  const byId = new Map();

  // 2. Un seul passage, de la plus ancienne à la plus récente.
  for (let i = list.length - 1; i >= 0; i--) {
    const op = list[i];
    const month = op.date.slice(0, 7);
    let enriched;

    if (op.kind === "pl") {
      const acc = op.accountId ? accountState(op.accountId, op.currency) : null;
      const ownerId = acc ? acc.owner : UNKNOWN;
      const amount = op.amountCents;
      const settled =
        Number.isInteger(op.settledCents) && op.settledCents !== 0 && amount !== 0 && (op.settledCents < 0) === (amount < 0)
          ? op.settledCents
          : null;
      let baseCents;
      let fxEstimated = false;
      if (op.currency === base) baseCents = amount;
      else if (settled !== null && acc && !acc.missing && acc.currency === base) baseCents = settled;
      else {
        baseCents = fx.convert(amount, op.currency, base, op.date).cents;
        fxEstimated = true;
      }

      const accountEffects = [];
      if (acc) {
        let effect;
        let approx = false;
        if (op.currency === acc.currency) effect = amount;
        else if (settled !== null) effect = settled;
        else {
          effect = fx.convert(amount, op.currency, acc.currency, op.date).cents;
          approx = true;
        }
        acc.balanceCents += effect;
        acc.baseFlowCents += baseCents;
        acc.opCount++;
        if (approx) acc.approx = true;
        accountEffects.push({ accountId: acc.id, cents: effect, approx });
      }

      const lines = buildLines(op, baseCents);
      const sharePeriod = periodIndex(op.date);
      profitCents += baseCents;
      periodProfit[sharePeriod] += baseCents;

      // L'opération normalisée est un objet neuf, propre à ce livre : on y ajoute les champs calculés.
      const effects = [];
      enriched = op;
      op.baseCents = baseCents;
      op.fxEstimated = fxEstimated;
      op.month = month;
      op.lines = lines;
      op.effects = effects;
      op.accountEffects = accountEffects;
      op.ownerId = ownerId;
      op.nature = amount < 0 ? "expense" : "income";
      op.sharePeriod = sharePeriod;
      if (ownerId !== BUSINESS) {
        // Payé ou encaissé avec l'argent d'un associé : l'entreprise lui doit la dépense, il lui doit l'encaissement.
        const effectCents = 0 - baseCents;
        const pos = position(ownerId);
        pos.netCents += effectCents;
        if (baseCents < 0) pos.advancedCents -= baseCents;
        else pos.collectedCents += baseCents;
        effects.push({ partnerId: ownerId, cents: effectCents });
        pos.entries.push({ op: enriched, effectCents, type: baseCents < 0 ? "advance" : "collect" });
      }
      let uncategorized = false;
      for (const line of lines) if (line.categoryId === UNCATEGORIZED) uncategorized = true;
      if (uncategorized) todo.uncategorized++;
      if (amount < 0 && !op.attachments) todo.noAttachment++;
    } else {
      const from = op.fromAccountId ? accountState(op.fromAccountId, op.currency) : null;
      const to = op.toAccountId ? accountState(op.toAccountId, op.currency) : null;
      const amount = op.amountCents;
      const arrived = Number.isInteger(op.toAmountCents) && op.toAmountCents > 0 ? op.toAmountCents : null;
      let value;
      let fxEstimated = false;
      if (op.currency === base) value = amount;
      else if (arrived !== null && to && !to.missing && to.currency === base) value = arrived;
      else {
        value = fx.convert(amount, op.currency, base, op.date).cents;
        fxEstimated = true;
      }

      const accountEffects = [];
      if (from) {
        let effect = amount;
        let approx = false;
        if (op.currency !== from.currency) {
          effect = fx.convert(amount, op.currency, from.currency, op.date).cents;
          approx = true;
        }
        from.balanceCents -= effect;
        from.baseFlowCents -= value;
        from.opCount++;
        if (approx) from.approx = true;
        accountEffects.push({ accountId: from.id, cents: 0 - effect, approx });
      }
      if (to) {
        let effect = amount;
        let approx = false;
        if (arrived !== null) effect = arrived;
        else if (op.currency !== to.currency) {
          effect = fx.convert(amount, op.currency, to.currency, op.date).cents;
          approx = true;
        }
        to.balanceCents += effect;
        to.baseFlowCents += value;
        if (to !== from) to.opCount++;
        if (approx) to.approx = true;
        accountEffects.push({ accountId: to.id, cents: effect, approx });
      }

      const fromOwnerId = from ? from.owner : UNKNOWN;
      const toOwnerId = to ? to.owner : UNKNOWN;
      const effects = [];
      let nature = "internal";
      enriched = op;
      op.baseCents = value;
      op.fxEstimated = fxEstimated;
      op.month = month;
      op.lines = [];
      op.effects = effects;
      op.accountEffects = accountEffects;
      op.fromOwnerId = fromOwnerId;
      op.toOwnerId = toOwnerId;
      op.nature = nature;
      op.sharePeriod = periodIndex(op.date);
      if (fromOwnerId !== toOwnerId) {
        if (toOwnerId === BUSINESS) {
          nature = "contribution";
          const pos = position(fromOwnerId);
          pos.netCents += value;
          pos.contributedCents += value;
          effects.push({ partnerId: fromOwnerId, cents: value });
          pos.entries.push({ op: enriched, effectCents: value, type: "contribution" });
        } else if (fromOwnerId === BUSINESS) {
          nature = "withdrawal";
          const pos = position(toOwnerId);
          pos.netCents -= value;
          pos.withdrawnCents += value;
          effects.push({ partnerId: toOwnerId, cents: 0 - value });
          pos.entries.push({ op: enriched, effectCents: 0 - value, type: "withdrawal" });
        } else {
          nature = "settlement";
          const payer = position(fromOwnerId);
          const receiver = position(toOwnerId);
          payer.netCents += value;
          payer.settledCents -= value;
          receiver.netCents -= value;
          receiver.settledCents += value;
          effects.push({ partnerId: fromOwnerId, cents: value }, { partnerId: toOwnerId, cents: 0 - value });
          payer.entries.push({ op: enriched, effectCents: value, type: "settlement" });
          receiver.entries.push({ op: enriched, effectCents: 0 - value, type: "settlement" });
        }
        enriched.nature = nature;
      }
    }

    if (enriched.fxEstimated) todo.estimated++;
    if (enriched.needsReview) todo.needsReview++;
    months.add(month);
    byId.set(enriched.id, enriched);
    list[i] = enriched;
  }

  // 3. Comptes : soldes, trésorerie de l'entreprise, contrôle de cohérence.
  const accountsOut = Object.fromEntries(accounts);
  let businessCashCents = 0;
  let businessCashApprox = false;
  let businessFlowCents = 0;
  for (const acc of accounts.values()) {
    if (acc.owner !== BUSINESS) continue;
    businessFlowCents += acc.baseFlowCents;
    businessCashCents += fx.convert(acc.balanceCents, acc.currency, base, LATEST).cents;
    if (acc.approx || (acc.currency !== base && acc.balanceCents !== 0)) businessCashApprox = true;
  }

  // 4. Partage du bénéfice, période par période.
  const lastShares = timeline[lastPeriod].shares;
  for (const period of timeline) for (const id of Object.keys(period.shares)) position(id);
  const allocationOrder = Array.from(positions.keys());
  const activePartnerCount = listPartners(cfg).length;
  const shareProblems = [];
  const sharePeriods = timeline.map((period, index) => {
    const perPartner = allocateByShares(periodProfit[index], period.shares, { equal: period.equal, order: allocationOrder });
    let allocatedCents = 0;
    for (const id of Object.keys(perPartner)) {
      allocatedCents += perPartner[id];
      positions.get(id).profitShareCents += perPartner[id];
    }
    if (Math.abs(period.sharesTotal - 100) > 0.005 && (period.partnerCount > 0 || activePartnerCount > 0)) {
      shareProblems.push({
        index, ruleId: period.ruleId, from: period.from, to: period.to, startsOn: period.startsOn, sharesTotal: period.sharesTotal,
      });
    }
    return {
      ...period,
      profitCents: periodProfit[index],
      perPartner,
      allocatedCents,
      unallocatedCents: periodProfit[index] - allocatedCents,
    };
  });

  const partners = {};
  let partnersNetCents = 0;
  for (const pos of positions.values()) {
    if (pos.id === UNKNOWN && pos.entries.length === 0 && pos.profitShareCents === 0) continue;
    pos.equityCents = pos.netCents + pos.profitShareCents;
    pos.sharePct = Object.prototype.hasOwnProperty.call(lastShares, pos.id) ? lastShares[pos.id] : 0;
    partners[pos.id] = pos;
    partnersNetCents += pos.netCents;
  }

  const unknownOwnerAccountIds = listAccounts(cfg, { includeArchived: true })
    .filter((a) => accounts.get(a.id).owner === UNKNOWN && (!a.archived || accounts.get(a.id).opCount > 0))
    .map((a) => a.id);

  return {
    config: cfg,
    base,
    ops: list,
    byId,
    months: Array.from(months).sort(),
    accounts: accountsOut,
    businessCashCents,
    businessCashApprox,
    partners,
    profitCents,
    sharePeriods,
    checks: {
      identityDiffCents: businessFlowCents - (profitCents + partnersNetCents),
      businessFlowCents,
      partnersNetCents,
      sharesTotal: timeline[lastPeriod].sharesTotal,
      shareProblems,
      skippedOps,
    },
    todo: { ...todo, unknownOwnerAccountIds, missingAccountIds },
  };
}

// ---------------------------------------------------------------------------------------------
// Filtres

function rangeOf(filter) {
  const f = filter || {};
  let from = typeof f.from === "string" && f.from ? f.from : null;
  let to = typeof f.to === "string" && f.to ? f.to : null;
  if (typeof f.month === "string" && MONTH_RE.test(f.month)) {
    const first = monthStart(f.month);
    const last = monthEnd(f.month);
    if (!from || first > from) from = first;
    if (!to || last < to) to = last;
  }
  return { from, to };
}

function normalizeText(value) {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const searchCache = new WeakMap();

function searchText(book, op) {
  let text = searchCache.get(op);
  if (text === undefined) {
    const parts = [op.label, op.party, op.ref, op.note, op.card];
    const amount = centsToInput(Math.abs(op.amountCents));
    parts.push(amount, amount.replace(",", "."));
    if (op.kind === "pl") {
      parts.push(accountLabel(book.config, op.accountId));
      for (const line of op.lines) parts.push(categoryLabel(book.config, line.categoryId));
    } else {
      parts.push(accountLabel(book.config, op.fromAccountId), accountLabel(book.config, op.toAccountId));
    }
    text = normalizeText(parts.filter(Boolean).join(" \n "));
    searchCache.set(op, text);
  }
  return text;
}

/** Prépare un filtre : un test par opération, et un test par ligne quand le filtre vise des catégories. */
function compileFilter(book, filter) {
  const f = filter && typeof filter === "object" ? filter : {};
  const { from, to } = rangeOf(f);
  const { accountId, partnerId, source } = f;
  const kind = f.kind === "pl" || f.kind === "transfer" ? f.kind : null;
  const sign = f.sign === "in" || f.sign === "out" ? f.sign : null;
  const words = typeof f.text === "string" && f.text.trim() ? normalizeText(f.text).split(/\s+/).filter(Boolean) : null;
  const flag = (v) => (v === true || v === false ? v : null);
  const needsReview = flag(f.needsReview);
  const reconciled = flag(f.reconciled);
  const noAttachment = flag(f.noAttachment);
  const uncategorized = flag(f.uncategorized);
  const fxEstimated = flag(f.fxEstimated);
  const categoryId = typeof f.categoryId === "string" && f.categoryId ? f.categoryId : null;
  const group = typeof f.group === "string" && f.group ? f.group : null;

  let lineTest = null;
  if (categoryId || group || uncategorized === true) {
    lineTest = (line) =>
      (!categoryId || line.categoryId === categoryId) &&
      (!group || line.group === group) &&
      (uncategorized !== true || line.categoryId === UNCATEGORIZED);
  }

  const opTest = (op) => {
    if (from && op.date < from) return false;
    if (to && op.date > to) return false;
    if (kind && op.kind !== kind) return false;
    const pl = op.kind === "pl";
    if (accountId) {
      if (pl ? op.accountId !== accountId : op.fromAccountId !== accountId && op.toAccountId !== accountId) return false;
    }
    if (partnerId) {
      if (pl ? op.ownerId !== partnerId : op.fromOwnerId !== partnerId && op.toOwnerId !== partnerId) return false;
    }
    if (sign) {
      if (pl) {
        if (sign === "in" ? op.amountCents <= 0 : op.amountCents >= 0) return false;
      } else if (!accountId || (sign === "in" ? op.toAccountId : op.fromAccountId) !== accountId) {
        // Un mouvement entre comptes n'a de sens "entrée" ou "sortie" que vu d'un compte précis.
        return false;
      }
    }
    if (source && op.source !== source) return false;
    if (needsReview !== null && !!op.needsReview !== needsReview) return false;
    if (reconciled !== null && !!op.reconciled !== reconciled) return false;
    if (fxEstimated !== null && op.fxEstimated !== fxEstimated) return false;
    const hasFile = !!(op.attachments && op.attachments.length);
    if (noAttachment === true && (!pl || op.amountCents >= 0 || hasFile)) return false;
    if (noAttachment === false && !hasFile) return false;
    if (lineTest) {
      if (!pl) return false;
      let any = false;
      for (const line of op.lines) if (lineTest(line)) { any = true; break; }
      if (!any) return false;
    }
    if (uncategorized === false) {
      for (const line of op.lines) if (line.categoryId === UNCATEGORIZED) return false;
    }
    if (words) {
      const text = searchText(book, op);
      for (const word of words) if (!text.includes(word)) return false;
    }
    return true;
  };
  return { opTest, lineTest, from, to };
}

/**
 * Opérations du livre qui passent le filtre, dans l'ordre du livre (la plus récente d'abord).
 * @param {object} book
 * @param {object} [filter] { from, to, month, accountId, categoryId, group, partnerId, kind, sign, source, text,
 *   needsReview, uncategorized, noAttachment, reconciled, fxEstimated } (tous facultatifs, voir la référence d'API)
 * @returns {object[]} opérations enrichies (nouveau tableau, mêmes objets que dans le livre)
 */
export function filterOps(book, filter) {
  const { opTest } = compileFilter(book, filter);
  return book.ops.filter(opTest);
}

// ---------------------------------------------------------------------------------------------
// Résumés

function newTotals() {
  return {
    incomeCents: 0, expenseCents: 0, profitCents: 0, salesCents: 0, refundsCents: 0, adSpendCents: 0, feesCents: 0,
    byCategory: {}, byGroup: {}, opCount: 0,
  };
}

function addLine(t, line) {
  const c = line.baseCents;
  t.profitCents += c;
  if (line.kind === "income") t.incomeCents += c;
  else t.expenseCents -= c;
  t.byCategory[line.categoryId] = (t.byCategory[line.categoryId] || 0) + c;
  t.byGroup[line.group] = (t.byGroup[line.group] || 0) + c;
  if (line.group === "sales") {
    t.salesCents += c;
    if (line.categoryId === "refunds") t.refundsCents -= c;
  } else if (line.group === "ads") {
    t.adSpendCents -= c;
  }
  if (line.categoryId === "fees_payment") t.feesCents -= c;
}

/**
 * Résumé du bénéfice sur les opérations qui passent le filtre (seules les opérations "pl" comptent).
 * Avec un filtre de catégorie ou de groupe, seules les lignes concernées sont comptées.
 * Tous les montants sont dans la devise de base du livre. Coût : un passage sur les opérations.
 * @param {object} book
 * @param {object} [filter] même forme que pour filterOps
 * @returns {object} Summary (voir la référence d'API)
 */
export function summarize(book, filter) {
  const { opTest, lineTest } = compileFilter(book, filter);
  const t = newTotals();
  const adSpendByPlatform = {};
  const adSpendByPayer = {};
  for (const id of PLATFORM_IDS) {
    adSpendByPlatform[id] = 0;
    adSpendByPayer[id] = {};
  }
  const byPayer = {};
  let uncategorizedInCents = 0;
  let uncategorizedOutCents = 0;
  let approx = false;
  for (const op of book.ops) {
    if (op.kind !== "pl" || !opTest(op)) continue;
    let counted = false;
    for (const line of op.lines) {
      if (lineTest && !lineTest(line)) continue;
      counted = true;
      addLine(t, line);
      const c = line.baseCents;
      let payer = byPayer[op.ownerId];
      if (!payer) payer = byPayer[op.ownerId] = { paidCents: 0, receivedCents: 0 };
      if (line.kind === "income") payer.receivedCents += c;
      else payer.paidCents -= c;
      if (line.group === "ads") {
        const platform = PLATFORM_BY_CATEGORY[line.categoryId] || "other";
        adSpendByPlatform[platform] -= c;
        adSpendByPayer[platform][op.ownerId] = (adSpendByPayer[platform][op.ownerId] || 0) - c;
      } else if (line.categoryId === UNCATEGORIZED) {
        if (c < 0) uncategorizedOutCents -= c;
        else uncategorizedInCents += c;
      }
    }
    if (counted) {
      t.opCount++;
      if (op.fxEstimated) approx = true;
    }
  }
  const nonAdCostsCents = t.expenseCents - t.adSpendCents;
  const contribution = t.salesCents - nonAdCostsCents;
  return {
    incomeCents: t.incomeCents,
    expenseCents: t.expenseCents,
    profitCents: t.profitCents,
    marginPct: t.incomeCents > 0 ? pct(t.profitCents, t.incomeCents) : null,
    salesCents: t.salesCents,
    grossSalesCents: t.salesCents + t.refundsCents,
    refundsCents: t.refundsCents,
    adSpendCents: t.adSpendCents,
    adSpendByPlatform,
    adSpendByPayer,
    feesCents: t.feesCents,
    nonAdCostsCents,
    byCategory: t.byCategory,
    byGroup: t.byGroup,
    byPayer,
    uncategorizedInCents,
    uncategorizedOutCents,
    opCount: t.opCount,
    merRatio: t.adSpendCents > 0 ? t.salesCents / t.adSpendCents : null,
    breakEvenRoas: t.salesCents > 0 && contribution > 0 ? t.salesCents / contribution : null,
    approx,
  };
}

/**
 * Totaux par mois, du plus ancien au plus récent, sans trou entre le premier et le dernier mois qui ont
 * des opérations dans le filtre ([] s'il n'y en a aucune).
 * @param {object} book
 * @param {object} [filter] même forme que pour filterOps
 * @returns {Array<{ month: string, incomeCents: number, expenseCents: number, profitCents: number, salesCents: number,
 *   refundsCents: number, adSpendCents: number, feesCents: number, byGroup: Object<string, number>,
 *   byCategory: Object<string, number>, opCount: number }>}
 */
export function monthlySeries(book, filter) {
  const { opTest, lineTest } = compileFilter(book, filter);
  const byMonth = new Map();
  for (const op of book.ops) {
    if (op.kind !== "pl" || !opTest(op)) continue;
    let t = null;
    for (const line of op.lines) {
      if (lineTest && !lineTest(line)) continue;
      if (!t) {
        t = byMonth.get(op.month);
        if (!t) {
          t = newTotals();
          byMonth.set(op.month, t);
        }
        t.opCount++;
      }
      addLine(t, line);
    }
  }
  if (!byMonth.size) return [];
  const keys = Array.from(byMonth.keys()).sort();
  const out = [];
  let month = keys[0];
  const last = keys[keys.length - 1];
  while (month <= last && out.length < 1200) {
    const t = byMonth.get(month) || newTotals();
    out.push({
      month,
      incomeCents: t.incomeCents,
      expenseCents: t.expenseCents,
      profitCents: t.profitCents,
      salesCents: t.salesCents,
      refundsCents: t.refundsCents,
      adSpendCents: t.adSpendCents,
      feesCents: t.feesCents,
      byGroup: t.byGroup,
      byCategory: t.byCategory,
      opCount: t.opCount,
    });
    month = addMonths(month, 1);
  }
  return out;
}

/**
 * Part de chaque associé dans le bénéfice (ou la perte) des opérations qui passent le filtre : chaque opération
 * est partagée selon la règle en vigueur à sa date, puis le bénéfice de chaque période de partage est réparti
 * par la méthode du plus fort reste. Sans filtre, on retrouve `book.sharePeriods`.
 * @param {object} book
 * @param {object} [filter] même forme que pour filterOps
 * @returns {{ profitCents: number, perPartner: Object<string, number>, periods: object[] }}
 *   periods : une entrée par période de partage, de même forme que `book.sharePeriods`
 */
export function profitShares(book, filter) {
  const { opTest, lineTest } = compileFilter(book, filter);
  const profits = book.sharePeriods.map(() => 0);
  for (const op of book.ops) {
    if (op.kind !== "pl" || !opTest(op)) continue;
    if (!lineTest) profits[op.sharePeriod] += op.baseCents;
    else for (const line of op.lines) if (lineTest(line)) profits[op.sharePeriod] += line.baseCents;
  }
  const order = Object.keys(book.partners);
  const perPartner = {};
  let profitCents = 0;
  const periods = book.sharePeriods.map((period, index) => {
    const share = allocateByShares(profits[index], period.shares, { equal: period.equal, order });
    let allocatedCents = 0;
    for (const id of Object.keys(share)) {
      allocatedCents += share[id];
      perPartner[id] = (perPartner[id] || 0) + share[id];
    }
    profitCents += profits[index];
    return { ...period, profitCents: profits[index], perPartner: share, allocatedCents, unallocatedCents: profits[index] - allocatedCents };
  });
  return { profitCents, perPartner, periods };
}

// ---------------------------------------------------------------------------------------------
// Relevés

/**
 * Relevé du compte d'associé : chaque opération qui change ce que l'entreprise doit à l'associé, de la plus
 * ancienne à la plus récente, avec le solde après l'opération (positif : l'entreprise lui doit ; négatif : il doit
 * à l'entreprise). Le solde est toujours le vrai solde cumulé, même quand le filtre masque des lignes.
 * @param {object} book
 * @param {string} partnerId identifiant d'associé, ou "unknown"
 * @param {object} [filter] même forme que pour filterOps (partnerId est ignoré)
 * @returns {{ position: object, entries: Array<{ op: object, effectCents: number, balanceCents: number, type: string }>,
 *   openingCents: number, closingCents: number, changeCents: number, period: object }}
 */
export function partnerStatement(book, partnerId, filter) {
  const position = (book.partners && book.partners[partnerId]) || newPosition(partnerId);
  const { opTest, from, to } = compileFilter(book, { ...(filter || {}), partnerId: null });
  const entries = [];
  const period = { advancedCents: 0, collectedCents: 0, contributedCents: 0, withdrawnCents: 0, settledCents: 0, netCents: 0 };
  let balance = 0;
  let openingCents = 0;
  let closingCents = 0;
  for (const entry of position.entries) {
    const date = entry.op.date;
    balance += entry.effectCents;
    if (from && date < from) openingCents = balance;
    if (!to || date <= to) closingCents = balance;
    if (!opTest(entry.op)) continue;
    entries.push({ op: entry.op, effectCents: entry.effectCents, balanceCents: balance, type: entry.type });
    period.netCents += entry.effectCents;
    if (entry.type === "advance") period.advancedCents += entry.effectCents;
    else if (entry.type === "collect") period.collectedCents -= entry.effectCents;
    else if (entry.type === "contribution") period.contributedCents += entry.effectCents;
    else if (entry.type === "withdrawal") period.withdrawnCents -= entry.effectCents;
    else period.settledCents -= entry.effectCents;
  }
  return { position, entries, openingCents, closingCents, changeCents: closingCents - openingCents, period };
}

/**
 * Relevé d'un compte : chaque opération qui touche le compte, de la plus ancienne à la plus récente, avec le
 * solde après l'opération, dans la devise du compte. Pour un compte de l'entreprise le solde part du solde
 * d'ouverture ; pour un compte personnel il ne suit que les mouvements liés à l'entreprise.
 * @param {object} book
 * @param {string} accountId
 * @param {object} [filter] même forme que pour filterOps (accountId est ignoré)
 * @returns {{ accountId: string, currency: string|null, entries: Array<{ op: object, effectCents: number,
 *   balanceCents: number, approx: boolean }>, openingCents: number, closingCents: number, approx: boolean }}
 *   approx : vrai si un montant a dû être estimé par un taux de change
 */
export function accountStatement(book, accountId, filter) {
  const account = book.accounts && Object.prototype.hasOwnProperty.call(book.accounts, accountId) ? book.accounts[accountId] : null;
  const { opTest, from, to } = compileFilter(book, { ...(filter || {}), accountId: null });
  const entries = [];
  let balance = account ? account.openingCents : 0;
  let openingCents = balance;
  let closingCents = balance;
  let approx = false;
  for (let i = book.ops.length - 1; i >= 0; i--) {
    const op = book.ops[i];
    let effect = 0;
    let touched = false;
    let opApprox = false;
    for (const e of op.accountEffects) {
      if (e.accountId !== accountId) continue;
      touched = true;
      effect += e.cents;
      if (e.approx) opApprox = true;
    }
    if (!touched) continue;
    balance += effect;
    if (from && op.date < from) openingCents = balance;
    if (!to || op.date <= to) {
      closingCents = balance;
      if (opApprox) approx = true;
    }
    if (!opTest(op)) continue;
    entries.push({ op, effectCents: effect, balanceCents: balance, approx: opApprox });
  }
  return { accountId, currency: account ? account.currency : null, entries, openingCents, closingCents, approx };
}

// ---------------------------------------------------------------------------------------------
// Statistiques (commandes Shopify, performances des plateformes de pub)

function dayOf(month, key) {
  const iso = month + "-" + String(key).padStart(2, "0");
  return isValidISO(iso) ? iso : null;
}

/** Parcourt les jours de statistiques compris dans [from, to]. visit(kind, platformId, date, day). */
function eachStatsDay(statsByMonth, from, to, visit) {
  if (!statsByMonth || typeof statsByMonth !== "object") return;
  const fromMonth = from ? from.slice(0, 7) : null;
  const toMonth = to ? to.slice(0, 7) : null;
  for (const month of Object.keys(statsByMonth)) {
    if (!MONTH_RE.test(month)) continue;
    if ((fromMonth && month < fromMonth) || (toMonth && month > toMonth)) continue;
    const doc = statsByMonth[month];
    if (!doc || typeof doc !== "object") continue;
    const walk = (days, kind, platformId) => {
      if (!days || typeof days !== "object") return;
      for (const key of Object.keys(days)) {
        const date = dayOf(month, key);
        const day = days[key];
        if (!date || !day || typeof day !== "object") continue;
        if ((from && date < from) || (to && date > to)) continue;
        visit(kind, platformId, date, day);
      }
    };
    walk(doc.shopify && doc.shopify.days, "shopify", null);
    if (doc.ads && typeof doc.ads === "object") {
      for (const platform of Object.keys(doc.ads)) {
        const entry = doc.ads[platform];
        walk(entry && entry.days, "ads", PLATFORM_IDS.includes(platform) ? platform : "other");
      }
    }
  }
}

const statCurrency = (day) => (typeof day.currency === "string" && /^[A-Za-z]{3}$/.test(day.currency.trim()) ? day.currency.trim().toUpperCase() : "USD");

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Valeur des commandes d'un jour Shopify (pour le panier moyen) : brut moins remises, sinon total, sinon net. */
function shopifyOrderValue(day) {
  if (isNum(day.grossCents)) return day.grossCents - Math.abs(finite(day.discountsCents));
  if (isNum(day.totalCents)) return day.totalCents;
  return finite(day.netCents);
}

/** Ventes nettes d'un jour Shopify : `netCents`, sinon brut moins remises et remboursements. */
function shopifyNet(day) {
  if (isNum(day.netCents)) return day.netCents;
  return finite(day.grossCents) - Math.abs(finite(day.discountsCents)) - Math.abs(finite(day.refundsCents));
}

/**
 * Indicateurs de publicité et de commandes sur la période du filtre.
 * Les dépenses (`spendCents`, `adSpendCents`) et les ventes viennent du livre ; impressions, clics, achats,
 * valeur d'achat et commandes viennent des statistiques importées (seuls from, to et month s'appliquent aux statistiques).
 * @param {object} book
 * @param {Object<string, object>} statsByMonth documents `stats/<AAAA-MM>` indexés par mois
 * @param {object} [filter] même forme que pour filterOps
 * @returns {object} voir la référence d'API
 */
export function adKpis(book, statsByMonth, filter) {
  const summary = summarize(book, filter);
  const { from, to } = rangeOf(filter);
  const fx = createFx(book.config);
  const base = book.base;
  const byPlatform = {};
  for (const id of PLATFORM_IDS) {
    byPlatform[id] = {
      spendCents: summary.adSpendByPlatform[id] || 0,
      statsSpendCents: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValueCents: 0,
      hasStats: false, roas: null, cpa: null, cpm: null, cpc: null,
    };
  }
  let orders = 0;
  let orderValueCents = 0;
  let hasOrderStats = false;
  eachStatsDay(statsByMonth, from, to, (kind, platformId, date, day) => {
    const cur = statCurrency(day);
    if (kind === "shopify") {
      hasOrderStats = true;
      orders += finite(day.orders);
      orderValueCents += fx.convert(shopifyOrderValue(day), cur, base, date).cents;
      return;
    }
    const p = byPlatform[platformId];
    p.hasStats = true;
    p.statsSpendCents += fx.convert(finite(day.spendCents), cur, base, date).cents;
    p.purchaseValueCents += fx.convert(finite(day.purchaseValueCents), cur, base, date).cents;
    p.impressions += finite(day.impressions);
    p.clicks += finite(day.clicks);
    p.purchases += finite(day.purchases);
  });
  let statsAdSpendCents = 0;
  for (const id of PLATFORM_IDS) {
    const p = byPlatform[id];
    statsAdSpendCents += p.statsSpendCents;
    if (!p.hasStats) continue;
    // Les ratios d'une plateforme utilisent sa dépense déclarée (cohérente avec ses achats), sinon celle du livre.
    const spend = p.statsSpendCents > 0 ? p.statsSpendCents : p.spendCents;
    if (spend > 0) {
      p.roas = p.purchaseValueCents / spend;
      if (p.purchases > 0) p.cpa = Math.round(spend / p.purchases);
      if (p.impressions > 0) p.cpm = Math.round((spend * 1000) / p.impressions);
      if (p.clicks > 0) p.cpc = Math.round(spend / p.clicks);
    }
  }
  const valueForAov = orderValueCents > 0 ? orderValueCents : summary.salesCents;
  return {
    byPlatform,
    orders,
    aovCents: orders > 0 ? Math.round(valueForAov / orders) : null,
    cpaCents: orders > 0 ? Math.round(summary.adSpendCents / orders) : null,
    merRatio: summary.merRatio,
    salesCents: summary.salesCents,
    adSpendCents: summary.adSpendCents,
    statsAdSpendCents,
    orderValueCents,
    hasOrderStats,
  };
}

/**
 * Série par jour, du premier au dernier jour qui a des données dans la période, sans trou.
 * Ventes et pub viennent des statistiques importées quand la période en contient (commandes Shopify, dépense
 * déclarée par les plateformes), sinon du livre (virements reçus, prélèvements de pub). Les deux versions sont
 * toujours fournies (`ledger...`, `stats...`).
 * @param {object} book
 * @param {Object<string, object>} statsByMonth
 * @param {object} [filter] même forme que pour filterOps (seuls from, to et month s'appliquent aux statistiques)
 * @returns {Array<{ date: string, salesCents: number, adSpendCents: number, orders: number,
 *   adSpendByPlatform: Object<string, number>, ledgerSalesCents: number, ledgerAdSpendCents: number,
 *   statsSalesCents: number, statsAdSpendCents: number, salesFromStats: boolean, adSpendFromStats: boolean }>}
 */
export function dailySeries(book, statsByMonth, filter) {
  const { opTest, lineTest, from, to } = compileFilter(book, filter);
  const fx = createFx(book.config);
  const base = book.base;
  const days = new Map();
  const row = (date) => {
    let r = days.get(date);
    if (!r) {
      r = {
        date, orders: 0, ledgerSalesCents: 0, ledgerAdSpendCents: 0, statsSalesCents: 0, statsAdSpendCents: 0,
        ledgerByPlatform: null, statsByPlatform: null,
      };
      days.set(date, r);
    }
    return r;
  };
  const addPlatform = (r, key, platform, cents) => {
    if (!r[key]) r[key] = {};
    r[key][platform] = (r[key][platform] || 0) + cents;
  };
  for (const op of book.ops) {
    if (op.kind !== "pl" || !opTest(op)) continue;
    for (const line of op.lines) {
      if (lineTest && !lineTest(line)) continue;
      if (line.group === "sales") row(op.date).ledgerSalesCents += line.baseCents;
      else if (line.group === "ads") {
        const r = row(op.date);
        r.ledgerAdSpendCents -= line.baseCents;
        addPlatform(r, "ledgerByPlatform", PLATFORM_BY_CATEGORY[line.categoryId] || "other", 0 - line.baseCents);
      }
    }
  }
  let salesFromStats = false;
  let adSpendFromStats = false;
  eachStatsDay(statsByMonth, from, to, (kind, platformId, date, day) => {
    const cur = statCurrency(day);
    const r = row(date);
    if (kind === "shopify") {
      salesFromStats = true;
      r.orders += finite(day.orders);
      r.statsSalesCents += fx.convert(shopifyNet(day), cur, base, date).cents;
    } else {
      adSpendFromStats = true;
      const spend = fx.convert(finite(day.spendCents), cur, base, date).cents;
      r.statsAdSpendCents += spend;
      addPlatform(r, "statsByPlatform", platformId, spend);
    }
  });
  if (!days.size) return [];
  const dates = Array.from(days.keys()).sort();
  const out = [];
  let date = dates[0];
  const last = dates[dates.length - 1];
  while (date <= last && out.length < 4000) {
    const r = days.get(date);
    out.push({
      date,
      salesCents: r ? (salesFromStats ? r.statsSalesCents : r.ledgerSalesCents) : 0,
      adSpendCents: r ? (adSpendFromStats ? r.statsAdSpendCents : r.ledgerAdSpendCents) : 0,
      orders: r ? r.orders : 0,
      adSpendByPlatform: (r && (adSpendFromStats ? r.statsByPlatform : r.ledgerByPlatform)) || {},
      ledgerSalesCents: r ? r.ledgerSalesCents : 0,
      ledgerAdSpendCents: r ? r.ledgerAdSpendCents : 0,
      statsSalesCents: r ? r.statsSalesCents : 0,
      statsAdSpendCents: r ? r.statsAdSpendCents : 0,
      salesFromStats,
      adSpendFromStats,
    });
    date = addDays(date, 1);
  }
  return out;
}
