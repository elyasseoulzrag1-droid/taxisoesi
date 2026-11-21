import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  findDuplicate, matchBankLines, applyBankMatch, attachMatches, completeBankOp,
  RECON_DAYS_AFTER, RECON_DAYS_BEFORE, RECON_TOLERANCE_PCT, DUPLICATE_DAYS,
} from "../../src/core/recon.js";
import { buildBook } from "../../src/core/ledger.js";
import { normalizeConfig, defaultConfig, validateOp } from "../../src/core/model.js";
import { convert } from "../../src/core/fx.js";
import { decodeBytes, parseCsv } from "../../src/core/importers/csv.js";
import { IMPORTERS } from "../../src/core/importers/bank.js";

// ---------------------------------------------------------------------------------------------
// Outils de test

// Trois associés, des comptes personnels et des comptes de l'entreprise. Taux fixe : 1 EUR = 1,10 USD.
const CONFIG = normalizeConfig({
  ...defaultConfig(),
  partners: {
    camille: { id: "camille", name: "Camille", role: "founder" },
    noa: { id: "noa", name: "Noa", role: "partner" },
    idris: { id: "idris", name: "Idris", role: "investor" },
  },
  accounts: {
    perso_usd: { id: "perso_usd", name: "Revolut de Camille (USD)", kind: "bank", owner: "camille", currency: "USD" },
    perso_eur: { id: "perso_eur", name: "Revolut de Camille (EUR)", kind: "bank", owner: "camille", currency: "EUR" },
    pro_usd: { id: "pro_usd", name: "Slash", kind: "bank", owner: "business", currency: "USD", cards: ["0562", "2487"] },
    pro_eur: { id: "pro_eur", name: "Compte pro EUR", kind: "bank", owner: "business", currency: "EUR" },
  },
  fx: { EUR: { default: 1.1 } },
});

const pl = (id, date, amountCents, accountId, extra = {}) => ({
  id, kind: "pl", date, label: id, amountCents, currency: "USD", accountId, categoryId: null, ...extra,
});
const tr = (id, date, amountCents, fromAccountId, toAccountId, extra = {}) => ({
  id, kind: "transfer", date, label: id, amountCents, currency: "USD", fromAccountId, toAccountId, ...extra,
});
const line = (date, amountCents, extra = {}) => ({ kind: "pl", date, amountCents, currency: "USD", label: "ligne " + date, ...extra });
const book = (ops) => buildBook(CONFIG, ops);
const pairs = (map) => Array.from(map.entries()).sort((a, b) => a[0] - b[0]);

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const load = (name) => parseCsv(decodeBytes(readFileSync(path.join(FIXTURES, name))));
const importer = (type) => IMPORTERS.find((imp) => imp.type === type);

