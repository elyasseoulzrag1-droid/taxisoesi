import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBook, filterOps, summarize, monthlySeries, partnerStatement, accountStatement, adKpis, dailySeries,
  profitShares, allocateByShares,
} from "../../src/core/ledger.js";
import { normalizeConfig, defaultConfig } from "../../src/core/model.js";
import { resolvePeriod } from "../../src/core/periods.js";
import { convert } from "../../src/core/fx.js";
import { addDays } from "../../src/core/dates.js";

// ---------------------------------------------------------------------------------------------
// Outils de test

const pl = (id, date, amountCents, accountId, categoryId, extra = {}) => ({
  id, kind: "pl", date, amountCents, currency: "USD", accountId, categoryId, ...extra,
});
const tr = (id, date, amountCents, fromAccountId, toAccountId, extra = {}) => ({
  id, kind: "transfer", date, amountCents, currency: "USD", fromAccountId, toAccountId, ...extra,
});
const ids = (ops) => ops.map((op) => op.id);
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Les six chiffres d'un compte d'associé, dans l'ordre : net, avancé, encaissé, apporté, retiré, réglé. */
const figures = (book, id) => {
  const p = book.partners[id];
  return [p.netCents, p.advancedCents, p.collectedCents, p.contributedCents, p.withdrawnCents, p.settledCents];
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : les livres aléatoires sont les mêmes à chaque exécution. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Les règles du compte d'associé, une par une (tout en dollars, chiffres vérifiés à la main)

const RULES_CONFIG = {
  partners: { p: { name: "P", order: 0 }, q: { name: "Q", order: 1 } },
  accounts: {
    biz: { name: "Entreprise", owner: "business", currency: "USD" },
    biz2: { name: "Entreprise, épargne", owner: "business", currency: "USD" },
    pp: { name: "Perso de P", owner: "p", currency: "USD" },
    pp2: { name: "Carte de P", owner: "p", currency: "USD" },
    qq: { name: "Perso de Q", owner: "q", currency: "USD" },
    uu: { name: "Carte 9999", owner: "unknown", currency: "USD" },
  },
};

test("règle : une dépense payée avec l'argent d'un associé augmente ce que l'entreprise lui doit", () => {
  const book = buildBook(RULES_CONFIG, [pl("o1", "2026-10-01", -9477, "pp", "ads_applovin")]);
  assert.deepEqual(figures(book, "p"), [9477, 9477, 0, 0, 0, 0]);
  assert.deepEqual(figures(book, "q"), [0, 0, 0, 0, 0, 0]);
  assert.equal(book.profitCents, -9477);
  assert.deepEqual(book.ops[0].effects, [{ partnerId: "p", cents: 9477 }]);
  assert.equal(book.ops[0].ownerId, "p");
  assert.equal(book.ops[0].nature, "expense");
  assert.equal(book.accounts.pp.balanceCents, -9477);
  assert.equal(book.accounts.biz.balanceCents, 0);
  assert.equal(book.businessCashCents, 0);
  // identité : trésorerie de l'entreprise (0) = bénéfice (-94,77) + comptes d'associés (+94,77)
  assert.equal(book.checks.identityDiffCents, 0);
  assert.equal(book.partners.unknown, undefined);
});

test("règle : un encaissement gardé sur un compte personnel diminue ce que l'entreprise doit à l'associé", () => {
  const book = buildBook(RULES_CONFIG, [pl("o1", "2026-10-20", 62000, "pp", "sales_shopify")]);
  assert.deepEqual(figures(book, "p"), [-62000, 0, 62000, 0, 0, 0]);
  assert.equal(book.profitCents, 62000);
  assert.deepEqual(book.ops[0].effects, [{ partnerId: "p", cents: -62000 }]);
  assert.equal(book.ops[0].nature, "income");
  assert.equal(book.businessCashCents, 0);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : une opération sur un compte de l'entreprise ne touche aucun compte d'associé", () => {
  const book = buildBook(RULES_CONFIG, [pl("o1", "2026-10-01", -2500, "biz", "software"), pl("o2", "2026-10-02", 10000, "biz", "sales_other")]);
  assert.deepEqual(figures(book, "p"), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(figures(book, "q"), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(book.byId.get("o1").effects, []);
  assert.equal(book.byId.get("o1").ownerId, "business");
  assert.equal(book.profitCents, 7500);
  assert.equal(book.accounts.biz.balanceCents, 7500);
  assert.equal(book.businessCashCents, 7500);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : un virement du compte d'un associé vers l'entreprise est un apport", () => {
  const book = buildBook(RULES_CONFIG, [tr("t1", "2026-11-14", 500000, "pp", "biz")]);
  assert.deepEqual(figures(book, "p"), [500000, 0, 0, 500000, 0, 0]);
  const op = book.ops[0];
  assert.deepEqual(op.effects, [{ partnerId: "p", cents: 500000 }]);
  assert.equal(op.nature, "contribution");
  assert.equal(op.baseCents, 500000);
  assert.deepEqual(op.lines, []);
  assert.deepEqual([op.fromOwnerId, op.toOwnerId], ["p", "business"]);
  assert.equal(book.profitCents, 0); // un mouvement entre comptes ne compte pas dans le bénéfice
  assert.equal(book.accounts.biz.balanceCents, 500000);
  assert.equal(book.accounts.pp.balanceCents, -500000);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : un virement de l'entreprise vers le compte d'un associé est un remboursement ou un retrait", () => {
  const book = buildBook(RULES_CONFIG, [tr("t1", "2026-11-19", 40000, "biz", "pp")]);
  assert.deepEqual(figures(book, "p"), [-40000, 0, 0, 0, 40000, 0]);
  assert.deepEqual(book.ops[0].effects, [{ partnerId: "p", cents: -40000 }]);
  assert.equal(book.ops[0].nature, "withdrawal");
  assert.equal(book.accounts.biz.balanceCents, -40000);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : un virement entre deux associés est un règlement entre eux", () => {
  const book = buildBook(RULES_CONFIG, [tr("t1", "2026-11-20", 30000, "pp", "qq")]);
  // P a payé Q : l'entreprise doit 300 de plus à P et 300 de moins à Q
  assert.deepEqual(figures(book, "p"), [30000, 0, 0, 0, 0, -30000]);
  assert.deepEqual(figures(book, "q"), [-30000, 0, 0, 0, 0, 30000]);
  assert.deepEqual(book.ops[0].effects, [{ partnerId: "p", cents: 30000 }, { partnerId: "q", cents: -30000 }]);
  assert.equal(book.ops[0].nature, "settlement");
  assert.equal(book.businessCashCents, 0);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : entre deux comptes de l'entreprise, ou deux comptes du même associé, aucun effet", () => {
  const book = buildBook(RULES_CONFIG, [tr("t1", "2026-11-01", 7000, "biz", "biz2"), tr("t2", "2026-11-02", 800, "pp", "pp2")]);
  assert.deepEqual(figures(book, "p"), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(figures(book, "q"), [0, 0, 0, 0, 0, 0]);
  for (const op of book.ops) {
    assert.deepEqual(op.effects, []);
    assert.equal(op.nature, "internal");
  }
  assert.equal(book.accounts.biz.balanceCents, -7000);
  assert.equal(book.accounts.biz2.balanceCents, 7000);
  assert.equal(book.accounts.pp.balanceCents, -800);
  assert.equal(book.accounts.pp2.balanceCents, 800);
  assert.equal(book.businessCashCents, 0);
  assert.equal(book.partners.p.entries.length, 0);
  assert.equal(book.checks.identityDiffCents, 0);
});

test("règle : un compte pas encore attribué est suivi sous le pseudo associé \"unknown\"", () => {
  const book = buildBook(RULES_CONFIG, [
    pl("o1", "2026-10-01", -1000, "uu", "software"),
    tr("t1", "2026-10-02", 2000, "uu", "biz"),
    tr("t2", "2026-10-03", 600, "qq", "uu"),
  ]);
  // dépense 10 + apport 20, puis Q lui verse 6 : 10 + 20 - 6 = 24
  assert.deepEqual(figures(book, "unknown"), [2400, 1000, 0, 2000, 0, 600]);
  assert.deepEqual(figures(book, "q"), [600, 0, 0, 0, 0, -600]);
  assert.deepEqual(book.todo.unknownOwnerAccountIds, ["uu"]);
  assert.equal(book.byId.get("o1").ownerId, "unknown");
  assert.equal(book.byId.get("t1").nature, "contribution");
  assert.equal(book.byId.get("t2").nature, "settlement");
  assert.equal(book.checks.identityDiffCents, 0);
});

test("toutes les règles ensemble : soldes, détail par associé, parts égales par défaut, identité", () => {
  const ops = [
    pl("o01", "2026-10-01", -9477, "pp", "ads_applovin"), // P avance 94,77
    pl("o02", "2026-10-02", 62000, "pp", "sales_shopify"), // P encaisse 620,00
    tr("o03", "2026-10-03", 500000, "pp", "biz"), // P apporte 5 000,00
    tr("o04", "2026-10-04", 40000, "biz", "pp"), // l'entreprise rembourse 400,00 à P
    tr("o05", "2026-10-05", 30000, "pp", "qq"), // P verse 300,00 à Q
    tr("o06", "2026-10-06", 7000, "biz", "biz2"), // interne
    tr("o07", "2026-10-07", 800, "pp", "pp2"), // interne
    pl("o08", "2026-10-08", -1000, "uu", "software"), // carte non attribuée : 10,00
    tr("o09", "2026-10-09", 2000, "uu", "biz"), // apport d'un compte non attribué : 20,00
    pl("o10", "2026-10-10", -2500, "biz", "software"), // payé par l'entreprise
    tr("o11", "2026-10-11", 600, "qq", "uu"), // Q verse 6,00 au compte non attribué
  ];
  const book = buildBook(RULES_CONFIG, ops);

  // P : 9 477 - 62 000 + 500 000 - 40 000 + 30 000 = 437 477
  assert.deepEqual(figures(book, "p"), [437477, 9477, 62000, 500000, 40000, -30000]);
  // Q : -30 000 + 600 = -29 400 (il doit 294,00 à l'entreprise)
  assert.deepEqual(figures(book, "q"), [-29400, 0, 0, 0, 0, 29400]);
  // non attribué : 1 000 + 2 000 - 600 = 2 400
  assert.deepEqual(figures(book, "unknown"), [2400, 1000, 0, 2000, 0, 600]);
  // bénéfice : -9 477 + 62 000 - 1 000 - 2 500 = 49 023
  assert.equal(book.profitCents, 49023);
  // comptes de l'entreprise : 500 000 - 40 000 - 7 000 + 2 000 - 2 500 = 452 500, et 7 000
  assert.equal(book.accounts.biz.balanceCents, 452500);
  assert.equal(book.accounts.biz2.balanceCents, 7000);
  assert.equal(book.businessCashCents, 459500);
  assert.equal(book.businessCashApprox, false);
  // comptes personnels : seuls les mouvements liés à l'entreprise sont suivis
  assert.equal(book.accounts.pp.balanceCents, -9477 + 62000 - 500000 + 40000 - 30000 - 800);
  assert.equal(book.accounts.pp.balanceCents, -438277);
  assert.equal(book.accounts.pp2.balanceCents, 800);
  assert.equal(book.accounts.qq.balanceCents, 29400);
  assert.equal(book.accounts.uu.balanceCents, -2400);
  // identité : 459 500 = 49 023 + 437 477 - 29 400 + 2 400
  assert.equal(49023 + 437477 - 29400 + 2400, 459500);
  assert.deepEqual(book.checks, {
    identityDiffCents: 0, businessFlowCents: 459500, partnersNetCents: 410477, sharesTotal: 100, shareProblems: [], skippedOps: 0,
  });
  // net = avancé - encaissé + apporté - retiré - réglé, pour chacun
  for (const id of ["p", "q", "unknown"]) {
    const [net, advanced, collected, contributed, withdrawn, settled] = figures(book, id);
    assert.equal(net, advanced - collected + contributed - withdrawn - settled);
    assert.equal(sum(book.partners[id].entries.map((e) => e.effectCents)), net);
  }
  // aucune règle, aucune part saisie : parts égales. 49 023 / 2 = 24 511,5 : le centime en trop va au premier associé.
  assert.equal(book.sharePeriods.length, 1);
  assert.equal(book.sharePeriods[0].equal, true);
  assert.deepEqual(book.sharePeriods[0].perPartner, { p: 24512, q: 24511 });
  assert.equal(book.partners.p.profitShareCents, 24512);
  assert.equal(book.partners.q.profitShareCents, 24511);
  assert.equal(book.partners.unknown.profitShareCents, 0);
  assert.equal(book.partners.p.equityCents, 437477 + 24512);
  assert.equal(book.partners.q.equityCents, -29400 + 24511);
  assert.equal(book.partners.unknown.equityCents, 2400);
  assert.equal(book.partners.p.sharePct, 50);
  assert.deepEqual(Object.keys(book.partners), ["p", "q", "unknown"]);
  // les lignes du compte de P, de la plus ancienne à la plus récente
  assert.deepEqual(book.partners.p.entries.map((e) => [e.op.id, e.effectCents, e.type]), [
    ["o01", 9477, "advance"], ["o02", -62000, "collect"], ["o03", 500000, "contribution"], ["o04", -40000, "withdrawal"], ["o05", 30000, "settlement"],
  ]);
});

// ---------------------------------------------------------------------------------------------
// 2. Scénario "le fondateur seul, puis l'investisseur", en dollars puis en euros à partir des mêmes données

function founderConfig(baseCurrency) {
  return {
    business: { baseCurrency },
    partners: {
      fo: { name: "Fondateur", role: "founder", sharePct: 60, order: 0 },
      inv: { name: "Investisseur", role: "investor", sharePct: 40, order: 1 },
    },
    accounts: {
      fo_eur: { name: "Compte perso du fondateur", owner: "fo", currency: "EUR", order: 0 },
      biz_usd: { name: "Compte de l'entreprise", owner: "business", currency: "USD", order: 1 },
      inv_card: { name: "Carte de l'investisseur", kind: "card", owner: "inv", currency: "USD", order: 2 },
      inv_bank: { name: "Banque de l'investisseur", owner: "inv", currency: "EUR", order: 3 },
    },
    // 1 EUR = 1,10 USD en octobre 2026, 1,25 USD en novembre 2026
    fx: { EUR: { default: null, months: { "2026-10": 1.1, "2026-11": 1.25 } } },
  };
}

const FOUNDER_OPS = [
  // Le fondateur paie tout avec son compte perso en euros et y reçoit les virements Shopify.
  pl("o1", "2026-10-03", -120000, "fo_eur", "ads_meta", { label: "Meta Ads", settledCents: -110400 }), // 1 200,00 $ débités 1 104,00 EUR
  pl("o2", "2026-10-10", -5000, "fo_eur", "email_sms", { label: "Klaviyo" }), // 50,00 $ sans montant débité connu
  pl("o3", "2026-10-15", -1200, "fo_eur", "software", { label: "Canva", currency: "EUR" }), // 12,00 EUR
  pl("o4", "2026-10-25", 90000, "fo_eur", null, {
    label: "Virement Shopify", settledCents: 81500, // 900,00 $ reçus 815,00 EUR
    splits: [{ categoryId: "sales_shopify", amountCents: 100000 }, { categoryId: "refunds", amountCents: -4000 }, { categoryId: "fees_payment", amountCents: -6000 }],
  }),
  // L'investisseur arrive : il vire 5 000,00 EUR sur le nouveau compte de l'entreprise (6 200,00 $ reçus) et paie de la pub avec sa carte.
  tr("o5", "2026-11-02", 500000, "inv_bank", "biz_usd", { label: "Apport", currency: "EUR", toAmountCents: 620000 }),
  pl("o6", "2026-11-05", -30000, "inv_card", "ads_tiktok", { label: "TikTok Ads" }),
  // L'entreprise rembourse au fondateur une partie de ce qu'elle lui doit : 100,00 $ partis, 80,00 EUR arrivés.
  tr("o7", "2026-11-10", 10000, "biz_usd", "fo_eur", { label: "Remboursement", toAmountCents: 8000 }),
  pl("o8", "2026-11-12", -9477, "biz_usd", "ads_applovin", { label: "AppLovin" }),
];

test("scénario fondateur puis investisseur, devise de base USD : chaque chiffre vérifié à la main", () => {
  const book = buildBook(founderConfig("USD"), FOUNDER_OPS);
  assert.equal(book.base, "USD");

  // Montants en dollars de chaque opération
  const base = Object.fromEntries(book.ops.map((op) => [op.id, [op.baseCents, op.fxEstimated]]));
  assert.deepEqual(base, {
    o1: [-120000, false], // déjà en dollars
    o2: [-5000, false],
    o3: [-1320, true], // 12,00 EUR x 1,10 (taux d'octobre) = 13,20 $, estimé
    o4: [90000, false],
    o5: [620000, false], // 5 000,00 EUR : le compte d'arrivée est en dollars et a reçu 6 200,00 $ exactement
    o6: [-30000, false],
    o7: [10000, false],
    o8: [-9477, false],
  });

  // Bénéfice : -1 200,00 - 50,00 - 13,20 + 900,00 - 300,00 - 94,77 = -757,97 (une perte)
  assert.equal(book.profitCents, -75797);

  // Fondateur : a avancé 1 200,00 + 50,00 + 13,20 = 1 263,20 ; a encaissé 900,00 ; a été remboursé de 100,00
  // l'entreprise lui doit encore 1 263,20 - 900,00 - 100,00 = 263,20
  assert.deepEqual(figures(book, "fo"), [26320, 126320, 90000, 0, 10000, 0]);
  // Investisseur : a apporté 6 200,00 et avancé 300,00 de pub : l'entreprise lui doit 6 500,00
  assert.deepEqual(figures(book, "inv"), [650000, 30000, 0, 620000, 0, 0]);

  // Comptes, dans leur devise
  assert.deepEqual(book.accounts.biz_usd, {
    id: "biz_usd", owner: "business", currency: "USD", openingCents: 0,
    balanceCents: 600523, // 6 200,00 - 100,00 - 94,77
    baseFlowCents: 600523, approx: false, opCount: 3, missing: false,
  });
  // compte perso du fondateur (euros) : -1 104,00 - 45,45 (50,00 $ / 1,10, estimé) - 12,00 + 815,00 + 80,00 = -266,45
  assert.equal(book.accounts.fo_eur.balanceCents, -110400 - 4545 - 1200 + 81500 + 8000);
  assert.equal(book.accounts.fo_eur.balanceCents, -26645);
  assert.equal(book.accounts.fo_eur.approx, true);
  assert.equal(book.accounts.fo_eur.opCount, 5);
  assert.equal(book.accounts.inv_card.balanceCents, -30000);
  assert.equal(book.accounts.inv_bank.balanceCents, -500000);
  assert.equal(book.accounts.inv_bank.currency, "EUR");

  // Trésorerie de l'entreprise et identité : 6 005,23 = -757,97 + 263,20 + 6 500,00
  assert.equal(book.businessCashCents, 600523);
  assert.equal(book.businessCashApprox, false);
  assert.equal(-75797 + 26320 + 650000, 600523);
  assert.equal(book.checks.identityDiffCents, 0);
  assert.equal(book.checks.businessFlowCents, 600523);
  assert.equal(book.checks.partnersNetCents, 676320);

  // Partage de la perte à 60 / 40 (parts sharePct, aucune règle datée) :
  // 757,97 x 60 % = 454,782 et x 40 % = 303,188 : 454,78 + 303,18 = 757,96, le centime restant va au plus grand reste (0,8)
  assert.equal(book.sharePeriods.length, 1);
  assert.deepEqual(book.sharePeriods[0], {
    index: 0, ruleId: null, from: null, to: null, startsOn: null, shares: { fo: 60, inv: 40 }, sharesTotal: 100, equal: false,
    partnerCount: 2, profitCents: -75797, perPartner: { fo: -45478, inv: -30319 }, allocatedCents: -75797, unallocatedCents: 0,
  });
  assert.equal(book.partners.fo.profitShareCents, -45478);
  assert.equal(book.partners.inv.profitShareCents, -30319);
  // Ce qui revient à chacun au bout du compte : 263,20 - 454,78 = -191,58 ; 6 500,00 - 303,19 = 6 196,81
  assert.equal(book.partners.fo.equityCents, -19158);
  assert.equal(book.partners.inv.equityCents, 619681);
  // et ces deux sommes font exactement la trésorerie de l'entreprise
  assert.equal(-19158 + 619681, 600523);
  assert.equal(book.partners.fo.sharePct, 60);
  assert.equal(book.partners.inv.sharePct, 40);

  assert.deepEqual(book.months, ["2026-10", "2026-11"]);
  assert.deepEqual(book.todo, {
    uncategorized: 0, needsReview: 0, estimated: 1, noAttachment: 5, unknownOwnerAccountIds: [], missingAccountIds: [],
  });
});

test("scénario fondateur puis investisseur : forme exacte d'une opération enrichie", () => {
  const book = buildBook(founderConfig("USD"), FOUNDER_OPS);
  assert.deepEqual(book.byId.get("o1"), {
    id: "o1", kind: "pl", date: "2026-10-03", label: "Meta Ads", amountCents: -120000, currency: "USD", accountId: "fo_eur",
    categoryId: "ads_meta", settledCents: -110400,
    baseCents: -120000, fxEstimated: false, month: "2026-10",
    lines: [{ categoryId: "ads_meta", baseCents: -120000, amountCents: -120000, group: "ads", kind: "expense" }],
    effects: [{ partnerId: "fo", cents: 120000 }],
    accountEffects: [{ accountId: "fo_eur", cents: -110400, approx: false }],
    ownerId: "fo", nature: "expense", sharePeriod: 0,
  });
  assert.deepEqual(book.byId.get("o2").accountEffects, [{ accountId: "fo_eur", cents: -4545, approx: true }]);
  assert.deepEqual(book.byId.get("o4").lines, [
    { categoryId: "sales_shopify", baseCents: 100000, amountCents: 100000, group: "sales", kind: "income" },
    { categoryId: "refunds", baseCents: -4000, amountCents: -4000, group: "sales", kind: "income" },
    { categoryId: "fees_payment", baseCents: -6000, amountCents: -6000, group: "platform", kind: "expense" },
  ]);
  assert.deepEqual(book.byId.get("o5"), {
    id: "o5", kind: "transfer", date: "2026-11-02", label: "Apport", amountCents: 500000, currency: "EUR",
    fromAccountId: "inv_bank", toAccountId: "biz_usd", toAmountCents: 620000,
    baseCents: 620000, fxEstimated: false, month: "2026-11", lines: [],
    effects: [{ partnerId: "inv", cents: 620000 }],
    accountEffects: [{ accountId: "inv_bank", cents: -500000, approx: false }, { accountId: "biz_usd", cents: 620000, approx: false }],
    fromOwnerId: "inv", toOwnerId: "business", nature: "contribution", sharePeriod: 0,
  });
  assert.deepEqual(book.byId.get("o7").accountEffects, [
    { accountId: "biz_usd", cents: -10000, approx: false }, { accountId: "fo_eur", cents: 8000, approx: false },
  ]);
  // les opérations d'origine ne sont pas touchées
  assert.deepEqual(Object.keys(FOUNDER_OPS[0]).sort(), ["accountId", "amountCents", "categoryId", "currency", "date", "id", "kind", "label", "settledCents"]);
  // tri : de la plus récente à la plus ancienne
  assert.deepEqual(ids(book.ops), ["o8", "o7", "o6", "o5", "o4", "o3", "o2", "o1"]);
});

test("scénario fondateur puis investisseur, devise de base EUR : mêmes données, chiffres en euros vérifiés à la main", () => {
  const book = buildBook(founderConfig("EUR"), FOUNDER_OPS);
  assert.equal(book.base, "EUR");

  const base = Object.fromEntries(book.ops.map((op) => [op.id, [op.baseCents, op.fxEstimated]]));
  assert.deepEqual(base, {
    o1: [-110400, false], // le compte est en euros et le montant débité est connu : 1 104,00 EUR exactement
    o2: [-4545, true], // 50,00 $ / 1,10 = 45,4545 EUR, estimé
    o3: [-1200, false], // déjà en euros
    o4: [81500, false], // montant reçu connu : 815,00 EUR
    o5: [500000, false], // viré en euros
    o6: [-24000, true], // 300,00 $ / 1,25 = 240,00 EUR, estimé
    o7: [8000, false], // 100,00 $ partis, 80,00 EUR arrivés sur un compte en euros : 80,00 EUR exactement
    o8: [-7582, true], // 94,77 $ / 1,25 = 75,816 EUR, estimé
  });

  // Le virement Shopify réparti : 815,00 / 900,00 appliqué à chaque ligne
  // 1 000,00 -> 905,5556 soit 905,56 ; -40,00 -> -36,2222 soit -36,22 ; -60,00 -> -54,3333 soit -54,33
  // total 815,01 : le centime en trop est retiré de la plus grosse ligne (les ventes), qui passe à 905,55
  assert.deepEqual(book.byId.get("o4").lines, [
    { categoryId: "sales_shopify", baseCents: 90555, amountCents: 100000, group: "sales", kind: "income" },
    { categoryId: "refunds", baseCents: -3622, amountCents: -4000, group: "sales", kind: "income" },
    { categoryId: "fees_payment", baseCents: -5433, amountCents: -6000, group: "platform", kind: "expense" },
  ]);
  assert.equal(90555 - 3622 - 5433, 81500);

  // Bénéfice : -1 104,00 - 45,45 - 12,00 + 815,00 - 240,00 - 75,82 = -662,27
  assert.equal(book.profitCents, -66227);
  // Fondateur : avancé 1 104,00 + 45,45 + 12,00 = 1 161,45 ; encaissé 815,00 ; remboursé 80,00 : reste 266,45
  assert.deepEqual(figures(book, "fo"), [26645, 116145, 81500, 0, 8000, 0]);
  // Investisseur : apport 5 000,00 + pub 240,00
  assert.deepEqual(figures(book, "inv"), [524000, 24000, 0, 500000, 0, 0]);

  // Les soldes des comptes, dans leur devise, ne dépendent pas de la devise de base
  const usd = buildBook(founderConfig("USD"), FOUNDER_OPS);
  for (const id of Object.keys(book.accounts)) {
    assert.equal(book.accounts[id].balanceCents, usd.accounts[id].balanceCents, id);
    assert.equal(book.accounts[id].approx, usd.accounts[id].approx, id);
  }
  // en euros, ce que l'entreprise doit au fondateur est exactement l'opposé du solde suivi sur son compte perso
  assert.equal(book.partners.fo.netCents, -book.accounts.fo_eur.balanceCents);

  // Identité en euros : 5 000,00 - 80,00 - 75,82 = 4 844,18 = -662,27 + 266,45 + 5 240,00
  assert.equal(book.checks.businessFlowCents, 484418);
  assert.equal(-66227 + 26645 + 524000, 484418);
  assert.equal(book.checks.identityDiffCents, 0);
  // Trésorerie affichée : le solde réel du compte en dollars, 6 005,23 $, au dernier taux connu (1,25) = 4 804,184 EUR
  assert.equal(book.businessCashCents, 480418);
  assert.equal(book.businessCashApprox, true);

  // Partage de la perte : 662,27 x 60 % = 397,362 ; x 40 % = 264,908 ; le centime restant va au plus grand reste (0,8)
  assert.deepEqual(book.sharePeriods[0].perPartner, { fo: -39736, inv: -26491 });
  assert.equal(book.partners.fo.equityCents, 26645 - 39736);
  assert.equal(book.partners.inv.equityCents, 524000 - 26491);
  assert.equal(book.todo.estimated, 3);
});

// ---------------------------------------------------------------------------------------------
// 3. Le cas réel : lancement le 29 septembre 2026, deux associés à 50/50 jusqu'au 13 novembre,
//    un troisième arrive le 14 novembre avec un dépôt d'argent, puis partage à 40/40/20.

function ownerConfig(overrides = {}) {
  return {
    business: { name: "StarringYou", baseCurrency: "USD", startDate: "2026-09-29", ...(overrides.business || {}) },
    partners: {
      f: { name: "Fondateur", role: "founder", order: 0 },
      a: { name: "Associée", role: "partner", order: 1 },
      i: { name: "Investisseur", role: "investor", order: 2, joinedOn: "2026-11-14" },
    },
    accounts: {
      perso_f: { name: "Compte perso du fondateur", owner: "f", currency: "USD", order: 0 },
      perso_a: { name: "Carte de l'associée", kind: "card", owner: "a", currency: "USD", order: 1 },
      biz: { name: "Slash (entreprise)", owner: "business", currency: "USD", order: 2 },
      card_i: { name: "Carte de l'investisseur", kind: "card", owner: "i", currency: "USD", cards: ["0562"], order: 3 },
      bank_i: { name: "Banque de l'investisseur", owner: "i", currency: "USD", order: 4 },
    },
    shareRules: {
      r1: { from: null, shares: { f: 50, a: 50 } },
      r2: { from: "2026-11-14", shares: { f: 40, a: 40, i: 20 } },
    },
    ...(overrides.top || {}),
  };
}

const OWNER_OPS = [
  // À deux (du 29 septembre au 13 novembre) : tout est payé avec de l'argent personnel
  pl("p1", "2026-09-29", -3900, "perso_f", "shopify_sub", { label: "Abonnement Shopify" }),
  pl("p2", "2026-10-05", -50000, "perso_f", "ads_meta", { label: "Facebook Ads", party: "Meta Platforms" }),
  pl("p3", "2026-10-12", -30000, "perso_a", "ads_tiktok", { label: "TikTok Ads" }),
  pl("p4", "2026-10-20", 62000, "perso_f", null, {
    label: "Virement Shopify", source: "shopify",
    splits: [{ categoryId: "sales_shopify", amountCents: 70000 }, { categoryId: "refunds", amountCents: -5000 }, { categoryId: "fees_payment", amountCents: -3000 }],
  }),
  pl("p5", "2026-11-03", -4500, "perso_f", "email_sms", {
    label: "Klaviyo, abonnement novembre", party: "Klaviyo Inc", reconciled: true,
    attachments: [{ id: "as_1", name: "klaviyo.pdf", type: "application/pdf", size: 1000 }],
  }),
  pl("p6", "2026-11-10", -12001, "perso_a", "production_ai", { label: "Rendu vidéo", needsReview: true }),
  // À trois (depuis le 14 novembre) : le troisième associé dépose 10 000,00 $ et paie la pub
  tr("q1", "2026-11-14", 1000000, "bank_i", "biz", { label: "Apport" }),
  pl("q2", "2026-11-15", -80000, "card_i", "ads_meta", { label: "Facebook Ads", card: "0562" }),
  pl("q3", "2026-11-16", -9477, "biz", "ads_applovin", { label: "AppLovin", party: "Applovin Corporation", ref: "1182-9784" }),
  pl("q4", "2026-11-18", 250000, "biz", null, {
    label: "Virement Shopify", source: "shopify",
    splits: [{ categoryId: "sales_shopify", amountCents: 270000 }, { categoryId: "refunds", amountCents: -10000 }, { categoryId: "fees_payment", amountCents: -10000 }],
  }),
  tr("q5", "2026-11-19", 10000, "biz", "perso_f", { label: "Remboursement" }),
  pl("q6", "2026-11-20", -15000, "perso_f", "ads_tiktok", { label: "TikTok Ads" }),
];

test("cas réel à trois associés : le bénéfice de chaque période est partagé selon la règle en vigueur", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);

  // Période 1 (50/50) : -39,00 - 500,00 - 300,00 + 620,00 - 45,00 - 120,01 = -384,01 : une perte
  // Période 2 (40/40/20) : -800,00 - 94,77 + 2 500,00 - 150,00 = 1 455,23 : un bénéfice
  assert.equal(-3900 - 50000 - 30000 + 62000 - 4500 - 12001, -38401);
  assert.equal(-80000 - 9477 + 250000 - 15000, 145523);
  assert.deepEqual(book.sharePeriods, [
    {
      index: 0, ruleId: "r1", from: null, to: "2026-11-13", startsOn: "2026-09-29",
      shares: { f: 50, a: 50 }, sharesTotal: 100, equal: false, partnerCount: 2,
      profitCents: -38401,
      // 384,01 / 2 = 192,005 chacun : 192,00 + 192,00, et le centime restant va au premier associé (restes égaux)
      perPartner: { f: -19201, a: -19200 },
      allocatedCents: -38401, unallocatedCents: 0,
    },
    {
      index: 1, ruleId: "r2", from: "2026-11-14", to: null, startsOn: "2026-11-14",
      shares: { f: 40, a: 40, i: 20 }, sharesTotal: 100, equal: false, partnerCount: 3,
      profitCents: 145523,
      // 1 455,23 x 40 % = 582,092 (deux fois) ; x 20 % = 291,046 : 582,09 + 582,09 + 291,04 = 1 455,22
      // le centime restant va au plus grand reste : 0,6 pour le troisième associé
      perPartner: { f: 58209, a: 58209, i: 29105 },
      allocatedCents: 145523, unallocatedCents: 0,
    },
  ]);
  assert.equal(book.profitCents, 107122); // -384,01 + 1 455,23 = 1 071,22

  // Fondateur : a avancé 39,00 + 500,00 + 45,00 + 150,00 = 734,00 ; a encaissé 620,00 ; a été remboursé de 100,00
  assert.deepEqual(figures(book, "f"), [1400, 73400, 62000, 0, 10000, 0]);
  // Associée : a avancé 300,00 + 120,01
  assert.deepEqual(figures(book, "a"), [42001, 42001, 0, 0, 0, 0]);
  // Investisseur : a déposé 10 000,00 à son arrivée et avancé 800,00 de pub
  assert.deepEqual(figures(book, "i"), [1080000, 80000, 0, 1000000, 0, 0]);

  // Part du bénéfice de chacun : somme des deux périodes
  assert.equal(book.partners.f.profitShareCents, -19201 + 58209);
  assert.equal(book.partners.f.profitShareCents, 39008);
  assert.equal(book.partners.a.profitShareCents, -19200 + 58209);
  assert.equal(book.partners.a.profitShareCents, 39009);
  assert.equal(book.partners.i.profitShareCents, 29105); // rien pour la période où il n'était pas là
  assert.equal(39008 + 39009 + 29105, 107122);

  // Ce qui revient à chacun : ce que l'entreprise lui doit + sa part du bénéfice
  assert.equal(book.partners.f.equityCents, 1400 + 39008);
  assert.equal(book.partners.a.equityCents, 42001 + 39009);
  assert.equal(book.partners.i.equityCents, 1080000 + 29105);
  assert.deepEqual([book.partners.f.equityCents, book.partners.a.equityCents, book.partners.i.equityCents], [40408, 81010, 1109105]);
  // parts en vigueur aujourd'hui
  assert.deepEqual([book.partners.f.sharePct, book.partners.a.sharePct, book.partners.i.sharePct], [40, 40, 20]);

  // Compte de l'entreprise : 10 000,00 - 94,77 + 2 500,00 - 100,00 = 12 305,23
  assert.equal(book.accounts.biz.balanceCents, 1230523);
  assert.equal(book.businessCashCents, 1230523);
  // identité : 12 305,23 = 1 071,22 + 14,00 + 420,01 + 10 800,00
  assert.equal(107122 + 1400 + 42001 + 1080000, 1230523);
  // et tout l'argent de l'entreprise revient à quelqu'un : 404,08 + 810,10 + 11 091,05
  assert.equal(40408 + 81010 + 1109105, 1230523);
  assert.deepEqual(book.checks, {
    identityDiffCents: 0, businessFlowCents: 1230523, partnersNetCents: 1123401, sharesTotal: 100, shareProblems: [], skippedOps: 0,
  });
  assert.deepEqual(Object.keys(book.partners), ["f", "a", "i"]);
  assert.deepEqual(book.todo, {
    uncategorized: 0, needsReview: 1, estimated: 0, noAttachment: 7, unknownOwnerAccountIds: [], missingAccountIds: [],
  });
  // chaque opération connaît sa période de partage
  assert.deepEqual(book.ops.map((op) => [op.id, op.sharePeriod]), [
    ["q6", 1], ["q5", 1], ["q4", 1], ["q3", 1], ["q2", 1], ["q1", 1], ["p6", 0], ["p5", 0], ["p4", 0], ["p3", 0], ["p2", 0], ["p1", 0],
  ]);
});

test("cas réel : le bénéfice d'une période de partage est celui du résumé sur les mêmes dates", () => {
  const config = normalizeConfig(ownerConfig());
  const book = buildBook(config, OWNER_OPS);
  const today = "2026-11-21";
  const first = resolvePeriod("share:r1", config, today);
  const second = resolvePeriod("share:r2", config, today);
  assert.equal(first.label, "À 2 associés (du 29 sept. au 13 nov.)");
  assert.equal(second.label, "À 3 associés (depuis le 14 nov.)");
  const s1 = summarize(book, first);
  const s2 = summarize(book, second);
  assert.equal(s1.profitCents, -38401);
  assert.equal(s2.profitCents, 145523);
  assert.equal(s1.profitCents, book.sharePeriods[0].profitCents);
  assert.equal(s2.profitCents, book.sharePeriods[1].profitCents);
  // la période 1 couvre aussi une opération datée avant le lancement
  const early = buildBook(config, [...OWNER_OPS, pl("p0", "2026-09-10", -10000, "perso_f", "legal_admin")]);
  assert.equal(early.sharePeriods[0].profitCents, -48401);
  assert.equal(summarize(early, resolvePeriod("share:r1", config, today)).profitCents, -48401);
  assert.equal(early.byId.get("p0").sharePeriod, 0);
});

test("cas réel : part de chacun sur une période choisie (profitShares)", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  // sans filtre : identique au livre
  const all = profitShares(book);
  assert.equal(all.profitCents, 107122);
  assert.deepEqual(all.perPartner, { f: 39008, a: 39009, i: 29105 });
  assert.deepEqual(all.periods, book.sharePeriods);
  // depuis l'arrivée du troisième associé
  const since = profitShares(book, { from: "2026-11-14" });
  assert.equal(since.profitCents, 145523);
  assert.deepEqual(since.perPartner, { f: 58209, a: 58209, i: 29105 });
  assert.deepEqual(since.periods.map((p) => p.profitCents), [0, 145523]);
  // octobre seul : -500,00 - 300,00 + 620,00 = -180,00, partagé à 50/50
  const october = profitShares(book, { month: "2026-10" });
  assert.equal(october.profitCents, -18000);
  assert.deepEqual(october.perPartner, { f: -9000, a: -9000, i: 0 });
  // novembre en entier, à cheval sur les deux règles : -45,00 - 120,01 = -165,01 à 50/50, puis 1 455,23 à 40/40/20
  const november = profitShares(book, { month: "2026-11" });
  assert.deepEqual(november.periods.map((p) => p.profitCents), [-16501, 145523]);
  assert.deepEqual(november.periods[0].perPartner, { f: -8251, a: -8250 });
  assert.deepEqual(november.perPartner, { f: -8251 + 58209, a: -8250 + 58209, i: 29105 });
  assert.equal(sum(Object.values(november.perPartner)), -16501 + 145523);
});

test("parts qui ne font pas 100 % : signalées, et la partie non attribuée reste visible", () => {
  const config = ownerConfig();
  config.shareRules.r2 = { from: "2026-11-14", shares: { f: 40, a: 40, i: 10 } };
  const book = buildBook(config, OWNER_OPS);
  assert.deepEqual(book.checks.shareProblems, [
    { index: 1, ruleId: "r2", from: "2026-11-14", to: null, startsOn: "2026-11-14", sharesTotal: 90 },
  ]);
  assert.equal(book.checks.sharesTotal, 90);
  // 1 455,23 x 40 % = 582,092 ; x 10 % = 145,523 ; attribué : 90 % = 1 309,707 arrondi à 1 309,71
  // 582,09 + 582,09 + 145,52 = 1 309,70 : le centime restant va au plus grand reste (0,3 pour le troisième)
  assert.deepEqual(book.sharePeriods[1].perPartner, { f: 58209, a: 58209, i: 14553 });
  assert.equal(book.sharePeriods[1].allocatedCents, 130971);
  assert.equal(book.sharePeriods[1].unallocatedCents, 14552);
  assert.equal(book.checks.identityDiffCents, 0);
  // la période correcte n'est pas signalée
  assert.equal(book.sharePeriods[0].unallocatedCents, 0);
});

test("sans règle datée : parts sharePct, ou parts égales entre associés actifs", () => {
  const ops = [pl("o1", "2026-10-01", 10000, "biz", "sales_other")];
  const accounts = { biz: { name: "Entreprise", owner: "business", currency: "USD" } };
  // parts égales à trois : 100,00 / 3 = 33,34 + 33,33 + 33,33
  const equal = buildBook({ accounts, partners: { a: { name: "A", order: 0 }, b: { name: "B", order: 1 }, c: { name: "C", order: 2 }, old: { name: "Ancien", order: 3, archived: true } } }, ops);
  assert.deepEqual(equal.sharePeriods[0].perPartner, { a: 3334, b: 3333, c: 3333 });
  assert.equal(equal.sharePeriods[0].equal, true);
  assert.equal(equal.partners.old.profitShareCents, 0);
  assert.equal(equal.partners.old.sharePct, 0);
  assert.deepEqual(equal.checks.shareProblems, []);
  assert.equal(equal.checks.sharesTotal, 100);
  // parts sharePct qui ne font pas 100 : 60 + 30 = 90
  const pctBook = buildBook({ accounts, partners: { a: { name: "A", sharePct: 60, order: 0 }, b: { name: "B", sharePct: 30, order: 1 } } }, ops);
  assert.deepEqual(pctBook.sharePeriods[0].perPartner, { a: 6000, b: 3000 });
  assert.equal(pctBook.sharePeriods[0].unallocatedCents, 1000);
  assert.deepEqual(pctBook.checks.shareProblems, [{ index: 0, ruleId: null, from: null, to: null, startsOn: null, sharesTotal: 90 }]);
  // aucun associé : rien à partager, rien à signaler
  const nobody = buildBook({ accounts }, ops);
  assert.deepEqual(nobody.sharePeriods[0].perPartner, {});
  assert.deepEqual(nobody.checks.shareProblems, []);
  assert.deepEqual(nobody.partners, {});
  // une règle vide alors qu'il y a des associés : signalée
  const empty = buildBook({ accounts, partners: { a: { name: "A" } }, shareRules: { r: { from: null, shares: {} } } }, ops);
  assert.equal(empty.checks.shareProblems.length, 1);
  assert.equal(empty.checks.shareProblems[0].sharesTotal, 0);
  // une règle qui nomme un associé absent des réglages : sa part est quand même calculée
  const ghost = buildBook({ accounts, partners: { a: { name: "A" } }, shareRules: { r: { from: null, shares: { a: 70, parti: 30 } } } }, ops);
  assert.deepEqual(ghost.sharePeriods[0].perPartner, { a: 7000, parti: 3000 });
  assert.equal(ghost.partners.parti.equityCents, 3000);
});

// ---------------------------------------------------------------------------------------------
// 4. Répartition au plus fort reste

test("allocateByShares : la somme est exacte, les centimes restants vont aux plus grands restes", () => {
  // 0,07 à 50/30/20 : 3,5 + 2,1 + 1,4 : 3 + 2 + 1 = 6, le centime restant va au reste 0,5
  assert.deepEqual(allocateByShares(7, { a: 50, b: 30, c: 20 }), { a: 4, b: 2, c: 1 });
  // une perte se partage comme un bénéfice, avec le signe moins
  assert.deepEqual(allocateByShares(-7, { a: 50, b: 30, c: 20 }), { a: -4, b: -2, c: -1 });
  // restes égaux : la plus grosse part d'abord, puis l'ordre donné
  assert.deepEqual(allocateByShares(1, { a: 50, b: 50 }), { a: 1, b: 0 });
  assert.deepEqual(allocateByShares(1, { a: 50, b: 50 }, { order: ["b", "a"] }), { b: 1, a: 0 });
  assert.deepEqual(allocateByShares(-1, { a: 50, b: 50 }), { a: -1, b: 0 });
  assert.deepEqual(allocateByShares(1, { a: 25, b: 75 }), { a: 0, b: 1 });
  // parts strictement égales à trois
  assert.deepEqual(allocateByShares(100, { a: 33.33, b: 33.33, c: 33.33 }, { equal: true }), { a: 34, b: 33, c: 33 });
  assert.deepEqual(allocateByShares(10000, { a: 33.33, b: 33.33, c: 33.34 }), { a: 3333, b: 3333, c: 3334 });
  // une part à zéro ne reçoit rien
  assert.deepEqual(allocateByShares(999, { a: 60, b: 40, c: 0 }), { a: 599, b: 400, c: 0 });
  // total des parts différent de 100 : chacun reçoit son pourcentage, pas plus
  assert.deepEqual(allocateByShares(1000, { a: 40, b: 40, c: 10 }), { a: 400, b: 400, c: 100 });
  assert.deepEqual(allocateByShares(1000, { a: 80, b: 40 }), { a: 800, b: 400 });
  // très gros montant : 1 234 567 890,12 à 40/40/20, sans erreur d'arrondi
  assert.deepEqual(allocateByShares(123456789012, { a: 40, b: 40, c: 20 }), { a: 49382715605, b: 49382715605, c: 24691357802 });
  assert.equal(49382715605 + 49382715605 + 24691357802, 123456789012);
  // cas limites
  assert.deepEqual(allocateByShares(0, { a: 50, b: 50 }), { a: 0, b: 0 });
  assert.deepEqual(allocateByShares(500, {}), {});
  assert.deepEqual(allocateByShares(500, null), {});
  assert.deepEqual(allocateByShares(500, { a: 100 }), { a: 500 });
  assert.deepEqual(allocateByShares(500, { a: 50, b: -3, c: NaN, d: "x", e: 50 }), { a: 250, e: 250 });
  for (const value of Object.values(allocateByShares(0, { a: 50, b: 50 }))) assert.ok(Object.is(value, 0));
  for (const value of Object.values(allocateByShares(-1, { a: 50, b: 50 }))) assert.ok(!Object.is(value, -0));
});

test("allocateByShares : pour des parts qui font 100 %, la somme est toujours le montant de départ", () => {
  const rnd = mulberry32(2026);
  for (let n = 0; n < 2000; n++) {
    const count = 1 + Math.floor(rnd() * 5);
    // parts au centième de point, qui font exactement 100,00
    const cuts = Array.from({ length: count - 1 }, () => Math.floor(rnd() * 10001)).sort((a, b) => a - b);
    const shares = {};
    let previous = 0;
    for (let i = 0; i < count; i++) {
      const end = i === count - 1 ? 10000 : cuts[i];
      shares["p" + i] = (end - previous) / 100;
      previous = end;
    }
    const total = Math.floor((rnd() - 0.5) * 2e9);
    const out = allocateByShares(total, shares);
    assert.equal(sum(Object.values(out)), total, JSON.stringify({ total, shares }));
    for (const id of Object.keys(shares)) {
      const exact = (total * shares[id]) / 100;
      assert.ok(Math.abs(out[id] - exact) < 1, "chacun reste à moins d'un centime de sa quote-part exacte");
      if (total !== 0 && out[id] !== 0) assert.equal(Math.sign(out[id]), Math.sign(total));
    }
    // parts égales
    const equal = allocateByShares(total, shares, { equal: true });
    assert.equal(sum(Object.values(equal)), total);
    const values = Object.values(equal);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1);
  }
});

// ---------------------------------------------------------------------------------------------
// 5. L'identité comptable sur des livres aléatoires

const RANDOM_OWNERS = {
  biz_usd: "business", biz_eur: "business", p1_usd: "p1", p1_eur: "p1", p2_usd: "p2", p3_eur: "p3",
  unk: "unknown", dangling: "unknown", missing_acc: "unknown",
};
const RANDOM_ACCOUNT_IDS = Object.keys(RANDOM_OWNERS);
const RANDOM_CATEGORIES = [
  "sales_shopify", "sales_other", "refunds", "ads_meta", "ads_tiktok", "ads_applovin", "fees_payment", "email_sms", "software",
  "bank_fees", "other_expense", null, "ghost_cat",
];

function randomLedger(seed, { single = false, count = null } = {}) {
  const rnd = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const chance = (p) => rnd() < p;
  const currency = () => (single ? "USD" : pick(["USD", "USD", "EUR", "EUR", "GBP"]));
  const other = single ? "USD" : "EUR";
  const accountCurrency = {
    biz_usd: "USD", biz_eur: other, p1_usd: "USD", p1_eur: other, p2_usd: "USD", p3_eur: other, unk: "USD", dangling: other,
  };
  const config = {
    business: { baseCurrency: "USD", startDate: "2026-08-01" },
    partners: {
      p1: { name: "Un", order: 0 },
      p2: { name: "Deux", order: 1 },
      p3: { name: "Trois", order: 2, archived: chance(0.2) },
    },
    accounts: {
      biz_usd: { name: "Entreprise USD", owner: "business", currency: "USD", openingCents: int(0, 500000) },
      biz_eur: { name: "Entreprise EUR", owner: "business", currency: other, openingCents: int(0, 100000) },
      p1_usd: { name: "P1 USD", owner: "p1", currency: "USD", openingCents: 12345 },
      p1_eur: { name: "P1 EUR", owner: "p1", currency: other },
      p2_usd: { name: "P2 USD", owner: "p2", currency: "USD" },
      p3_eur: { name: "P3 EUR", owner: "p3", currency: other },
      unk: { name: "Carte inconnue", owner: "unknown", currency: "USD" },
      dangling: { name: "Compte d'un associé disparu", owner: "plus_la", currency: other },
    },
    fx: single ? {} : {
      EUR: { default: 1.1, months: { "2026-08": 1.05 + rnd() * 0.2, "2026-10": 1.05 + rnd() * 0.2, "2026-12": 1.05 + rnd() * 0.2 } },
      GBP: { default: 1.2 + rnd() * 0.2, months: {} },
    },
    shareRules: {},
  };
  const variant = seed % 4;
  if (variant === 1) config.shareRules = { r1: { from: null, shares: { p1: 50, p2: 30, p3: 20 } } };
  if (variant === 2) {
    config.shareRules = { r1: { from: null, shares: { p1: 50, p2: 50 } }, r2: { from: "2026-10-14", shares: { p1: 40, p2: 40, p3: 20 } } };
  }
  if (variant === 3) {
    config.shareRules = {
      r1: { from: "2026-08-15", shares: { p1: 33.33, p2: 33.33, p3: 33.34 } },
      r2: { from: "2026-09-20", shares: { p1: 40, p2: 40, p3: 10 } }, // ne fait pas 100
      r3: { from: "2026-11-05", shares: { p1: 12.5, p2: 62.5, p3: 25 } },
    };
  }

  const ops = [];
  const total = count || int(30, 90);
  for (let n = 0; n < total; n++) {
    const date = addDays("2026-08-01", int(0, 152));
    const id = "r" + seed + "_" + n;
    const account = () => (chance(0.03) ? undefined : pick(RANDOM_ACCOUNT_IDS));
    if (chance(0.7)) {
      const amountCents = chance(0.03) ? 0 : chance(0.7) ? -int(1, 300000) : int(1, 500000);
      const op = { id, kind: "pl", date, amountCents, currency: currency(), accountId: account(), categoryId: pick(RANDOM_CATEGORIES) };
      if (!single && amountCents !== 0 && chance(0.3)) op.settledCents = Math.sign(amountCents) * int(1, 400000);
      if (chance(0.25)) {
        const parts = [];
        let left = amountCents;
        for (let k = int(1, 3); k > 0; k--) {
          const part = int(-200000, 200000);
          parts.push({ categoryId: pick(RANDOM_CATEGORIES), amountCents: part });
          left -= part;
        }
        // une fois sur six la répartition est incomplète (elle ne fait pas le montant de l'opération)
        parts.push({ categoryId: pick(RANDOM_CATEGORIES), amountCents: chance(0.17) ? left + int(1, 5000) : left });
        op.splits = parts;
      }
      ops.push(op);
    } else {
      const op = { id, kind: "transfer", date, amountCents: chance(0.03) ? 0 : int(1, 800000), currency: currency(), fromAccountId: account(), toAccountId: account() };
      if (!single && chance(0.3)) op.toAmountCents = int(1, 900000);
      ops.push(op);
    }
  }
  // des opérations illisibles se glissent dans le lot
  ops.push(null, { id: "bad_" + seed, kind: "pl", date: "2026-02-30", amountCents: 5, currency: "USD" }, { id: "", kind: "pl" });
  return { config, ops, accountCurrency, readable: total };
}