// Ce que fait importers/index.js après la lecture : les brouillons non rapprochés sont comparés au livre.
function annotate(drafts, b) {
  return drafts.map((draft) => {
    const out = { _selected: true, _dupOf: null, _dupExact: false, _matchOf: null, _note: "", ...draft };
    if (!out._matchOf) {
      const dup = findDuplicate(out, b);
      if (dup) {
        out._dupOf = dup.opId;
        out._dupExact = dup.exact;
        if (dup.exact) out._selected = false;
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// Constantes de la règle

test("constantes du rapprochement", () => {
  assert.equal(RECON_DAYS_AFTER, 4);
  assert.equal(RECON_DAYS_BEFORE, 2);
  assert.equal(RECON_TOLERANCE_PCT, 4);
  assert.equal(DUPLICATE_DAYS, 1);
});

// ---------------------------------------------------------------------------------------------
// Doublons

test("findDuplicate : même identifiant externe = doublon certain", () => {
  const b = book([
    pl("op_a", "2026-10-02", -9477, "pro_usd", { extId: "stripe:1182-9784" }),
    pl("op_b", "2026-10-02", -2000, "pro_usd"),
  ]);
  // même identifiant, même si la date et le montant ont changé depuis
  assert.deepEqual(findDuplicate({ kind: "pl", date: "2026-11-20", amountCents: -1, currency: "USD", accountId: "perso_usd", extId: "stripe:1182-9784" }, b),
    { opId: "op_a", exact: true });
  // un identifiant inconnu ne suffit pas : on retombe sur la comparaison compte + montant + date
  assert.equal(findDuplicate({ kind: "pl", date: "2026-11-20", amountCents: -1, currency: "USD", accountId: "pro_usd", extId: "stripe:autre" }, b), null);
  // une opération n'est pas le doublon d'elle-même
  assert.equal(findDuplicate({ id: "op_a", kind: "pl", date: "2026-10-02", amountCents: -9477, currency: "USD", accountId: "pro_usd", extId: "stripe:1182-9784" }, b), null);
});

test("findDuplicate : doublon probable = même type, même compte, même montant signé, même devise, à un jour près", () => {
  const b = book([
    pl("op_a", "2026-10-02", -9477, "pro_usd"),
    pl("op_eur", "2026-10-02", -9477, "pro_eur", { currency: "EUR" }),
  ]);
  const draft = (extra) => ({ kind: "pl", date: "2026-10-02", amountCents: -9477, currency: "USD", accountId: "pro_usd", ...extra });
  assert.deepEqual(findDuplicate(draft({}), b), { opId: "op_a", exact: false });
  assert.deepEqual(findDuplicate(draft({ date: "2026-10-03" }), b), { opId: "op_a", exact: false });
  assert.deepEqual(findDuplicate(draft({ date: "2026-10-01" }), b), { opId: "op_a", exact: false });
  assert.equal(findDuplicate(draft({ date: "2026-10-04" }), b), null, "deux jours d'écart");
  assert.equal(findDuplicate(draft({ date: "2026-09-30" }), b), null);
  assert.equal(findDuplicate(draft({ amountCents: 9477 }), b), null, "sens opposé");
  assert.equal(findDuplicate(draft({ amountCents: -9478 }), b), null);
  assert.equal(findDuplicate(draft({ accountId: "perso_usd" }), b), null, "autre compte");
  assert.equal(findDuplicate(draft({ currency: "EUR" }), b), null, "autre devise sur ce compte");
  assert.deepEqual(findDuplicate(draft({ currency: "EUR", accountId: "pro_eur" }), b), { opId: "op_eur", exact: false });
  assert.equal(findDuplicate({ kind: "transfer", date: "2026-10-02", amountCents: 9477, currency: "USD", fromAccountId: "pro_usd", toAccountId: "perso_usd" }, b), null,
    "un mouvement entre comptes n'est pas le doublon d'une dépense");
});

test("findDuplicate : entre plusieurs candidats, la date la plus proche", () => {
  const b = book([
    pl("op_veille", "2026-10-01", -2000, "pro_usd"),
    pl("op_jour", "2026-10-02", -2000, "pro_usd"),
    pl("op_lendemain", "2026-10-03", -2000, "pro_usd"),
  ]);
  assert.deepEqual(findDuplicate({ kind: "pl", date: "2026-10-02", amountCents: -2000, currency: "USD", accountId: "pro_usd" }, b), { opId: "op_jour", exact: false });
  assert.deepEqual(findDuplicate({ kind: "pl", date: "2026-10-04", amountCents: -2000, currency: "USD", accountId: "pro_usd" }, b), { opId: "op_lendemain", exact: false });
});

test("findDuplicate : un mouvement entre comptes est comparé sur ses deux comptes", () => {
  const b = book([tr("apport", "2026-11-14", 500000, "perso_usd", "pro_usd")]);
  const draft = (extra) => ({ kind: "transfer", date: "2026-11-15", amountCents: 500000, currency: "USD", fromAccountId: "perso_usd", toAccountId: "pro_usd", ...extra });
  assert.deepEqual(findDuplicate(draft({}), b), { opId: "apport", exact: false });
  assert.equal(findDuplicate(draft({ fromAccountId: "pro_usd", toAccountId: "perso_usd" }), b), null, "sens inverse");
  assert.equal(findDuplicate(draft({ toAccountId: "pro_eur" }), b), null, "autre compte d'arrivée");
  assert.equal(findDuplicate(draft({ date: "2026-11-16" }), b), null);
  // le type est deviné quand il manque
  assert.deepEqual(findDuplicate({ date: "2026-11-14", amountCents: 500000, currency: "USD", fromAccountId: "perso_usd", toAccountId: "pro_usd" }, b),
    { opId: "apport", exact: false });
});

test("findDuplicate : un virement Shopify importé après la ligne de relevé qui le contient déjà est signalé", () => {
  // La ligne du relevé a été importée d'abord (le 7), le virement Shopify est daté du 5 par Shopify.
  const b = book([
    pl("op_banque", "2026-10-07", 123456, "perso_usd", { categoryId: "sales_shopify", source: "revolut", extId: "bank:perso_usd:abc", reconciled: true, bank: { date: "2026-10-07", label: "Payment from Shopify Inc" } }),
    pl("op_manuelle", "2026-10-20", 5000, "perso_usd", { source: "manual" }),
  ]);
  const payout = (date, extra) => ({ kind: "pl", date, amountCents: 123456, currency: "USD", accountId: "perso_usd", source: "shopify", extId: "shopify_payout:" + date + ":123456", ...extra });
  assert.deepEqual(findDuplicate(payout("2026-10-05"), b), { opId: "op_banque", exact: false }, "relevé 2 jours après");
  assert.deepEqual(findDuplicate(payout("2026-10-03"), b), { opId: "op_banque", exact: false }, "relevé 4 jours après");
  assert.equal(findDuplicate(payout("2026-10-02"), b), null, "relevé 5 jours après : trop loin");
  assert.deepEqual(findDuplicate(payout("2026-10-09"), b), { opId: "op_banque", exact: false }, "relevé 2 jours avant");
  assert.equal(findDuplicate(payout("2026-10-10"), b), null, "relevé 3 jours avant : trop loin");
  // la fenêtre large ne vaut que face à une ligne de relevé
  assert.equal(findDuplicate({ kind: "pl", date: "2026-10-17", amountCents: 5000, currency: "USD", accountId: "perso_usd", source: "shopify" }, b), null);
  // et un autre relevé garde la règle stricte d'un jour
  assert.equal(findDuplicate(payout("2026-10-05", { extId: "bank:perso_usd:autre" }), b), null);
});

test("findDuplicate : sans livre ou sans brouillon, rien", () => {
  assert.equal(findDuplicate(null, book([])), null);
  assert.equal(findDuplicate({ kind: "pl", date: "2026-10-02", amountCents: -1, currency: "USD" }, null), null);
  assert.equal(findDuplicate({ kind: "pl", date: "pas une date", amountCents: -1, currency: "USD", accountId: "pro_usd" }, book([pl("a", "2026-10-02", -1, "pro_usd")])), null);
  assert.equal(findDuplicate({ kind: "pl", date: "2026-10-02", amountCents: -1.5, currency: "USD", accountId: "pro_usd" }, book([pl("a", "2026-10-02", -1, "pro_usd")])), null);
});

// ---------------------------------------------------------------------------------------------
// Rapprochement : la règle de base

test("matchBankLines : même compte, même sens, de 2 jours avant à 4 jours après la date de l'opération", () => {
  const ops = [pl("op", "2026-11-10", -9477, "pro_usd")];
  const match = (date, extra) => pairs(matchBankLines([line(date, -9477, extra)], book(ops), "pro_usd"));
  assert.deepEqual(match("2026-11-10"), [[0, "op"]]);
  assert.deepEqual(match("2026-11-14"), [[0, "op"]], "4 jours après");
  assert.deepEqual(match("2026-11-15"), [], "5 jours après");
  assert.deepEqual(match("2026-11-08"), [[0, "op"]], "2 jours avant");
  assert.deepEqual(match("2026-11-07"), [], "3 jours avant");
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", 9477)], book(ops), "pro_usd")), [], "sens opposé");
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", -9478)], book(ops), "pro_usd")), [], "montant différent");
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", -9477)], book(ops), "perso_usd")), [], "autre compte");
  // le compte peut aussi venir de la ligne
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", -9477, { accountId: "pro_usd" })], book(ops))), [[0, "op"]]);
});

test("matchBankLines : seules les opérations non pointées sont candidates", () => {
  const b = book([
    pl("pointee", "2026-11-10", -9477, "pro_usd", { reconciled: true, bank: { date: "2026-11-11", label: "APPLOVIN" } }),
    pl("libre", "2026-11-12", -9477, "pro_usd"),
  ]);
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", -9477)], b, "pro_usd")), [[0, "libre"]]);
  assert.deepEqual(pairs(matchBankLines([line("2026-11-09", -9477)], b, "pro_usd")), []);
});

test("matchBankLines : entrées invalides ignorées, jamais d'exception", () => {
  const b = book([pl("op", "2026-11-10", -9477, "pro_usd")]);
  assert.equal(matchBankLines(null, b, "pro_usd").size, 0);
  assert.equal(matchBankLines([line("2026-11-10", -9477)], null, "pro_usd").size, 0);
  assert.equal(matchBankLines([line("2026-11-10", -9477)], b, undefined).size, 0);
  const odd = [null, 12, { date: "hier", amountCents: -9477 }, { date: "2026-11-10", amountCents: "x" }, { date: "2026-11-10", amountCents: 0 }, line("2026-11-11", -9477)];
  assert.deepEqual(pairs(matchBankLines(odd, b, "pro_usd")), [[5, "op"]]);
});

// ---------------------------------------------------------------------------------------------
// Virements Shopify déjà dans les comptes, puis relevé de banque

const PAYOUTS = [
  // Virement du 5 octobre : 1 300,00 de ventes, 20,00 de remboursements, 45,44 de frais = 1 234,56 net.
  pl("payout_1", "2026-10-05", 123456, "perso_usd", {
    label: "Virement Shopify du 05/10", party: "Shopify", source: "shopify", extId: "shopify_payout:2026-10-05:123456",
    splits: [
      { categoryId: "sales_shopify", amountCents: 130000 },
      { categoryId: "refunds", amountCents: -2000 },
      { categoryId: "fees_payment", amountCents: -4544 },
    ],
  }),
  // Virement du 12 octobre : pas encore arrivé sur le relevé.
  pl("payout_2", "2026-10-12", 30000, "perso_usd", {
    label: "Virement Shopify du 12/10", party: "Shopify", source: "shopify", extId: "shopify_payout:2026-10-12:30000",
    splits: [{ categoryId: "sales_shopify", amountCents: 31000 }, { categoryId: "fees_payment", amountCents: -1000 }],
  }),
];

test("relevé Revolut après les virements Shopify : la ligne du relevé pointe le virement, elle ne le double pas", () => {
  const before = book(PAYOUTS);
  assert.equal(before.profitCents, 153456);
  const parsed = load("bank_revolut_en.csv");
  const result = importer("bank_revolut").parse(parsed, { config: CONFIG, book: before, accountId: "perso_usd" });
  const drafts = annotate(result.drafts, before);

  const matched = drafts.filter((d) => d._matchOf);
  assert.equal(matched.length, 1);
  const shopifyLine = matched[0];
  assert.equal(shopifyLine.label, "Payment from Shopify Inc");
  assert.equal(shopifyLine.amountCents, 123456);
  assert.equal(shopifyLine._matchOf, "payout_1");
  assert.equal(shopifyLine._selected, true);
  assert.equal(shopifyLine._dupOf, null, "une ligne rapprochée n'est jamais signalée comme doublon");
  assert.equal(shopifyLine._dupExact, false);
  assert.ok(result.info.some((s) => /1 ligne correspond à des opérations déjà saisies/.test(s)), result.info.join("\n"));
  // aucune autre ligne du relevé n'est un doublon ni un rapprochement
  for (const d of drafts) if (d !== shopifyLine) assert.equal(d._dupOf, null, d.label);

  // Enregistrement : le virement existant est pointé, les autres lignes cochées deviennent des opérations.
  const pointed = applyBankMatch(before.byId.get("payout_1"), shopifyLine, CONFIG);
  assert.equal(pointed.id, "payout_1");
  assert.equal(pointed.reconciled, true);
  assert.deepEqual(pointed.bank, { date: "2026-10-06", label: "Payment from Shopify Inc", extId: shopifyLine.extId });
  assert.equal(pointed.amountCents, 123456);
  assert.equal(pointed.settledCents, undefined, "même devise que le compte : rien à ajouter");
  assert.deepEqual(pointed.splits, PAYOUTS[0].splits);
  assert.equal(pointed.extId, "shopify_payout:2026-10-05:123456");
  assert.equal(pointed.source, "shopify");
  for (const key of ["baseCents", "lines", "effects", "accountEffects", "month", "ownerId", "nature", "sharePeriod", "fxEstimated"]) {
    assert.ok(!(key in pointed), "champ calculé recopié : " + key);
  }
  assert.deepEqual(validateOp(pointed, CONFIG), []);
  assert.equal(before.byId.get("payout_1").reconciled, undefined, "l'opération du livre n'est pas modifiée");

  const created = drafts.filter((d) => d._selected && !d._matchOf).map((d, i) => {
    const op = { id: "bank_" + i };
    for (const key of Object.keys(d)) if (key[0] !== "_") op[key] = d[key];
    return op;
  });
  const after = book([pointed, PAYOUTS[1], ...created]);
  assert.equal(after.ops.filter((op) => op.amountCents === 123456).length, 1, "un seul mouvement de 1 234,56 $");
  // Les ventes ne bougent pas : 1 534,56 de virements, moins les dépenses cochées du relevé, plus le remboursement de pub.
  const spent = 3900 + 100 + 2000 + 2000 + 5000 + 50 + 9477 + 999 - 500;
  assert.equal(after.profitCents, 153456 - spent);
  assert.equal(after.checks.identityDiffCents, 0);

  // Second import du même relevé : tout est déjà connu, y compris la ligne qui a servi à pointer le virement.
  const again = importer("bank_revolut").parse(parsed, { config: CONFIG, book: after, accountId: "perso_usd" });
  const second = annotate(again.drafts, after);
  assert.equal(second.filter((d) => d._matchOf).length, 0, "le second virement Shopify (300,00 $) ne doit pas être pointé par erreur");
  const line2 = second.find((d) => d.label === "Payment from Shopify Inc");
  assert.deepEqual([line2._dupOf, line2._dupExact, line2._selected], ["payout_1", true, false]);
  for (const d of second.filter((x) => created.some((op) => op.extId === x.extId))) {
    assert.equal(d._dupExact, true, d.label);
    assert.equal(d._selected, false, d.label);
  }
});

test("virements Shopify : chaque ligne du relevé pointe le virement le plus proche, un pour un", () => {
  const b = book([
    pl("p1", "2026-11-02", 39765, "pro_usd", { party: "Shopify", source: "shopify" }),
    pl("p2", "2026-11-03", 39765, "pro_usd", { party: "Shopify", source: "shopify" }),
    pl("p3", "2026-11-09", 18165, "pro_usd", { party: "Shopify", source: "shopify" }),
  ]);
  const lines = [
    line("2026-11-04", 39765, { party: "Shopify" }),
    line("2026-11-05", 39765, { party: "Shopify" }),
    line("2026-11-10", 18165, { party: "Shopify" }),
    line("2026-11-12", 18165, { party: "Shopify" }),
  ];
  assert.deepEqual(pairs(matchBankLines(lines, b, "pro_usd")), [[0, "p2"], [1, "p1"], [2, "p3"]]);
});

// ---------------------------------------------------------------------------------------------
// Reçus en dollars payés depuis un compte en euros

test("reçu en USD payé d'un compte en EUR : rapprochement à 4 % près du montant converti, puis montant débité enregistré", () => {
  // 94,77 $ au taux de 1,10 : 86,15 EUR estimés.
  assert.equal(convert(-9477, "USD", "EUR", "2026-10-02", CONFIG).cents, -8615);
  const ops = [pl("klaviyo", "2026-10-02", -9477, "perso_eur", { label: "Klaviyo, abonnement", party: "Klaviyo", categoryId: "email_sms", source: "scan" })];
  const before = book(ops);
  assert.equal(before.accounts.perso_eur.balanceCents, -8615);
  assert.equal(before.accounts.perso_eur.approx, true);

  const bankLine = { kind: "pl", date: "2026-10-03", label: "Klaviyo", amountCents: -8660, currency: "EUR", accountId: "perso_eur", extId: "bank:perso_eur:k1", bank: { date: "2026-10-04", label: "KLAVIYO INC" } };
  assert.deepEqual(pairs(matchBankLines([bankLine], before, "perso_eur")), [[0, "klaviyo"]]);

  const pointed = applyBankMatch(before.byId.get("klaviyo"), bankLine, CONFIG);
  assert.equal(pointed.amountCents, -9477, "le montant du reçu reste en dollars");
  assert.equal(pointed.currency, "USD");
  assert.equal(pointed.settledCents, -8660, "le montant débité en euros vient du relevé");
  assert.equal(pointed.reconciled, true);
  assert.deepEqual(pointed.bank, { date: "2026-10-04", label: "KLAVIYO INC", extId: "bank:perso_eur:k1" });
  assert.equal(pointed.categoryId, "email_sms");
  assert.deepEqual(validateOp(pointed, CONFIG), []);

  const after = book([pointed]);
  assert.equal(after.accounts.perso_eur.balanceCents, -8660);
  assert.equal(after.accounts.perso_eur.approx, false, "le solde du compte n'est plus une estimation");
  assert.equal(after.byId.get("klaviyo").baseCents, -9477);
  assert.equal(after.partners.camille.advancedCents, 9477);
  // une fois pointée, l'opération n'est plus candidate
  assert.equal(matchBankLines([bankLine], after, "perso_eur").size, 0);
  assert.deepEqual(findDuplicate(bankLine, after), { opId: "klaviyo", exact: true }, "la ligne est reconnue au prochain import");
});

test("tolérance de 4 % : bornes exactes", () => {
  // 110,00 $ au taux de 1,10 : 100,00 EUR estimés. La tolérance va de 96,00 à 104,00 EUR.
  const b = book([pl("op", "2026-10-10", -11000, "perso_eur")]);
  assert.equal(convert(-11000, "USD", "EUR", "2026-10-10", CONFIG).cents, -10000);
  const hit = (cents) => matchBankLines([line("2026-10-10", cents, { currency: "EUR" })], b, "perso_eur").size === 1;
  assert.equal(hit(-10000), true);
  assert.equal(hit(-10400), true);
  assert.equal(hit(-10401), false);
  assert.equal(hit(-9600), true);
  assert.equal(hit(-9599), false);
  assert.equal(hit(10000), false, "sens opposé");
});

test("montant débité déjà connu ou même devise : égalité exacte, aucune tolérance", () => {
  const b = book([
    pl("avec_montant_debite", "2026-10-10", -5000, "perso_eur", { settledCents: -4600 }),
    pl("en_euros", "2026-10-10", -3000, "perso_eur", { currency: "EUR" }),
  ]);
  const hit = (cents) => pairs(matchBankLines([line("2026-10-11", cents, { currency: "EUR" })], b, "perso_eur"));
  assert.deepEqual(hit(-4600), [[0, "avec_montant_debite"]]);
  assert.deepEqual(hit(-4610), [], "0,2 % d'écart mais le montant débité est connu");
  assert.deepEqual(hit(-4545), [], "le montant converti (45,45) ne sert plus");
  assert.deepEqual(hit(-3000), [[0, "en_euros"]]);
  assert.deepEqual(hit(-3001), []);
});

test("un montant exact passe avant un montant approché, même avec un jour d'écart en plus", () => {
  const b = book([
    pl("approche", "2026-10-10", -11000, "perso_eur"),
    pl("exact", "2026-10-09", -10000, "perso_eur", { currency: "EUR" }),
  ]);
  assert.deepEqual(pairs(matchBankLines([line("2026-10-10", -10000, { currency: "EUR" })], b, "perso_eur")), [[0, "exact"]]);
  // avec deux lignes, chacune trouve son opération
  const two = [line("2026-10-10", -10000, { currency: "EUR" }), line("2026-10-11", -10150, { currency: "EUR" })];
  assert.deepEqual(pairs(matchBankLines(two, b, "perso_eur")), [[0, "exact"], [1, "approche"]]);
});

test("ligne de relevé qui donne le montant d'origine et le montant débité (Revolut Business, Slash)", () => {
  // Reçu OVH de 11,99 EUR payé avec le compte en dollars : la banque a débité 13,02 $.
  const b = book([pl("ovh", "2026-11-16", -1199, "pro_usd", { currency: "EUR", party: "OVHcloud" })]);
  const bankLine = { kind: "pl", date: "2026-11-16", label: "OVH", amountCents: -1199, currency: "EUR", settledCents: -1302, accountId: "pro_usd", extId: "bank:pro_usd:ovh" };
  assert.deepEqual(pairs(matchBankLines([bankLine], b, "pro_usd")), [[0, "ovh"]]);
  const pointed = applyBankMatch(b.byId.get("ovh"), bankLine, CONFIG);
  assert.equal(pointed.settledCents, -1302);
  assert.equal(pointed.amountCents, -1199);
  assert.equal(book([pointed]).accounts.pro_usd.balanceCents, -1302);
  // même devise d'origine mais autre montant : pas la même dépense
  assert.equal(matchBankLines([{ ...bankLine, amountCents: -1200 }], b, "pro_usd").size, 0);
});

// ---------------------------------------------------------------------------------------------
// Montants égaux à des dates proches

test("montants égaux à des dates proches : le plus petit écart de date, un pour un", () => {
  const b = book([
    pl("meta_10", "2026-11-10", -2000, "pro_usd", { party: "Meta", categoryId: "ads_meta" }),
    pl("meta_12", "2026-11-12", -2000, "pro_usd", { party: "Meta", categoryId: "ads_meta" }),
  ]);
  const meta = (date) => line(date, -2000, { party: "Meta", categoryId: "ads_meta" });
  assert.deepEqual(pairs(matchBankLines([meta("2026-11-11"), meta("2026-11-13")], b, "pro_usd")), [[0, "meta_10"], [1, "meta_12"]]);
  // l'ordre des lignes dans le fichier ne change rien
  assert.deepEqual(pairs(matchBankLines([meta("2026-11-13"), meta("2026-11-11")], b, "pro_usd")), [[0, "meta_12"], [1, "meta_10"]]);
  // trois lignes pour deux opérations : la plus éloignée reste seule
  assert.deepEqual(pairs(matchBankLines([meta("2026-11-10"), meta("2026-11-12"), meta("2026-11-14")], b, "pro_usd")), [[0, "meta_10"], [1, "meta_12"]]);
  // une seule ligne pour deux opérations : la plus proche, et à égalité la ligne postérieure à l'opération
  assert.deepEqual(pairs(matchBankLines([meta("2026-11-12")], b, "pro_usd")), [[0, "meta_12"]]);
  assert.deepEqual(pairs(matchBankLines([meta("2026-11-11")], b, "pro_usd")), [[0, "meta_10"]]);
});

test("montants égaux : chaque opération n'est pointée qu'une fois, chaque ligne ne pointe qu'une opération", () => {
  const ops = [];
  for (let day = 1; day <= 5; day++) ops.push(pl("op_" + day, "2026-11-0" + day, -2000, "pro_usd"));
  const lines = [];
  for (let day = 1; day <= 7; day++) lines.push(line("2026-11-0" + day, -2000));
  const found = matchBankLines(lines, book(ops), "pro_usd");
  assert.equal(found.size, 5);
  assert.equal(new Set(found.values()).size, 5);
  assert.deepEqual(pairs(found).slice(0, 5), [[0, "op_1"], [1, "op_2"], [2, "op_3"], [3, "op_4"], [4, "op_5"]]);
});

test("montants égaux : le tiers ou la catégorie départagent avant la date", () => {
  // Compte personnel : des courses de 20,00 $ le même jour qu'une pub Meta de 20,00 $ déjà saisie.
  const b = book([pl("pub", "2026-10-03", -2000, "perso_usd", { party: "Meta", categoryId: "ads_meta" })]);
  const lines = [
    line("2026-10-03", -2000, { label: "Carrefour City", party: "Carrefour City", categoryId: null }),
    line("2026-10-04", -2000, { label: "Facebk *7KQ2M9XL22", party: "Meta", categoryId: "ads_meta" }),
  ];
  assert.deepEqual(pairs(matchBankLines(lines, b, "perso_usd")), [[1, "pub"]]);
  // sans indice, la date tranche
  const plain = [line("2026-10-03", -2000), line("2026-10-04", -2000)];
  assert.deepEqual(pairs(matchBankLines(plain, b, "perso_usd")), [[0, "pub"]]);
  // la catégorie seule suffit (opération ventilée comprise)
  const split = book([pl("payout", "2026-10-03", 5000, "perso_usd", { splits: [{ categoryId: "sales_shopify", amountCents: 5200 }, { categoryId: "fees_payment", amountCents: -200 }] })]);
  const incoming = [line("2026-10-03", 5000, { categoryId: null }), line("2026-10-05", 5000, { categoryId: "sales_shopify" })];
  assert.deepEqual(pairs(matchBankLines(incoming, split, "perso_usd")), [[1, "payout"]]);
});

// ---------------------------------------------------------------------------------------------
// Mouvements entre comptes

test("mouvement entre comptes : pointé une fois sur chacun de ses deux comptes", () => {
  const apport = tr("apport", "2026-11-14", 500000, "perso_usd", "pro_usd", { label: "Apport de Camille" });
  let b = book([apport]);
  const arrival = { kind: "pl", date: "2026-11-15", label: "Deposit from Camille R.", amountCents: 500000, currency: "USD", accountId: "pro_usd", extId: "bank:pro_usd:dep1" };
  const departure = { kind: "pl", date: "2026-11-14", label: "To StarringYou LLC", amountCents: -500000, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:out1" };

  assert.deepEqual(pairs(matchBankLines([arrival], b, "pro_usd")), [[0, "apport"]]);
  assert.deepEqual(pairs(matchBankLines([departure], b, "perso_usd")), [[0, "apport"]]);
  assert.equal(matchBankLines([arrival], b, "perso_usd").size, 0, "une entrée ne pointe pas le compte de départ");
  assert.equal(matchBankLines([departure], b, "pro_usd").size, 0);

  // 1. relevé du compte de l'entreprise
  const first = applyBankMatch(b.byId.get("apport"), arrival, CONFIG);
  assert.equal(first.reconciled, true);
  assert.deepEqual(first.bank, { date: "2026-11-15", label: "Deposit from Camille R.", extId: "bank:pro_usd:dep1", side: "to" });
  assert.equal(first.kind, "transfer");
  assert.equal(first.amountCents, 500000);
  assert.equal(first.toAmountCents, undefined);
  assert.deepEqual(validateOp(first, CONFIG), []);
  b = book([first]);
  assert.equal(matchBankLines([arrival], b, "pro_usd").size, 0, "ce côté est déjà pointé");
  assert.deepEqual(findDuplicate(arrival, b), { opId: "apport", exact: true });

  // 2. relevé du compte personnel : la sortie pointe le même mouvement au lieu de créer une dépense
  assert.deepEqual(pairs(matchBankLines([departure], b, "perso_usd")), [[0, "apport"]]);
  const second = applyBankMatch(b.byId.get("apport"), departure, CONFIG);
  assert.deepEqual(second.bank, {
    date: "2026-11-15", label: "Deposit from Camille R.", extId: "bank:pro_usd:dep1", side: "to",
    other: { date: "2026-11-14", label: "To StarringYou LLC", extId: "bank:perso_usd:out1", side: "from" },
  });
  b = book([second]);
  assert.equal(matchBankLines([departure], b, "perso_usd").size, 0);
  assert.equal(matchBankLines([arrival], b, "pro_usd").size, 0);
  assert.deepEqual(findDuplicate(departure, b), { opId: "apport", exact: true });
  assert.deepEqual(findDuplicate(arrival, b), { opId: "apport", exact: true });
  assert.equal(b.partners.camille.contributedCents, 500000);
  assert.equal(b.profitCents, 0);
});

test("mouvement entre comptes pointé à la main : plus candidat", () => {
  const b = book([tr("apport", "2026-11-14", 500000, "perso_usd", "pro_usd", { reconciled: true })]);
  assert.equal(matchBankLines([line("2026-11-14", 500000)], b, "pro_usd").size, 0);
  assert.equal(matchBankLines([line("2026-11-14", -500000)], b, "perso_usd").size, 0);
});

test("mouvement entre comptes en deux devises : montant arrivé repris du relevé", () => {
  // 1 000,00 EUR envoyés du compte en euros vers le compte en dollars : environ 1 100,00 $ attendus.
  const b = book([tr("change", "2026-11-10", 100000, "perso_eur", "pro_usd", { currency: "EUR" })]);
  const arrival = { kind: "pl", date: "2026-11-11", label: "Transfer from Camille", amountCents: 108700, currency: "USD", accountId: "pro_usd" };
  assert.deepEqual(pairs(matchBankLines([arrival], b, "pro_usd")), [[0, "change"]]);
  assert.equal(matchBankLines([{ ...arrival, amountCents: 120000 }], b, "pro_usd").size, 0, "9 % d'écart");
  const pointed = applyBankMatch(b.byId.get("change"), arrival, CONFIG);
  assert.equal(pointed.toAmountCents, 108700);
  assert.equal(pointed.amountCents, 100000);
  assert.equal(pointed.bank.side, "to");
  const after = book([pointed]);
  assert.equal(after.accounts.pro_usd.balanceCents, 108700);
  assert.equal(after.partners.camille.contributedCents, 108700);
  // côté départ : le montant en euros est exact
  assert.deepEqual(pairs(matchBankLines([line("2026-11-10", -100000, { currency: "EUR" })], after, "perso_eur")), [[0, "change"]]);
  assert.equal(matchBankLines([line("2026-11-10", -100100, { currency: "EUR" })], after, "perso_eur").size, 0);
  // un montant arrivé déjà saisi doit être retrouvé à l'identique
  const known = book([tr("change", "2026-11-10", 100000, "perso_eur", "pro_usd", { currency: "EUR", toAmountCents: 108700 })]);
  assert.equal(matchBankLines([arrival], known, "pro_usd").size, 1);
  assert.equal(matchBankLines([{ ...arrival, amountCents: 108800 }], known, "pro_usd").size, 0);
});

// ---------------------------------------------------------------------------------------------
// applyBankMatch

test("applyBankMatch : ne modifie ni l'opération ni la ligne, garde les champs de l'opération", () => {
  const stored = pl("op", "2026-11-10", -9477, "pro_usd", {
    label: "AppLovin, facture", party: "AppLovin", categoryId: "ads_applovin", ref: "1182-9784", note: "campagne novembre",
    attachments: [{ id: "a1", name: "recu.pdf", type: "application/pdf", size: 1200 }], source: "scan", needsReview: true,
  });
  const b = book([stored]);
  const enriched = b.byId.get("op");
  const snapshot = JSON.stringify(enriched);
  const bankLine = Object.freeze({ kind: "pl", date: "2026-11-11", label: "APPLOVIN CORPORATION", amountCents: -9477, currency: "USD", card: "0562", extId: "bank:pro_usd:txn_1" });
  const pointed = applyBankMatch(enriched, bankLine, CONFIG);
  assert.equal(JSON.stringify(enriched), snapshot);
  assert.notEqual(pointed, enriched);
  assert.deepEqual(pointed, {
    ...stored,
    card: "0562",
    reconciled: true,
    bank: { date: "2026-11-11", label: "APPLOVIN CORPORATION", extId: "bank:pro_usd:txn_1" },
  });
  // la carte déjà saisie n'est pas remplacée
  assert.equal(applyBankMatch({ ...stored, card: "2487" }, bankLine, CONFIG).card, "2487");
  // une ligne sans identifiant ni date de valeur
  assert.deepEqual(applyBankMatch(stored, { date: "2026-11-12", label: "  AppLovin ", amountCents: -9477 }, CONFIG).bank, { date: "2026-11-12", label: "AppLovin" });
});

test("applyBankMatch : montant débité seulement quand il est sûr", () => {
  const eurReceipt = pl("op", "2026-11-16", -1199, "pro_usd", { currency: "EUR" });
  // ligne dans la devise du compte
  assert.equal(applyBankMatch(eurReceipt, { date: "2026-11-16", label: "OVH", amountCents: -1302, currency: "USD" }, CONFIG).settledCents, -1302);
  // ligne sans devise : c'est celle du compte
  assert.equal(applyBankMatch(eurReceipt, { date: "2026-11-16", label: "OVH", amountCents: -1302 }, CONFIG).settledCents, -1302);
  // ligne dans la devise du reçu, sans montant débité : rien à enregistrer
  assert.equal(applyBankMatch(eurReceipt, { date: "2026-11-16", label: "OVH", amountCents: -1199, currency: "EUR" }, CONFIG).settledCents, undefined);
  // sens opposé : refusé
  assert.equal(applyBankMatch(eurReceipt, { date: "2026-11-16", label: "OVH", amountCents: 1302, currency: "USD" }, CONFIG).settledCents, undefined);
  // opération dans la devise du compte : jamais de montant débité
  const usd = pl("op2", "2026-11-16", -1302, "pro_usd");
  assert.equal(applyBankMatch(usd, { date: "2026-11-16", label: "OVH", amountCents: -1302, currency: "USD" }, CONFIG).settledCents, undefined);
});

// ---------------------------------------------------------------------------------------------
// attachMatches

test("attachMatches : pose _matchOf, garde la ligne cochée, n'est jamais un doublon en même temps", () => {
  const b = book([
    pl("recu", "2026-10-02", -9477, "perso_usd", { party: "AppLovin", categoryId: "ads_applovin" }),
    pl("deja_importee", "2026-10-05", -2000, "perso_usd", { extId: "bank:perso_usd:old", reconciled: true }),
    pl("libre_meme_montant", "2026-10-05", -2000, "perso_usd"),
  ]);
  const drafts = [
    { kind: "pl", date: "2026-10-03", label: "Applovin", amountCents: -9477, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:n1", _selected: false, _dupOf: "x", _dupExact: true },
    { kind: "pl", date: "2026-10-05", label: "Facebk", amountCents: -2000, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:old", _selected: true },
    { kind: "pl", date: "2026-10-06", label: "Courses", amountCents: -4210, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:n2", _selected: false },
    { kind: "transfer", date: "2026-10-05", label: "Virement", amountCents: 2000, currency: "USD", fromAccountId: "perso_usd", toAccountId: "pro_usd" },
  ];
  const snapshot = JSON.stringify(drafts);
  const out = attachMatches(drafts, b, "perso_usd");
  assert.equal(JSON.stringify(drafts), snapshot, "les brouillons reçus ne sont pas modifiés");
  assert.equal(out.length, 4);
  // 1. rapprochée : cochée même sur un compte personnel, plus de doublon
  assert.equal(out[0]._matchOf, "recu");
  assert.equal(out[0]._selected, true);
  assert.equal(out[0]._dupOf, null);
  assert.equal(out[0]._dupExact, false);
  // 2. déjà importée (même identifiant externe) : pas rapprochée avec l'autre opération de 20,00 $
  assert.ok(!out[1]._matchOf);
  assert.deepEqual(findDuplicate(out[1], b), { opId: "deja_importee", exact: true });
  // 3. rien à voir : inchangée
  assert.equal(out[2], drafts[2]);
  // 4. un mouvement entre comptes n'est pas une ligne de relevé
  assert.equal(out[3], drafts[3]);
});

test("deux lignes identiques pour une seule opération saisie : la première la pointe, la seconde est un nouveau mouvement", () => {
  // Une pub Meta de 20,00 $ saisie à la main ; le relevé montre deux prélèvements de 20,00 $ le même jour.
  const b = book([
    pl("pub", "2026-10-01", -2000, "perso_usd", { party: "Meta", categoryId: "ads_meta" }),
    pl("autre", "2026-10-02", -2000, "perso_usd", { party: "Canva", categoryId: "software", reconciled: true }),
  ]);
  const drafts = [
    { kind: "pl", date: "2026-10-01", label: "Facebk *7KQ2M9XL22", party: "Meta", categoryId: "ads_meta", amountCents: -2000, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:a", _selected: true },
    { kind: "pl", date: "2026-10-01", label: "Facebk *7KQ2M9XL22", party: "Meta", categoryId: "ads_meta", amountCents: -2000, currency: "USD", accountId: "perso_usd", extId: "bank:perso_usd:b", _selected: true },
  ];
  // sans rapprochement, les deux lignes ressemblent à l'opération saisie
  assert.deepEqual(drafts.map((d) => findDuplicate(d, b)), [{ opId: "pub", exact: false }, { opId: "pub", exact: false }]);
  const out = attachMatches(drafts, b, "perso_usd");
  assert.equal(out[0]._matchOf, "pub");
  assert.ok(!out[1]._matchOf);
  assert.deepEqual(out[1]._matchedOps, ["pub"]);
  // la seconde n'est plus un doublon de l'opération que la première a pointée, mais reste comparée aux autres opérations
  assert.deepEqual(findDuplicate(out[1], b), { opId: "autre", exact: false });
  assert.equal(findDuplicate(out[1], book([b.byId.get("pub")])), null);
  const annotated = annotate(out, b);
  assert.deepEqual(annotated.map((d) => [d._matchOf, d._dupOf, d._selected]), [["pub", null, true], [null, "autre", true]]);
});

test("attachMatches : sans livre ou sans liste", () => {
  const drafts = [{ kind: "pl", date: "2026-10-03", amountCents: -1, currency: "USD", accountId: "perso_usd" }];
  assert.deepEqual(attachMatches(drafts, null, "perso_usd"), drafts);
  assert.deepEqual(attachMatches(null, book([]), "perso_usd"), []);
  assert.deepEqual(attachMatches([null, 3], book([]), "perso_usd"), [null, 3]);
  // un ancien rapprochement qui ne tient plus est effacé
  const stale = [{ kind: "pl", date: "2026-10-03", amountCents: -1, currency: "USD", accountId: "perso_usd", _matchOf: "disparue" }];
  assert.equal(attachMatches(stale, book([]), "perso_usd")[0]._matchOf, null);
});

test("relevé Slash après des reçus saisis à la main : les dépenses de pub sont pointées, pas doublées", () => {
  // Reçus enregistrés avant le relevé (scan ou saisie), avec la date du reçu.
  const receipts = [
    pl("recu_applovin", "2026-11-14", -9477, "pro_usd", { party: "AppLovin", categoryId: "ads_applovin", card: "0562", source: "scan" }),
    pl("recu_meta", "2026-11-14", -18025, "pro_usd", { party: "Meta", categoryId: "ads_meta", source: "manual" }),
    pl("recu_heygen", "2026-11-17", -2900, "pro_usd", { party: "HeyGen", categoryId: "production_ai", source: "scan" }),
    tr("apport_idris", "2026-11-13", 1000000, "perso_usd", "pro_usd", { label: "Apport" }),
  ];
  const before = book(receipts);
  const result = importer("bank_slash").parse(load("bank_slash.csv"), { config: CONFIG, book: before, accountId: "pro_usd" });
  const drafts = annotate(result.drafts, before);
  const matchOf = Object.fromEntries(drafts.filter((d) => d._matchOf).map((d) => [d.ref, d._matchOf]));
  assert.deepEqual(matchOf, {
    txn_2b7f9c1e: "recu_applovin",
    txn_2b7f9e55: "apport_idris",
    txn_2b7fa1c3: "recu_meta",
    txn_2b7fa4f6: "recu_heygen",
  });
  assert.ok(drafts.every((d) => !d._dupOf));
  assert.ok(result.info.some((s) => /4 lignes correspondent à des opérations déjà saisies/.test(s)));
  // Rien de ce qui est pointé ne crée d'opération : il reste le remboursement Klaviyo, le virement Shopify, ElevenLabs et l'abonnement Slash.
  assert.deepEqual(drafts.filter((d) => d._selected && !d._matchOf).map((d) => d.amountCents), [100, 84219, -2200, -2500]);
});

// ---------------------------------------------------------------------------------------------
// Relevé importé d'abord, détail ensuite

test("relevé importé avant les virements Shopify : le virement complète la ligne du relevé au lieu de la doubler", () => {
  // 1. Le relevé Revolut est importé en premier : la ligne Shopify devient une vente, sans détail.
  const first = importer("bank_revolut").parse(load("bank_revolut_en.csv"), { config: CONFIG, book: book([]), accountId: "perso_usd" });
  const bankDraft = first.drafts.find((d) => d.label === "Payment from Shopify Inc");
  const bankOp = { id: "op_releve" };
  for (const key of Object.keys(bankDraft)) if (key[0] !== "_") bankOp[key] = bankDraft[key];
  const b1 = book([bankOp]);
  assert.equal(b1.profitCents, 123456);

  // 2. L'export des virements Shopify arrive ensuite, daté de la veille par Shopify.
  const payout = { ...PAYOUTS[0], date: "2026-10-05" };
  delete payout.id;
  const dup = findDuplicate(payout, b1);
  assert.deepEqual(dup, { opId: "op_releve", exact: false });

  const completed = completeBankOp(b1.byId.get(dup.opId), payout);
  assert.equal(completed.id, "op_releve");
  assert.equal(completed.date, "2026-10-05");
  assert.equal(completed.label, "Virement Shopify du 05/10");
  assert.equal(completed.amountCents, 123456);
  assert.deepEqual(completed.splits, PAYOUTS[0].splits);
  assert.equal(completed.source, "shopify");
  assert.equal(completed.extId, "shopify_payout:2026-10-05:123456");
  assert.equal(completed.reconciled, true);
  assert.deepEqual(completed.bank, { date: "2026-10-06", label: "Payment from Shopify Inc", extId: bankDraft.extId });
  assert.equal(completed.needsReview, undefined);
  assert.deepEqual(validateOp(completed, CONFIG), []);
  assert.equal(b1.byId.get("op_releve").source, "revolut", "l'opération du livre n'est pas modifiée");

  // 3. Une seule opération, les ventes et les frais sont détaillés, et les deux fichiers sont reconnus à un nouvel import.
  const b2 = book([completed]);
  assert.equal(b2.ops.length, 1);
  assert.equal(b2.profitCents, 123456);
  assert.deepEqual(b2.byId.get("op_releve").lines.map((l) => [l.categoryId, l.baseCents]), [["sales_shopify", 130000], ["refunds", -2000], ["fees_payment", -4544]]);
  assert.deepEqual(findDuplicate(payout, b2), { opId: "op_releve", exact: true });
  assert.deepEqual(findDuplicate(bankDraft, b2), { opId: "op_releve", exact: true });
  const again = importer("bank_revolut").parse(load("bank_revolut_en.csv"), { config: CONFIG, book: b2, accountId: "perso_usd" });
  assert.equal(again.drafts.filter((d) => d._matchOf).length, 0);
});

test("completeBankOp : reçu en dollars sur une ligne de relevé en euros, ventilation qui ne tombe pas juste", () => {
  const bankOp = pl("op_releve", "2026-10-03", -8660, "perso_eur", {
    currency: "EUR", label: "Klaviyo", extId: "bank:perso_eur:k1", source: "revolut", reconciled: true, needsReview: true, bank: { date: "2026-10-04", label: "KLAVIYO INC" },
  });
  const receipt = { kind: "pl", date: "2026-10-02", label: "Klaviyo, abonnement octobre", amountCents: -9477, currency: "USD", categoryId: "email_sms", party: "Klaviyo", ref: "2648-3340", source: "scan",
    attachments: [{ id: "a1", name: "recu.pdf", type: "application/pdf", size: 900 }] };
  const done = completeBankOp(bankOp, receipt);
  assert.deepEqual([done.amountCents, done.currency, done.settledCents, done.date, done.categoryId, done.ref], [-9477, "USD", -8660, "2026-10-02", "email_sms", "2648-3340"]);
  assert.deepEqual(done.bank, { date: "2026-10-04", label: "KLAVIYO INC", extId: "bank:perso_eur:k1" });
  assert.equal(done.needsReview, undefined);
  assert.equal(done.attachments.length, 1);
  assert.deepEqual(validateOp(done, CONFIG), []);
  const after = book([done]);
  assert.equal(after.accounts.perso_eur.balanceCents, -8660);
  assert.equal(after.byId.get("op_releve").baseCents, -9477);

  // ventilation dont le total ne correspond pas au relevé : on garde le montant du relevé et la catégorie simple
  const odd = completeBankOp(pl("op2", "2026-10-07", 123456, "perso_usd", { extId: "bank:perso_usd:x", reconciled: true }),
    { kind: "pl", date: "2026-10-05", amountCents: 123456, currency: "USD", categoryId: "sales_shopify", splits: [{ categoryId: "sales_shopify", amountCents: 100000 }] });
  assert.equal(odd.splits, undefined);
  assert.equal(odd.categoryId, "sales_shopify");
  assert.deepEqual(validateOp(odd, CONFIG), []);
  // un brouillon de mouvement entre comptes ne complète pas une dépense
  const same = completeBankOp(bankOp, { kind: "transfer", date: "2026-10-02", amountCents: 8660, currency: "EUR" });
  assert.deepEqual([same.amountCents, same.currency, same.label], [-8660, "EUR", "Klaviyo"]);
});