/** Vérifie un livre en recalculant tout indépendamment à partir des règles du cahier des charges. */
function checkBook(book, config, accountCurrency, coverage) {
  const base = book.base;
  const cfg = book.config;
  const owner = (accountId) => RANDOM_OWNERS[accountId] || "unknown";
  let profit = 0;
  let flow = 0;
  const nets = {};
  const add = (id, cents) => { nets[id] = (nets[id] || 0) + cents; };
  const fromEffects = {};

  for (const op of book.ops) {
    for (const e of op.effects) fromEffects[e.partnerId] = (fromEffects[e.partnerId] || 0) + e.cents;
    if (op.kind === "pl") {
      // montant de base : même devise, sinon montant débité connu sur un compte dans la devise de base, sinon conversion
      const settledOk = Number.isInteger(op.settledCents) && op.settledCents !== 0 && Math.sign(op.settledCents) === Math.sign(op.amountCents);
      let expected;
      if (op.currency === base) expected = op.amountCents;
      else if (settledOk && accountCurrency[op.accountId] === base) expected = op.settledCents;
      else expected = convert(op.amountCents, op.currency, base, op.date, cfg).cents;
      assert.equal(op.baseCents, expected, "montant de base de " + op.id);
      assert.equal(op.fxEstimated, op.currency !== base && !(settledOk && accountCurrency[op.accountId] === base));
      // les lignes font exactement le montant de l'opération
      assert.ok(op.lines.length >= 1);
      assert.equal(sum(op.lines.map((l) => l.baseCents)), op.baseCents, "lignes de " + op.id);
      assert.equal(sum(op.lines.map((l) => l.amountCents)), op.amountCents);
      if (op.splits) coverage.splits++;
      if (op.splits && sum(op.splits.map((s) => s.amountCents)) !== op.amountCents) coverage.badSplits++;
      const o = owner(op.accountId);
      assert.equal(op.ownerId, o);
      profit += op.baseCents;
      if (o === "business") flow += op.baseCents;
      else add(o, -op.baseCents);
      if (o === "unknown") coverage.unknownPl++;
      if (op.accountId === "missing_acc") coverage.missing++;
      if (op.accountId === undefined) coverage.noAccount++;
      coverage.currencies.add(op.currency);
    } else {
      const arrived = Number.isInteger(op.toAmountCents) && op.toAmountCents > 0 ? op.toAmountCents : null;
      let expected;
      if (op.currency === base) expected = op.amountCents;
      else if (arrived !== null && accountCurrency[op.toAccountId] === base) expected = arrived;
      else expected = convert(op.amountCents, op.currency, base, op.date, cfg).cents;
      assert.equal(op.baseCents, expected, "valeur de base de " + op.id);
      const fo = owner(op.fromAccountId);
      const to = owner(op.toAccountId);
      coverage.combos.add(fo + ">" + to);
      const value = op.baseCents;
      if (fo === to) {
        assert.deepEqual(op.effects, []);
      } else if (to === "business") {
        flow += value;
        add(fo, value);
      } else if (fo === "business") {
        flow -= value;
        add(to, -value);
      } else {
        add(fo, value);
        add(to, -value);
      }
    }
  }

  // L'identité du cahier des charges, recalculée par le test : flux des comptes de l'entreprise = bénéfice + comptes d'associés
  assert.equal(flow, profit + sum(Object.values(nets)));
  // et le livre trouve les mêmes chiffres
  assert.equal(book.profitCents, profit);
  assert.equal(book.checks.businessFlowCents, flow);
  assert.equal(book.checks.identityDiffCents, 0);
  assert.equal(book.checks.partnersNetCents, sum(Object.values(nets)));
  for (const id of Object.keys(nets)) {
    assert.ok(book.partners[id], "position de " + id);
    assert.equal(book.partners[id].netCents, nets[id], "net de " + id);
    assert.equal(fromEffects[id] || 0, nets[id]);
  }
  let shareTotal = 0;
  for (const id of Object.keys(book.partners)) {
    const p = book.partners[id];
    assert.equal(p.netCents, nets[id] || 0);
    assert.equal(p.netCents, p.advancedCents - p.collectedCents + p.contributedCents - p.withdrawnCents - p.settledCents);
    assert.equal(p.equityCents, p.netCents + p.profitShareCents);
    assert.equal(sum(p.entries.map((e) => e.effectCents)), p.netCents);
    assert.ok(p.advancedCents >= 0 && p.collectedCents >= 0 && p.contributedCents >= 0 && p.withdrawnCents >= 0);
    shareTotal += p.profitShareCents;
    const statement = partnerStatement(book, id);
    assert.equal(statement.closingCents, p.netCents);
    assert.equal(statement.entries.length, p.entries.length);
  }
  // les règlements entre associés s'annulent
  assert.equal(sum(Object.values(book.partners).map((p) => p.settledCents)), 0);

  // Partage : les périodes couvrent tout le bénéfice, et une période dont les parts font 100 % le répartit au centime près
  assert.equal(sum(book.sharePeriods.map((p) => p.profitCents)), profit);
  let allocated = 0;
  for (const period of book.sharePeriods) {
    const given = sum(Object.values(period.perPartner));
    assert.equal(given, period.allocatedCents);
    assert.equal(period.allocatedCents + period.unallocatedCents, period.profitCents);
    if (period.sharesTotal === 100) assert.equal(given, period.profitCents);
    else coverage.badShares++;
    allocated += given;
    assert.equal(summarize(book, { from: period.from, to: period.to }).profitCents, period.profitCents);
  }
  assert.equal(shareTotal, allocated);

  // Résumés cohérents avec le livre
  const s = summarize(book);
  assert.equal(s.profitCents, profit);
  assert.equal(s.incomeCents - s.expenseCents, profit);
  assert.equal(sum(Object.values(s.byCategory)), profit);
  assert.equal(sum(Object.values(s.byGroup)), profit);
  assert.equal(sum(Object.values(s.adSpendByPlatform)), s.adSpendCents);
  assert.equal(sum(Object.values(s.byPayer).map((p) => p.paidCents)), s.expenseCents);
  assert.equal(sum(Object.values(s.byPayer).map((p) => p.receivedCents)), s.incomeCents);
  const series = monthlySeries(book);
  assert.equal(sum(series.map((m) => m.profitCents)), profit);
  assert.equal(sum(series.map((m) => m.opCount)), s.opCount);

  // Les compteurs "à faire" sont exactement ce que les filtres correspondants renvoient
  assert.equal(filterOps(book, {}).length, book.ops.length);
  assert.equal(filterOps(book, { kind: "pl" }).length + filterOps(book, { kind: "transfer" }).length, book.ops.length);
  assert.equal(filterOps(book, { uncategorized: true }).length, book.todo.uncategorized);
  assert.equal(filterOps(book, { noAttachment: true }).length, book.todo.noAttachment);
  assert.equal(filterOps(book, { fxEstimated: true }).length, book.todo.estimated);
  assert.equal(filterOps(book, { needsReview: true }).length, book.todo.needsReview);
  assert.deepEqual(book.months, Array.from(new Set(book.ops.map((op) => op.month))).sort());

  // Relevés de compte : le solde final est celui du livre
  for (const id of ["biz_usd", "biz_eur", "p1_eur", "missing_acc"]) {
    if (!book.accounts[id]) continue;
    const st = accountStatement(book, id);
    assert.equal(st.closingCents, book.accounts[id].balanceCents);
    assert.equal(st.entries.length ? st.entries[st.entries.length - 1].balanceCents : st.openingCents, book.accounts[id].balanceCents);
  }
  return { profit, nets, flow };
}

test("identité comptable sur 240 livres aléatoires, en USD et en EUR à partir des mêmes données", () => {
  const coverage = { combos: new Set(), currencies: new Set(), splits: 0, badSplits: 0, unknownPl: 0, missing: 0, noAccount: 0, badShares: 0 };
  let books = 0;
  for (let seed = 1; seed <= 240; seed++) {
    const { config, ops, accountCurrency, readable } = randomLedger(seed);
    const byBase = {};
    for (const baseCurrency of ["USD", "EUR"]) {
      const cfg = { ...config, business: { ...config.business, baseCurrency } };
      const book = buildBook(cfg, ops);
      assert.equal(book.base, baseCurrency);
      assert.equal(book.ops.length, readable);
      assert.equal(book.checks.skippedOps, 3);
      checkBook(book, cfg, accountCurrency, coverage);
      byBase[baseCurrency] = book;
      books++;
    }
    // Changer de devise de base ne change ni les soldes des comptes (dans leur devise), ni le classement, ni qui doit à qui en signe de détail
    const usd = byBase.USD;
    const eur = byBase.EUR;
    assert.deepEqual(ids(usd.ops), ids(eur.ops));
    for (const id of Object.keys(usd.accounts)) {
      assert.equal(usd.accounts[id].balanceCents, eur.accounts[id].balanceCents, "solde de " + id);
      assert.equal(usd.accounts[id].opCount, eur.accounts[id].opCount);
    }
    assert.deepEqual(Object.keys(usd.partners).sort(), Object.keys(eur.partners).sort());
    for (const id of Object.keys(usd.partners)) {
      assert.equal(usd.partners[id].entries.length, eur.partners[id].entries.length);
    }
    assert.deepEqual(usd.todo.missingAccountIds, eur.todo.missingAccountIds);
    assert.equal(usd.todo.uncategorized, eur.todo.uncategorized);
  }
  assert.equal(books, 480);
  // Ce que les tirages ont réellement couvert
  const owners = ["business", "p1", "p2", "p3", "unknown"];
  for (const from of owners) for (const to of owners) assert.ok(coverage.combos.has(from + ">" + to), "virement " + from + " > " + to);
  assert.deepEqual(Array.from(coverage.currencies).sort(), ["EUR", "GBP", "USD"]);
  assert.ok(coverage.splits > 500);
  assert.ok(coverage.badSplits > 50);
  assert.ok(coverage.unknownPl > 500);
  assert.ok(coverage.missing > 100);
  assert.ok(coverage.noAccount > 20);
  assert.ok(coverage.badShares > 50);
});

test("identité comptable avec les vrais soldes des comptes, sur 60 livres aléatoires en une seule devise", () => {
  const coverage = { combos: new Set(), currencies: new Set(), splits: 0, badSplits: 0, unknownPl: 0, missing: 0, noAccount: 0, badShares: 0 };
  for (let seed = 1001; seed <= 1060; seed++) {
    const { config, ops, accountCurrency } = randomLedger(seed, { single: true });
    const book = buildBook(config, ops);
    const { profit, nets } = checkBook(book, config, accountCurrency, coverage);
    // somme des comptes de l'entreprise, sans les soldes d'ouverture = bénéfice + comptes d'associés (y compris "unknown")
    let business = 0;
    for (const id of ["biz_usd", "biz_eur"]) business += book.accounts[id].balanceCents - book.config.accounts[id].openingCents;
    assert.equal(business, profit + sum(Object.values(nets)));
    // trésorerie affichée : avec les soldes d'ouverture, sans approximation
    assert.equal(book.businessCashCents, book.accounts.biz_usd.balanceCents + book.accounts.biz_eur.balanceCents);
    assert.equal(book.businessCashApprox, false);
    assert.equal(book.todo.estimated, 0);
    // un compte personnel n'a pas de solde d'ouverture : on ne suit que ses mouvements liés à l'entreprise
    assert.equal(book.accounts.p1_usd.openingCents, 0);
    // tout l'argent hors soldes d'ouverture revient à quelqu'un quand les parts font 100 %
    if (book.checks.shareProblems.length === 0 && Object.keys(book.sharePeriods[0].shares).length) {
      assert.equal(sum(Object.values(book.partners).map((p) => p.equityCents)), business);
    }
  }
  assert.deepEqual(Array.from(coverage.currencies), ["USD"]);
});

// ---------------------------------------------------------------------------------------------
// 6. Virement Shopify réparti

test("virement Shopify : une seule ligne de banque, mais ventes brutes, remboursements et frais séparés dans le bénéfice", () => {
  const config = { accounts: { biz: { name: "Entreprise", owner: "business", currency: "USD" } } };
  const payout = pl("pay1", "2026-11-18", 61250, "biz", null, {
    label: "Virement Shopify", source: "shopify", extId: "shopify:payout:1",
    meta: { payoutId: "1", grossCents: 70000, refundsCents: 3500, feesCents: 2400, adjustmentsCents: -2850 },
    splits: [
      { categoryId: "sales_shopify", amountCents: 70000 },
      { categoryId: "refunds", amountCents: -3500 },
      { categoryId: "fees_payment", amountCents: -2400 },
      { categoryId: "chargebacks", amountCents: -2850 },
    ],
  });
  assert.equal(70000 - 3500 - 2400 - 2850, 61250);
  const book = buildBook(config, [payout]);
  assert.equal(book.ops.length, 1);
  assert.equal(book.accounts.biz.balanceCents, 61250);
  assert.equal(book.accounts.biz.opCount, 1);
  assert.equal(book.ops[0].baseCents, 61250);
  assert.equal(book.ops[0].nature, "income");
  assert.deepEqual(book.ops[0].lines.map((l) => [l.categoryId, l.baseCents, l.group, l.kind]), [
    ["sales_shopify", 70000, "sales", "income"], ["refunds", -3500, "sales", "income"],
    ["fees_payment", -2400, "platform", "expense"], ["chargebacks", -2850, "platform", "expense"],
  ]);
  assert.equal(book.todo.uncategorized, 0);
  const s = summarize(book);
  assert.equal(s.grossSalesCents, 70000);
  assert.equal(s.refundsCents, 3500);
  assert.equal(s.salesCents, 66500); // ventes nettes : 700,00 - 35,00
  assert.equal(s.feesCents, 2400);
  assert.equal(s.incomeCents, 66500);
  assert.equal(s.expenseCents, 5250); // frais 24,00 + litige 28,50
  assert.equal(s.profitCents, 61250);
  assert.equal(s.opCount, 1);
  assert.deepEqual(s.byCategory, { sales_shopify: 70000, refunds: -3500, fees_payment: -2400, chargebacks: -2850 });
  assert.deepEqual(s.byGroup, { sales: 66500, platform: -5250 });
  assert.deepEqual(s.byPayer, { business: { paidCents: 5250, receivedCents: 66500 } });
  assert.equal(s.adSpendCents, 0);
  assert.equal(s.merRatio, null);
  assert.equal(s.marginPct, 92.1); // 612,50 / 665,00
  // un filtre de catégorie ne compte que la ligne concernée
  assert.equal(summarize(book, { categoryId: "fees_payment" }).profitCents, -2400);
  assert.equal(summarize(book, { categoryId: "fees_payment" }).opCount, 1);
  assert.equal(summarize(book, { group: "sales" }).profitCents, 66500);
  assert.equal(summarize(book, { group: "ads" }).opCount, 0);
  assert.deepEqual(ids(filterOps(book, { categoryId: "refunds" })), ["pay1"]);

  // Le même virement vu en euros (1 EUR = 1,07 USD) : 612,50 $ = 572,43 EUR
  // 700,00 -> 654,2057 ; -35,00 -> -32,7103 ; -24,00 -> -22,4299 ; -28,50 -> -26,6355 : 654,21 - 32,71 - 22,43 - 26,64 = 572,43
  const eur = buildBook({ ...config, business: { baseCurrency: "EUR" }, fx: { EUR: { default: 1.07, months: {} } } }, [payout]);
  assert.equal(eur.ops[0].baseCents, 57243);
  assert.equal(eur.ops[0].fxEstimated, true);
  assert.deepEqual(eur.ops[0].lines.map((l) => l.baseCents), [65421, -3271, -2243, -2664]);
  assert.equal(65421 - 3271 - 2243 - 2664, 57243);
  assert.equal(eur.accounts.biz.balanceCents, 61250); // le compte reste en dollars
  assert.equal(summarize(eur).salesCents, 65421 - 3271);
  assert.equal(summarize(eur).approx, true);
});

test("répartition incomplète, nulle ou sur une catégorie disparue : les lignes font toujours le montant de l'opération", () => {
  const config = { accounts: { biz: { name: "Entreprise", owner: "business", currency: "USD" } }, fx: { EUR: { default: 1.1, months: {} } } };
  const book = buildBook(config, [
    // 100,00 dont 60,00 et 30,00 classés : les 10,00 restants apparaissent en "non classé"
    pl("s1", "2026-10-01", -10000, "biz", "software", { splits: [{ categoryId: "ads_meta", amountCents: -6000 }, { categoryId: "software", amountCents: -3000 }] }),
    // opération à zéro en euros : +50,00 EUR et -50,00 EUR, soit +55,00 $ et -55,00 $
    pl("s2", "2026-10-02", 0, "biz", null, { currency: "EUR", splits: [{ categoryId: "sales_other", amountCents: 5000 }, { categoryId: "fees_payment", amountCents: -5000 }] }),
    // catégorie supprimée : la ligne est non classée, l'opération garde sa catégorie d'origine
    pl("s3", "2026-10-03", -700, "biz", "disparue"),
    pl("s4", "2026-10-04", 900, "biz", null),
  ]);
  assert.deepEqual(book.byId.get("s1").lines.map((l) => [l.categoryId, l.baseCents]), [["ads_meta", -6000], ["software", -3000], ["uncategorized", -1000]]);
  assert.deepEqual(book.byId.get("s2").lines.map((l) => [l.categoryId, l.baseCents, l.amountCents]), [["sales_other", 5500, 5000], ["fees_payment", -5500, -5000]]);
  assert.equal(book.byId.get("s2").baseCents, 0);
  assert.deepEqual(book.byId.get("s3").lines, [{ categoryId: "uncategorized", baseCents: -700, amountCents: -700, group: "uncategorized", kind: "expense" }]);
  assert.equal(book.byId.get("s3").categoryId, "disparue");
  assert.deepEqual(book.byId.get("s4").lines, [{ categoryId: "uncategorized", baseCents: 900, amountCents: 900, group: "uncategorized", kind: "income" }]);
  assert.equal(book.todo.uncategorized, 3);
  const s = summarize(book);
  // non classé : encaissement s'il est positif, dépense s'il est négatif
  assert.equal(s.uncategorizedInCents, 900);
  assert.equal(s.uncategorizedOutCents, 1700);
  assert.equal(s.byCategory.uncategorized, -800);
  assert.equal(s.byGroup.uncategorized, -800);
  assert.equal(s.incomeCents, 5500 + 900);
  assert.equal(s.expenseCents, 6000 + 3000 + 1000 + 5500 + 700);
  assert.equal(s.profitCents, -10000 + 0 - 700 + 900);
  assert.deepEqual(ids(filterOps(book, { uncategorized: true })), ["s4", "s3", "s1"]);
  assert.deepEqual(ids(filterOps(book, { uncategorized: false })), ["s2"]);
  assert.deepEqual(ids(filterOps(book, { categoryId: "uncategorized" })), ["s4", "s3", "s1"]);
  assert.equal(summarize(book, { uncategorized: true }).profitCents, -800);
});

// ---------------------------------------------------------------------------------------------
// 7. Résumés, séries mensuelles, périodes

test("summarize : tout l'historique du cas réel", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const s = summarize(book);
  // encaissements : 700,00 - 50,00 + 2 700,00 - 100,00 = 3 250,00
  // dépenses : 39,00 + 500,00 + 300,00 + 30,00 + 45,00 + 120,01 + 800,00 + 94,77 + 100,00 + 150,00 = 2 178,78
  assert.deepEqual(s, {
    incomeCents: 325000,
    expenseCents: 217878,
    profitCents: 107122,
    marginPct: 33, // 1 071,22 / 3 250,00 = 32,96 %
    salesCents: 325000,
    grossSalesCents: 340000,
    refundsCents: 15000,
    adSpendCents: 184477, // 500,00 + 300,00 + 800,00 + 94,77 + 150,00
    adSpendByPlatform: { meta: 130000, tiktok: 45000, applovin: 9477, google: 0, other: 0 },
    adSpendByPayer: { meta: { f: 50000, i: 80000 }, tiktok: { f: 15000, a: 30000 }, applovin: { business: 9477 }, google: {}, other: {} },
    feesCents: 13000,
    nonAdCostsCents: 33401, // 2 178,78 - 1 844,77
    byCategory: {
      ads_tiktok: -45000, sales_shopify: 340000, refunds: -15000, fees_payment: -13000, ads_applovin: -9477, ads_meta: -130000,
      production_ai: -12001, email_sms: -4500, shopify_sub: -3900,
    },
    byGroup: { ads: -184477, sales: 325000, platform: -16900, production: -12001, tools: -4500 },
    byPayer: {
      // fondateur : 39,00 + 500,00 + 30,00 de frais + 45,00 + 150,00 payés ; 700,00 - 50,00 reçus
      f: { paidCents: 76400, receivedCents: 65000 },
      business: { paidCents: 19477, receivedCents: 260000 },
      i: { paidCents: 80000, receivedCents: 0 },
      a: { paidCents: 42001, receivedCents: 0 },
    },
    uncategorizedInCents: 0,
    uncategorizedOutCents: 0,
    opCount: 10,
    merRatio: 325000 / 184477,
    breakEvenRoas: 325000 / 291599, // ventes / (ventes - coûts hors pub)
    approx: false,
  });
  assert.equal(76400 + 19477 + 80000 + 42001, s.expenseCents);
  assert.equal(65000 + 260000, s.incomeCents);
});

test("summarize : filtres de période, préréglages pivot et périodes de partage", () => {
  const config = normalizeConfig(ownerConfig({ business: { pivotDate: "2026-11-14" } }));
  const book = buildBook(config, OWNER_OPS);
  const today = "2026-11-21";

  const before = summarize(book, resolvePeriod("before_pivot", config, today));
  assert.equal(before.incomeCents, 65000);
  assert.equal(before.expenseCents, 103401); // 39,00 + 500,00 + 300,00 + 30,00 + 45,00 + 120,01
  assert.equal(before.profitCents, -38401);
  assert.equal(before.marginPct, -59.1);
  assert.equal(before.adSpendCents, 80000);
  assert.deepEqual(before.adSpendByPlatform, { meta: 50000, tiktok: 30000, applovin: 0, google: 0, other: 0 });
  assert.equal(before.merRatio, 0.8125); // 650,00 de ventes pour 800,00 de pub
  assert.equal(before.nonAdCostsCents, 23401);
  assert.equal(before.breakEvenRoas, 65000 / 41599);
  assert.equal(before.opCount, 6);

  const since = summarize(book, resolvePeriod("since_pivot", config, today));
  assert.equal(since.incomeCents, 260000);
  assert.equal(since.expenseCents, 114477); // 800,00 + 94,77 + 100,00 + 150,00
  assert.equal(since.profitCents, 145523);
  assert.equal(since.marginPct, 56);
  assert.deepEqual(since.adSpendByPlatform, { meta: 80000, tiktok: 15000, applovin: 9477, google: 0, other: 0 });
  assert.equal(since.merRatio, 260000 / 104477);
  assert.equal(since.breakEvenRoas, 1.04); // 2 600,00 / (2 600,00 - 100,00)
  assert.equal(since.opCount, 4);
  assert.equal(before.profitCents + since.profitCents, book.profitCents);

  // préréglages calendaires (aujourd'hui = 21 novembre 2026)
  assert.equal(summarize(book, resolvePeriod("this_month", config, today)).profitCents, -4500 - 12001 + 145523);
  assert.equal(summarize(book, resolvePeriod("last_month", config, today)).profitCents, -18000);
  assert.equal(summarize(book, resolvePeriod("last_30", config, today)).profitCents, -4500 - 12001 + 145523); // depuis le 23 octobre
  assert.equal(summarize(book, resolvePeriod("last_90", config, today)).profitCents, 107122);
  assert.equal(summarize(book, resolvePeriod("this_year", config, today)).profitCents, 107122);
  assert.equal(summarize(book, resolvePeriod("all", config, today)).profitCents, 107122);
  assert.equal(summarize(book, resolvePeriod("custom", config, today, { from: "2026-10-12", to: "2026-10-20" })).profitCents, -30000 + 62000);
  // bornes incluses
  assert.equal(summarize(book, { from: "2026-10-20", to: "2026-10-20" }).profitCents, 62000);
  assert.equal(summarize(book, { from: "2026-10-21", to: "2026-11-02" }).opCount, 0);
  assert.equal(summarize(book, { month: "2026-09" }).profitCents, -3900);
  // month et from/to se combinent
  assert.equal(summarize(book, { month: "2026-11", to: "2026-11-13" }).profitCents, -16501);
  // autres filtres
  assert.equal(summarize(book, { partnerId: "f" }).profitCents, -3900 - 50000 + 62000 - 4500 - 15000);
  assert.equal(summarize(book, { accountId: "biz" }).profitCents, -9477 + 250000);
  assert.equal(summarize(book, { group: "ads" }).profitCents, -184477);
  assert.equal(summarize(book, { group: "ads", partnerId: "i" }).adSpendCents, 80000);
  assert.equal(summarize(book, { sign: "in" }).profitCents, 312000);
  assert.equal(summarize(book, { kind: "transfer" }).opCount, 0);

  // période vide : zéros et ratios absents
  const empty = summarize(book, { from: "2027-01-01" });
  assert.deepEqual(empty, {
    incomeCents: 0, expenseCents: 0, profitCents: 0, marginPct: null, salesCents: 0, grossSalesCents: 0, refundsCents: 0, adSpendCents: 0,
    adSpendByPlatform: { meta: 0, tiktok: 0, applovin: 0, google: 0, other: 0 },
    adSpendByPayer: { meta: {}, tiktok: {}, applovin: {}, google: {}, other: {} },
    feesCents: 0, nonAdCostsCents: 0, byCategory: {}, byGroup: {}, byPayer: {}, uncategorizedInCents: 0, uncategorizedOutCents: 0,
    opCount: 0, merRatio: null, breakEvenRoas: null, approx: false,
  });
});

test("monthlySeries : un point par mois, du plus ancien au plus récent, sans trou", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const series = monthlySeries(book);
  assert.deepEqual(series.map((m) => [m.month, m.incomeCents, m.expenseCents, m.profitCents, m.salesCents, m.adSpendCents, m.opCount]), [
    ["2026-09", 0, 3900, -3900, 0, 0, 1],
    // octobre : ventes 700,00 - 50,00 ; dépenses 500,00 + 300,00 + 30,00
    ["2026-10", 65000, 83000, -18000, 65000, 80000, 3],
    // novembre : ventes 2 700,00 - 100,00 ; dépenses 45,00 + 120,01 + 800,00 + 94,77 + 100,00 + 150,00
    ["2026-11", 260000, 130978, 129022, 260000, 104477, 6],
  ]);
  assert.equal(-3900 - 18000 + 129022, 107122);
  assert.deepEqual(series[0].byGroup, { platform: -3900 });
  assert.deepEqual(series[1].byGroup, { sales: 65000, platform: -3000, ads: -80000 });
  assert.deepEqual(series[2].byGroup, { ads: -104477, sales: 260000, platform: -10000, production: -12001, tools: -4500 });
  assert.deepEqual(series[1].byCategory, { sales_shopify: 70000, refunds: -5000, fees_payment: -3000, ads_tiktok: -30000, ads_meta: -50000 });
  assert.equal(series[1].refundsCents, 5000);
  assert.equal(series[1].feesCents, 3000);

  // avec une période : seuls les mois concernés
  assert.deepEqual(monthlySeries(book, { from: "2026-11-14" }).map((m) => [m.month, m.profitCents]), [["2026-11", 145523]]);
  assert.deepEqual(monthlySeries(book, { to: "2026-11-13" }).map((m) => [m.month, m.profitCents]), [["2026-09", -3900], ["2026-10", -18000], ["2026-11", -16501]]);
  // avec un filtre de catégorie : seules les lignes concernées
  assert.deepEqual(monthlySeries(book, { categoryId: "ads_tiktok" }).map((m) => [m.month, m.adSpendCents, m.profitCents]), [["2026-10", 30000, -30000], ["2026-11", 15000, -15000]]);
  assert.deepEqual(monthlySeries(book, { partnerId: "i" }).map((m) => [m.month, m.expenseCents]), [["2026-11", 80000]]);
  assert.deepEqual(monthlySeries(book, { from: "2027-01-01" }), []);

  // les mois sans opération apparaissent à zéro entre le premier et le dernier
  const gaps = buildBook({ accounts: { biz: { owner: "business" } } }, [
    pl("g1", "2025-11-15", -1000, "biz", "software"), pl("g2", "2026-02-03", 5000, "biz", "sales_other"),
  ]);
  assert.deepEqual(monthlySeries(gaps).map((m) => [m.month, m.profitCents, m.opCount]), [
    ["2025-11", -1000, 1], ["2025-12", 0, 0], ["2026-01", 0, 0], ["2026-02", 5000, 1],
  ]);
  assert.deepEqual(monthlySeries(gaps)[1], {
    month: "2025-12", incomeCents: 0, expenseCents: 0, profitCents: 0, salesCents: 0, refundsCents: 0, adSpendCents: 0, feesCents: 0,
    byGroup: {}, byCategory: {}, opCount: 0,
  });
  assert.deepEqual(gaps.months, ["2025-11", "2026-02"]);
});

// ---------------------------------------------------------------------------------------------
// 8. Filtres

test("filterOps : chaque critère, seul puis combiné", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const f = (filter) => ids(filterOps(book, filter));
  const all = ["q6", "q5", "q4", "q3", "q2", "q1", "p6", "p5", "p4", "p3", "p2", "p1"];
  assert.deepEqual(f(), all);
  assert.deepEqual(f({}), all);
  assert.deepEqual(f(null), all);
  assert.notEqual(filterOps(book, {}), book.ops); // un nouveau tableau à chaque fois
  assert.equal(filterOps(book, {})[0], book.ops[0]); // mais les mêmes objets

  // dates
  assert.deepEqual(f({ from: "2026-11-14" }), ["q6", "q5", "q4", "q3", "q2", "q1"]);
  assert.deepEqual(f({ to: "2026-11-13" }), ["p6", "p5", "p4", "p3", "p2", "p1"]);
  assert.deepEqual(f({ from: "2026-10-12", to: "2026-11-03" }), ["p5", "p4", "p3"]);
  assert.deepEqual(f({ month: "2026-09" }), ["p1"]);
  assert.deepEqual(f({ month: "2026-10" }), ["p4", "p3", "p2"]);
  assert.deepEqual(f({ month: "2026-11", from: "2026-11-19" }), ["q6", "q5"]);
  assert.deepEqual(f({ from: null, to: null, month: null }), all);

  // type et sens
  assert.deepEqual(f({ kind: "transfer" }), ["q5", "q1"]);
  assert.equal(f({ kind: "pl" }).length, 10);
  assert.deepEqual(f({ sign: "in" }), ["q4", "p4"]);
  assert.deepEqual(f({ sign: "out" }), ["q6", "q3", "q2", "p6", "p5", "p3", "p2", "p1"]);

  // compte : les mouvements entre comptes comptent des deux côtés
  assert.deepEqual(f({ accountId: "biz" }), ["q5", "q4", "q3", "q1"]);
  assert.deepEqual(f({ accountId: "perso_f" }), ["q6", "q5", "p5", "p4", "p2", "p1"]);
  // vu d'un compte, un mouvement entre comptes est une entrée ou une sortie
  assert.deepEqual(f({ accountId: "biz", sign: "in" }), ["q4", "q1"]);
  assert.deepEqual(f({ accountId: "biz", sign: "out" }), ["q5", "q3"]);
  assert.deepEqual(f({ accountId: "perso_f", sign: "in" }), ["q5", "p4"]);

  // payeur : le propriétaire du compte utilisé (associé, "business" ou "unknown")
  assert.deepEqual(f({ partnerId: "i" }), ["q2", "q1"]);
  assert.deepEqual(f({ partnerId: "a" }), ["p6", "p3"]);
  assert.deepEqual(f({ partnerId: "f" }), ["q6", "q5", "p5", "p4", "p2", "p1"]);
  assert.deepEqual(f({ partnerId: "business" }), ["q5", "q4", "q3", "q1"]);
  assert.deepEqual(f({ partnerId: "unknown" }), []);

  // catégorie et groupe : une opération répartie est trouvée par chacune de ses lignes
  assert.deepEqual(f({ categoryId: "refunds" }), ["q4", "p4"]);
  assert.deepEqual(f({ categoryId: "ads_meta" }), ["q2", "p2"]);
  assert.deepEqual(f({ group: "ads" }), ["q6", "q3", "q2", "p3", "p2"]);
  assert.deepEqual(f({ group: "sales" }), ["q4", "p4"]);
  assert.deepEqual(f({ group: "platform" }), ["q4", "p4", "p1"]);
  assert.deepEqual(f({ group: "ads", categoryId: "fees_payment" }), []);

  // origine et drapeaux
  assert.deepEqual(f({ source: "shopify" }), ["q4", "p4"]);
  assert.deepEqual(f({ needsReview: true }), ["p6"]);
  assert.equal(f({ needsReview: false }).length, 11);
  assert.deepEqual(f({ reconciled: true }), ["p5"]);
  assert.equal(f({ reconciled: false }).length, 11);
  // sans justificatif : seulement les dépenses
  assert.deepEqual(f({ noAttachment: true }), ["q6", "q3", "q2", "p6", "p3", "p2", "p1"]);
  assert.deepEqual(f({ noAttachment: false }), ["p5"]);
  assert.deepEqual(f({ uncategorized: true }), []);
  assert.deepEqual(f({ fxEstimated: true }), []);
  assert.equal(f({ fxEstimated: false }).length, 12);

  // recherche : sans casse ni accents, tous les mots doivent être trouvés
  assert.deepEqual(f({ text: "klaviyo" }), ["p5"]);
  assert.deepEqual(f({ text: "  KLAVIYO   inc " }), ["p5"]);
  assert.deepEqual(f({ text: "facebook" }), ["q2", "p2"]);
  assert.deepEqual(f({ text: "video" }), ["p6"]); // "Rendu vidéo"
  assert.deepEqual(f({ text: "vidéo" }), ["p6"]);
  assert.deepEqual(f({ text: "94,77" }), ["q3"]); // par montant
  assert.deepEqual(f({ text: "94.77" }), ["q3"]);
  assert.deepEqual(f({ text: "1182" }), ["q3"]); // par référence
  assert.deepEqual(f({ text: "0562" }), ["q2"]); // par carte
  assert.deepEqual(f({ text: "slash" }), ["q5", "q4", "q3", "q1"]); // par nom de compte
  assert.deepEqual(f({ text: "applovin" }), ["q3"]);
  assert.deepEqual(f({ text: "pub tiktok" }), ["q6", "p3"]); // par nom de catégorie
  assert.deepEqual(f({ text: "apport" }), ["q1"]);
  assert.deepEqual(f({ text: "introuvable" }), []);
  assert.deepEqual(f({ text: "   " }), all);

  // combinaisons
  assert.deepEqual(f({ group: "ads", partnerId: "f", from: "2026-11-01" }), ["q6"]);
  assert.deepEqual(f({ sign: "out", accountId: "perso_a", text: "tiktok" }), ["p3"]);
  assert.deepEqual(f({ kind: "transfer", partnerId: "f" }), ["q5"]);
  assert.deepEqual(f({ kind: "transfer", group: "ads" }), []);
});

// ---------------------------------------------------------------------------------------------
// 9. Relevés

test("partnerStatement : solde cumulé, de la plus ancienne à la plus récente", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const st = partnerStatement(book, "f");
  assert.equal(st.position, book.partners.f);
  assert.deepEqual(st.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents, e.type]), [
    ["p1", 3900, 3900, "advance"], // 39,00 avancés
    ["p2", 50000, 53900, "advance"],
    ["p4", -62000, -8100, "collect"], // il garde 620,00 de ventes : il doit 81,00
    ["p5", 4500, -3600, "advance"],
    ["q5", -10000, -13600, "withdrawal"], // remboursé de 100,00
    ["q6", 15000, 1400, "advance"], // l'entreprise lui doit 14,00
  ]);
  assert.equal(st.openingCents, 0);
  assert.equal(st.closingCents, 1400);
  assert.equal(st.changeCents, 1400);
  assert.deepEqual(st.period, { advancedCents: 73400, collectedCents: 62000, contributedCents: 0, withdrawnCents: 10000, settledCents: 0, netCents: 1400 });

  // sur une période : le solde reste le vrai solde cumulé
  const since = partnerStatement(book, "f", { from: "2026-11-14" });
  assert.deepEqual(since.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents]), [["q5", -10000, -13600], ["q6", 15000, 1400]]);
  assert.equal(since.openingCents, -3600);
  assert.equal(since.closingCents, 1400);
  assert.equal(since.changeCents, 5000);
  assert.deepEqual(since.period, { advancedCents: 15000, collectedCents: 0, contributedCents: 0, withdrawnCents: 10000, settledCents: 0, netCents: 5000 });
  const october = partnerStatement(book, "f", { month: "2026-10" });
  assert.deepEqual(ids(october.entries.map((e) => e.op)), ["p2", "p4"]);
  assert.deepEqual([october.openingCents, october.closingCents, october.changeCents], [3900, -8100, -12000]);
  // un autre filtre masque des lignes sans changer les soldes
  const ads = partnerStatement(book, "f", { group: "ads" });
  assert.deepEqual(ads.entries.map((e) => [e.op.id, e.balanceCents]), [["p2", 53900], ["q6", 1400]]);
  assert.equal(ads.closingCents, 1400);

  const investor = partnerStatement(book, "i");
  assert.deepEqual(investor.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents, e.type]), [
    ["q1", 1000000, 1000000, "contribution"], ["q2", 80000, 1080000, "advance"],
  ]);
  // associé inconnu ou sans mouvement : relevé vide, pas d'erreur
  const nobody = partnerStatement(book, "personne");
  assert.deepEqual(nobody.entries, []);
  assert.equal(nobody.position.netCents, 0);
  assert.equal(nobody.closingCents, 0);
  assert.deepEqual(partnerStatement(book, "unknown").entries, []);
});

test("partnerStatement : règlements entre associés", () => {
  const book = buildBook(RULES_CONFIG, [
    pl("o1", "2026-10-01", -50000, "pp", "ads_meta"),
    tr("t1", "2026-10-05", 20000, "qq", "pp"), // Q rembourse directement 200,00 à P
  ]);
  const p = partnerStatement(book, "p");
  assert.deepEqual(p.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents, e.type]), [["o1", 50000, 50000, "advance"], ["t1", -20000, 30000, "settlement"]]);
  assert.deepEqual(p.period, { advancedCents: 50000, collectedCents: 0, contributedCents: 0, withdrawnCents: 0, settledCents: 20000, netCents: 30000 });
  const q = partnerStatement(book, "q");
  assert.deepEqual(q.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents]), [["t1", 20000, 20000]]);
  assert.equal(q.period.settledCents, -20000);
});

test("accountStatement : solde du compte après chaque opération, dans la devise du compte", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const st = accountStatement(book, "biz");
  assert.equal(st.accountId, "biz");
  assert.equal(st.currency, "USD");
  assert.deepEqual(st.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents, e.approx]), [
    ["q1", 1000000, 1000000, false], ["q3", -9477, 990523, false], ["q4", 250000, 1240523, false], ["q5", -10000, 1230523, false],
  ]);
  assert.deepEqual([st.openingCents, st.closingCents, st.approx], [0, 1230523, false]);
  const part = accountStatement(book, "biz", { from: "2026-11-17", to: "2026-11-18" });
  assert.deepEqual(part.entries.map((e) => [e.op.id, e.balanceCents]), [["q4", 1240523]]);
  assert.deepEqual([part.openingCents, part.closingCents], [990523, 1240523]);
  assert.deepEqual(accountStatement(book, "biz", { sign: "out" }).entries.map((e) => e.op.id), ["q3"]);
  assert.deepEqual(accountStatement(book, "biz", { kind: "transfer" }).entries.map((e) => e.op.id), ["q1", "q5"]);

  // compte de l'entreprise avec solde d'ouverture, en euros, alimenté en dollars
  const fxBook = buildBook({
    accounts: { eur: { name: "Compte en euros", owner: "business", currency: "EUR", openingCents: 100000 }, usd: { name: "Compte en dollars", owner: "business", currency: "USD" } },
    fx: { EUR: { default: 1.25, months: {} } },
  }, [
    pl("a1", "2026-10-01", -2000, "eur", "software", { currency: "EUR" }),
    pl("a2", "2026-10-02", -5000, "eur", "software"), // 50,00 $ sans montant débité : 40,00 EUR estimés
    pl("a3", "2026-10-03", -5000, "eur", "software", { settledCents: -4100 }), // 50,00 $ débités 41,00 EUR
    tr("a4", "2026-10-04", 10000, "usd", "eur"), // 100,00 $ convertis : 80,00 EUR estimés
    tr("a5", "2026-10-05", 10000, "usd", "eur", { toAmountCents: 7900 }), // 100,00 $ : 79,00 EUR arrivés
  ]);
  const eur = accountStatement(fxBook, "eur");
  assert.equal(eur.currency, "EUR");
  assert.deepEqual(eur.entries.map((e) => [e.op.id, e.effectCents, e.balanceCents, e.approx]), [
    ["a1", -2000, 98000, false], ["a2", -4000, 94000, true], ["a3", -4100, 89900, false], ["a4", 8000, 97900, true], ["a5", 7900, 105800, false],
  ]);
  assert.deepEqual([eur.openingCents, eur.closingCents, eur.approx], [100000, 105800, true]);
  assert.equal(fxBook.accounts.eur.balanceCents, 105800);
  assert.equal(fxBook.accounts.eur.approx, true);
  assert.equal(fxBook.accounts.usd.balanceCents, -20000);
  assert.equal(accountStatement(fxBook, "eur", { to: "2026-10-01" }).approx, false);
  // trésorerie en dollars : -200,00 $ + 1 058,00 EUR x 1,25 = -200,00 + 1 322,50
  assert.equal(fxBook.businessCashCents, -20000 + 132250);
  assert.equal(fxBook.businessCashApprox, true);

  // compte inconnu : relevé vide
  assert.deepEqual(accountStatement(book, "nulle part"), { accountId: "nulle part", currency: null, entries: [], openingCents: 0, closingCents: 0, approx: false });
  assert.deepEqual(accountStatement(book, "constructor").entries, []);
});

// ---------------------------------------------------------------------------------------------
// 10. Statistiques : commandes Shopify et performances des plateformes de pub

const STATS = {
  "2026-11": {
    v: 1, month: "2026-11",
    shopify: {
      days: {
        "15": { orders: 10, grossCents: 30000, discountsCents: 2000, refundsCents: 1000, shippingCents: 0, taxCents: 0, netCents: 27000, totalCents: 28000, currency: "USD" },
        "16": { orders: 5, grossCents: 15000, discountsCents: 0, refundsCents: 0, shippingCents: 0, taxCents: 0, netCents: 15000, totalCents: 15000, currency: "USD" },
        "02": { orders: 3, grossCents: 9000, discountsCents: 0, refundsCents: 0, netCents: 9000, totalCents: 9000, currency: "USD" },
      },
    },
    ads: {
      meta: { days: { "15": { spendCents: 20000, currency: "USD", impressions: 40000, clicks: 800, purchases: 8, purchaseValueCents: 24000 } } },
      tiktok: { days: { "16": { spendCents: 5000, currency: "USD", impressions: 10000, clicks: 100, purchases: 0, purchaseValueCents: 0 } } },
      snapchat: { days: { "16": { spendCents: 700, currency: "USD", impressions: 1000, clicks: 10, purchases: 1, purchaseValueCents: 2100 } } },
    },
  },
  "2026-10": { v: 1, month: "2026-10", shopify: { days: { "20": { orders: 7, grossCents: 21000, discountsCents: 0, refundsCents: 0, netCents: 21000, totalCents: 21000, currency: "USD" } } }, ads: {} },
};

test("adKpis : dépenses du livre, performances des statistiques importées", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const k = adKpis(book, STATS, { from: "2026-11-14" });
  assert.deepEqual(k.byPlatform.meta, {
    spendCents: 80000, // payé d'après le livre
    statsSpendCents: 20000, // dépensé d'après Meta
    impressions: 40000, clicks: 800, purchases: 8, purchaseValueCents: 24000, hasStats: true,
    roas: 1.2, // 240,00 / 200,00
    cpa: 2500, // 200,00 / 8 achats
    cpm: 500, // 200,00 pour 40 000 impressions : 5,00 les mille
    cpc: 25, // 200,00 / 800 clics
  });
  assert.deepEqual(k.byPlatform.tiktok, {
    spendCents: 15000, statsSpendCents: 5000, impressions: 10000, clicks: 100, purchases: 0, purchaseValueCents: 0, hasStats: true,
    roas: 0, cpa: null, cpm: 500, cpc: 50,
  });
  // pas de statistiques : la dépense du livre, pas de ratio
  assert.deepEqual(k.byPlatform.applovin, {
    spendCents: 9477, statsSpendCents: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValueCents: 0, hasStats: false,
    roas: null, cpa: null, cpm: null, cpc: null,
  });
  // une plateforme inconnue va dans "other"
  assert.deepEqual(k.byPlatform.other, {
    spendCents: 0, statsSpendCents: 700, impressions: 1000, clicks: 10, purchases: 1, purchaseValueCents: 2100, hasStats: true,
    roas: 3, cpa: 700, cpm: 700, cpc: 70,
  });
  assert.deepEqual(Object.keys(k.byPlatform), ["meta", "tiktok", "applovin", "google", "other"]);
  assert.equal(k.orders, 15); // le 2 novembre et octobre sont hors période
  assert.equal(k.orderValueCents, 43000); // (300,00 - 20,00) + 150,00
  assert.equal(k.aovCents, 2867); // 430,00 / 15 commandes = 28,67
  assert.equal(k.adSpendCents, 104477);
  assert.equal(k.cpaCents, 6965); // 1 044,77 / 15 commandes
  assert.equal(k.salesCents, 260000);
  assert.equal(k.merRatio, 260000 / 104477);
  assert.equal(k.statsAdSpendCents, 25700);
  assert.equal(k.hasOrderStats, true);

  // tout l'historique
  const all = adKpis(book, STATS);
  assert.equal(all.orders, 25);
  assert.equal(all.adSpendCents, 184477);
  assert.equal(all.cpaCents, 7379); // 1 844,77 / 25
  assert.equal(all.aovCents, Math.round((28000 + 15000 + 9000 + 21000) / 25));
  assert.equal(adKpis(book, STATS, { month: "2026-10" }).orders, 7);

  // sans statistiques : commandes et ratios absents, dépenses du livre présentes
  for (const stats of [undefined, null, {}, { "2026-11": null }, { "pas un mois": {} }, "x"]) {
    const none = adKpis(book, stats, { from: "2026-11-14" });
    assert.equal(none.orders, 0);
    assert.equal(none.aovCents, null);
    assert.equal(none.cpaCents, null);
    assert.equal(none.hasOrderStats, false);
    assert.equal(none.byPlatform.meta.spendCents, 80000);
    assert.equal(none.byPlatform.meta.roas, null);
    assert.equal(none.merRatio, 260000 / 104477);
  }
});

test("adKpis : statistiques dans une autre devise et valeurs manquantes", () => {
  const book = buildBook({ fx: { EUR: { default: 1.25, months: {} } } }, []);
  const stats = {
    "2026-10": {
      shopify: { days: { "1": { orders: 2, grossCents: 8000, currency: "EUR" }, "31": { orders: "x", netCents: 4000 }, "99": { orders: 50 }, "05": null } },
      ads: { meta: { days: { "01": { spendCents: 8000, currency: "eur", impressions: 1000, purchases: 4, purchaseValueCents: 16000 }, "02": {} } }, google: null },
    },
  };
  const k = adKpis(book, stats, { month: "2026-10" });
  assert.equal(k.orders, 2);
  // 80,00 EUR x 1,25 = 100,00 $ ; le jour sans brut ni total compte son net (40,00 $ par défaut en dollars)
  assert.equal(k.orderValueCents, 10000 + 4000);
  assert.equal(k.aovCents, 7000);
  assert.equal(k.cpaCents, 0);
  assert.deepEqual(k.byPlatform.meta, {
    spendCents: 0, statsSpendCents: 10000, impressions: 1000, clicks: 0, purchases: 4, purchaseValueCents: 20000, hasStats: true,
    roas: 2, cpa: 2500, cpm: 10000, cpc: null,
  });
  assert.equal(k.byPlatform.google.hasStats, false);
});

test("dailySeries : un point par jour, statistiques quand il y en a, sinon le livre", () => {
  const book = buildBook(ownerConfig(), OWNER_OPS);
  const series = dailySeries(book, STATS, { from: "2026-11-14", to: "2026-11-18" });
  assert.deepEqual(series, [
    {
      date: "2026-11-15", salesCents: 27000, adSpendCents: 20000, orders: 10, adSpendByPlatform: { meta: 20000 },
      ledgerSalesCents: 0, ledgerAdSpendCents: 80000, statsSalesCents: 27000, statsAdSpendCents: 20000, salesFromStats: true, adSpendFromStats: true,
    },
    {
      date: "2026-11-16", salesCents: 15000, adSpendCents: 5700, orders: 5, adSpendByPlatform: { tiktok: 5000, other: 700 },
      ledgerSalesCents: 0, ledgerAdSpendCents: 9477, statsSalesCents: 15000, statsAdSpendCents: 5700, salesFromStats: true, adSpendFromStats: true,
    },
    {
      date: "2026-11-17", salesCents: 0, adSpendCents: 0, orders: 0, adSpendByPlatform: {},
      ledgerSalesCents: 0, ledgerAdSpendCents: 0, statsSalesCents: 0, statsAdSpendCents: 0, salesFromStats: true, adSpendFromStats: true,
    },
    {
      date: "2026-11-18", salesCents: 0, adSpendCents: 0, orders: 0, adSpendByPlatform: {},
      ledgerSalesCents: 260000, ledgerAdSpendCents: 0, statsSalesCents: 0, statsAdSpendCents: 0, salesFromStats: true, adSpendFromStats: true,
    },
  ]);

  // sans statistiques : les encaissements et prélèvements du livre, jour par jour
  const ledgerOnly = dailySeries(book, {}, { from: "2026-11-14" });
  assert.deepEqual(ledgerOnly.map((d) => [d.date, d.salesCents, d.adSpendCents, d.orders]), [
    ["2026-11-15", 0, 80000, 0], ["2026-11-16", 0, 9477, 0], ["2026-11-17", 0, 0, 0], ["2026-11-18", 260000, 0, 0], ["2026-11-19", 0, 0, 0], ["2026-11-20", 0, 15000, 0],
  ]);
  assert.deepEqual(ledgerOnly[0].adSpendByPlatform, { meta: 80000 });
  assert.equal(ledgerOnly[0].salesFromStats, false);
  assert.equal(ledgerOnly[0].adSpendFromStats, false);
  assert.equal(sum(ledgerOnly.map((d) => d.salesCents)), summarize(book, { from: "2026-11-14" }).salesCents);
  assert.equal(sum(ledgerOnly.map((d) => d.adSpendCents)), summarize(book, { from: "2026-11-14" }).adSpendCents);

  // statistiques de commandes seulement : la pub vient du livre
  const mixed = dailySeries(book, { "2026-11": { shopify: STATS["2026-11"].shopify } }, { from: "2026-11-15", to: "2026-11-15" });
  assert.deepEqual(mixed.map((d) => [d.date, d.salesCents, d.adSpendCents, d.salesFromStats, d.adSpendFromStats]), [["2026-11-15", 27000, 80000, true, false]]);

  // tout l'historique : du premier au dernier jour qui a des données
  const all = dailySeries(book, STATS);
  assert.equal(all[0].date, "2026-10-05");
  assert.equal(all[all.length - 1].date, "2026-11-20");
  assert.equal(all.length, 47); // du 5 octobre au 20 novembre inclus
  assert.equal(sum(all.map((d) => d.orders)), 25);
  assert.deepEqual(dailySeries(book, STATS, { from: "2027-01-01" }), []);
  assert.deepEqual(dailySeries(buildBook(defaultConfig(), []), null), []);
});

// ---------------------------------------------------------------------------------------------
// 11. Données non fiables

test("buildBook ignore les opérations illisibles et tolère comptes et catégories manquants", () => {
  const config = { accounts: { biz: { name: "Entreprise", owner: "business", currency: "USD" } } };
  const ops = [
    null, 5, "x", {}, [],
    { id: "bad1", kind: "pl", date: "2026-13-01", amountCents: 5, currency: "USD" },
    { id: "bad2", kind: "pl", date: "2026-10-01", amountCents: 5.5, currency: "USD" },
    pl("g1", "2026-10-01", -1000, "ghost", "ghost_cat"), // compte et catégorie absents des réglages
    pl("g2", "2026-10-02", 500, undefined, "sales_other"), // aucun compte
    tr("g3", "2026-10-03", 2000, "ghost", "biz"),
    tr("g4", "2026-10-04", 300, "biz", undefined),
    tr("g5", "2026-10-05", 900, "ghost", "ghost2"), // deux comptes inconnus : même propriétaire inconnu, aucun effet
  ];
  const book = buildBook(config, ops);
  assert.equal(book.checks.skippedOps, 7);
  assert.deepEqual(ids(book.ops), ["g5", "g4", "g3", "g2", "g1"]);
  // non attribué : 10,00 avancés - 5,00 encaissés + 20,00 apportés - 3,00 retirés = 22,00
  assert.deepEqual(figures(book, "unknown"), [2200, 1000, 500, 2000, 300, 0]);
  assert.equal(book.profitCents, -500);
  assert.equal(book.accounts.biz.balanceCents, 1700);
  assert.equal(-500 + 2200, 1700);
  assert.equal(book.checks.identityDiffCents, 0);
  assert.deepEqual(book.accounts.ghost, {
    id: "ghost", owner: "unknown", currency: "USD", openingCents: 0, balanceCents: -3900, baseFlowCents: -3900, approx: false, opCount: 3, missing: true,
  });
  assert.deepEqual(book.todo.missingAccountIds, ["ghost", "ghost2"]);
  assert.deepEqual(book.todo.unknownOwnerAccountIds, []);
  assert.equal(book.todo.uncategorized, 1);
  assert.equal(book.byId.get("g1").lines[0].categoryId, "uncategorized");
  assert.equal(book.byId.get("g1").categoryId, "ghost_cat");
  assert.deepEqual(book.byId.get("g2").accountEffects, []);
  assert.equal(book.byId.get("g2").ownerId, "unknown");
  assert.deepEqual(book.byId.get("g5").effects, []);
  assert.equal(book.byId.get("g5").nature, "internal");
  assert.deepEqual(ids(filterOps(book, { partnerId: "unknown" })), ["g5", "g4", "g3", "g2", "g1"]);
});

test("buildBook accepte n'importe quoi en entrée sans lever d'exception", () => {
  const inputs = [[undefined, undefined], [null, null], ["x", "y"], [42, {}], [{}, [null]], [{ accounts: "x", partners: [] }, [{ id: "o", kind: "pl" }]]];
  for (const [config, ops] of inputs) {
    let book;
    assert.doesNotThrow(() => { book = buildBook(config, ops); });
    assert.deepEqual(book.ops, []);
    assert.equal(book.profitCents, 0);
    assert.equal(book.businessCashCents, 0);
    assert.equal(book.base, "USD");
    assert.deepEqual(book.partners, {});
    assert.deepEqual(book.months, []);
    assert.equal(book.checks.identityDiffCents, 0);
    assert.doesNotThrow(() => {
      summarize(book, { text: "x", from: "2026-01-01" });
      monthlySeries(book);
      filterOps(book, { text: "x" });
      partnerStatement(book, "x");
      accountStatement(book, "x");
      adKpis(book, null);
      dailySeries(book, null);
      profitShares(book);
    });
  }
  // noms de propriétés hérités utilisés comme identifiants : traités comme des comptes ou catégories absents
  const book = buildBook({ accounts: { biz: { owner: "business" } } }, [
    pl("x1", "2026-10-01", -100, "constructor", "toString"),
    pl("x2", "2026-10-02", -200, "__proto__", "__proto__"),
    tr("x3", "2026-10-03", 300, "hasOwnProperty", "biz"),
  ]);
  assert.equal(book.ops.length, 3);
  assert.equal(book.checks.identityDiffCents, 0);
  assert.equal(book.partners.unknown.netCents, 100 + 200 + 300);
  assert.equal(book.todo.uncategorized, 2);
  assert.equal(Object.getPrototypeOf(book.accounts), Object.prototype);
  assert.deepEqual(book.todo.missingAccountIds, ["constructor", "__proto__", "hasOwnProperty"]);
});

test("buildBook : une seule version par identifiant, tri par date puis par date de création", () => {
  const config = { accounts: { biz: { name: "Entreprise", owner: "business", currency: "USD" } } };
  const book = buildBook(config, [
    pl("a", "2026-10-01", -100, "biz", "software", { createdAt: "2026-10-01T10:00:00Z" }),
    pl("b", "2026-10-01", -200, "biz", "software", { createdAt: "2026-10-01T12:00:00Z" }),
    pl("c", "2026-10-02", -300, "biz", "software", { createdAt: "2026-10-01T08:00:00Z" }),
    pl("e", "2026-10-01", -500, "biz", "software"),
    pl("d", "2026-10-01", -400, "biz", "software"),
    // la même opération présente deux fois (déplacement en cours entre deux mois de stockage) : la plus récente gagne
    pl("dup", "2026-09-30", -1000, "biz", "software", { updatedAt: "2026-10-05T10:00:00Z" }),
    pl("dup", "2026-10-03", -2000, "biz", "software", { updatedAt: "2026-10-06T10:00:00Z" }),
    pl("dup", "2026-09-29", -3000, "biz", "software", { updatedAt: "2026-10-04T10:00:00Z" }),
  ]);
  assert.deepEqual(ids(book.ops), ["dup", "c", "b", "a", "e", "d"]);
  assert.equal(book.byId.get("dup").amountCents, -2000);
  assert.equal(book.byId.size, 6);
  assert.equal(book.profitCents, -100 - 200 - 300 - 500 - 400 - 2000);
  assert.deepEqual(book.months, ["2026-10"]);
});

test("buildBook est une fonction pure : entrées intactes, résultat identique d'un appel à l'autre", () => {
  const config = deepFreeze(ownerConfig({ business: { pivotDate: "2026-11-14" } }));
  const ops = deepFreeze(OWNER_OPS.map((op) => ({ ...op })));
  const snapshot = (book) => JSON.stringify({
    ops: book.ops.map((op) => ({ ...op, effects: op.effects, lines: op.lines })),
    accounts: book.accounts, cash: book.businessCashCents, profit: book.profitCents, periods: book.sharePeriods, checks: book.checks, todo: book.todo,
    partners: Object.values(book.partners).map((p) => ({ ...p, entries: p.entries.map((e) => [e.op.id, e.effectCents]) })),
  });
  const first = buildBook(config, ops);
  const second = buildBook(config, ops);
  assert.equal(snapshot(first), snapshot(second));
  assert.notEqual(first.ops[0], second.ops[0]);
  // l'ordre des opérations en entrée ne change rien
  const shuffled = buildBook(config, ops.slice().reverse());
  assert.equal(snapshot(shuffled), snapshot(first));
  // la configuration du livre est la version normalisée, pas l'objet reçu
  assert.notEqual(first.config, config);
  assert.equal(first.config.business.pivotDate, "2026-11-14");
  assert.equal(first.config.categories.ads_meta.group, "ads");
  // les fonctions de lecture ne modifient pas le livre
  const before = snapshot(first);
  summarize(first, { text: "klaviyo" });
  filterOps(first, { group: "ads" });
  monthlySeries(first);
  partnerStatement(first, "f", { month: "2026-11" });
  accountStatement(first, "biz");
  adKpis(first, STATS);
  dailySeries(first, STATS);
  profitShares(first, { month: "2026-11" });
  assert.equal(snapshot(first), before);
});

test("livre vide : tout est à zéro et prêt à l'affichage", () => {
  const book = buildBook(defaultConfig(), []);
  assert.deepEqual(book.ops, []);
  assert.equal(book.byId.size, 0);
  assert.deepEqual(book.months, []);
  assert.deepEqual(book.accounts, {});
  assert.deepEqual(book.partners, {});
  assert.equal(book.businessCashCents, 0);
  assert.equal(book.businessCashApprox, false);
  assert.equal(book.profitCents, 0);
  assert.deepEqual(book.sharePeriods, [{
    index: 0, ruleId: null, from: null, to: null, startsOn: null, shares: {}, sharesTotal: 0, equal: false, partnerCount: 0,
    profitCents: 0, perPartner: {}, allocatedCents: 0, unallocatedCents: 0,
  }]);
  assert.deepEqual(book.checks, { identityDiffCents: 0, businessFlowCents: 0, partnersNetCents: 0, sharesTotal: 0, shareProblems: [], skippedOps: 0 });
  assert.deepEqual(book.todo, { uncategorized: 0, needsReview: 0, estimated: 0, noAttachment: 0, unknownOwnerAccountIds: [], missingAccountIds: [] });
  // des associés sans aucune opération ont une position à zéro
  const withPartners = buildBook({ partners: { a: { name: "A" } }, accounts: { x: { owner: "unknown", name: "Carte ?" }, y: { owner: "unknown", archived: true } } }, []);
  assert.deepEqual(withPartners.partners.a, {
    id: "a", netCents: 0, advancedCents: 0, collectedCents: 0, contributedCents: 0, withdrawnCents: 0, settledCents: 0,
    profitShareCents: 0, equityCents: 0, sharePct: 100, entries: [],
  });
  // un compte non attribué est signalé, sauf s'il est archivé et inutilisé
  assert.deepEqual(withPartners.todo.unknownOwnerAccountIds, ["x"]);
});

test("cas limites : montant débité de signe contraire, montant nul, virement d'un compte vers lui-même", () => {
  const config = {
    partners: { p: { name: "P" } },
    accounts: {
      eur: { name: "Perso en euros", owner: "p", currency: "EUR" },
      biz: { name: "Entreprise", owner: "business", currency: "USD", openingCents: 5000 },
    },
    fx: { EUR: { default: 1.25, months: {} } },
  };
  const book = buildBook(config, [
    // montant débité de signe contraire au montant : ignoré, on retombe sur la conversion (50,00 $ / 1,25 = 40,00 EUR)
    pl("e1", "2026-10-01", -5000, "eur", "software", { settledCents: 4100 }),
    pl("e2", "2026-10-02", 0, "eur", "software"),
    tr("e3", "2026-10-03", 700, "biz", "biz"),
    tr("e4", "2026-10-04", 0, "eur", "biz"),
  ]);
  assert.deepEqual(book.byId.get("e1").accountEffects, [{ accountId: "eur", cents: -4000, approx: true }]);
  assert.equal(book.byId.get("e1").baseCents, -5000);
  assert.equal(book.byId.get("e2").baseCents, 0);
  assert.deepEqual(book.byId.get("e2").effects, [{ partnerId: "p", cents: 0 }]);
  assert.ok(Object.is(book.byId.get("e2").effects[0].cents, 0));
  assert.equal(book.byId.get("e2").nature, "income");
  // virement d'un compte vers lui-même : aucun effet nulle part
  assert.deepEqual(book.byId.get("e3").effects, []);
  assert.deepEqual(book.byId.get("e3").accountEffects, [{ accountId: "biz", cents: -700, approx: false }, { accountId: "biz", cents: 700, approx: false }]);
  assert.equal(book.accounts.biz.balanceCents, 5000);
  assert.equal(book.accounts.biz.opCount, 2);
  assert.deepEqual(accountStatement(book, "biz").entries.map((e) => [e.op.id, e.effectCents, e.balanceCents]), [["e3", 0, 5000], ["e4", 0, 5000]]);
  assert.equal(accountStatement(book, "biz").openingCents, 5000);
  assert.deepEqual(figures(book, "p"), [5000, 5000, 0, 0, 0, 0]);
  assert.equal(book.businessCashCents, 5000); // le solde d'ouverture compte dans la trésorerie, pas dans l'identité
  assert.equal(book.checks.businessFlowCents, 0);
  assert.equal(book.checks.identityDiffCents, -5000 + 5000);
  for (const op of book.ops) for (const e of [...op.effects, ...op.accountEffects]) assert.ok(!Object.is(e.cents, -0), op.id);
});

// ---------------------------------------------------------------------------------------------
// 12. Garde-fou de performance

test("performance : 5 000 opérations en bien moins de 200 ms, résumés et filtres linéaires", () => {
  const { config, ops } = randomLedger(4242, { count: 5000 });
  buildBook(config, ops.slice(0, 500)); // mise en route du moteur JavaScript
  let best = Infinity;
  let book;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    book = buildBook(config, ops);
    best = Math.min(best, performance.now() - start);
  }
  assert.equal(book.ops.length, 5000);
  assert.equal(book.checks.identityDiffCents, 0);
  assert.ok(best < 200, `buildBook a pris ${best.toFixed(1)} ms pour 5 000 opérations`);

  const time = (fn) => {
    let fastest = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      fn();
      fastest = Math.min(fastest, performance.now() - start);
    }
    return fastest;
  };
  const period = { from: "2026-09-01", to: "2026-11-30" };
  assert.ok(time(() => summarize(book, period)) < 50);
  assert.ok(time(() => monthlySeries(book, period)) < 50);
  assert.ok(time(() => filterOps(book, { ...period, group: "ads", sign: "out" })) < 50);
  assert.ok(time(() => filterOps(book, { text: "entreprise 12" })) < 100);
  assert.ok(time(() => partnerStatement(book, "p1", period)) < 50);
  assert.ok(time(() => accountStatement(book, "biz_usd", period)) < 50);
  assert.ok(time(() => profitShares(book, period)) < 50);
  assert.ok(time(() => dailySeries(book, {}, period)) < 50);
});
