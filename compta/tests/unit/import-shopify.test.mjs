// Importeurs Shopify, de bout en bout : octets du fichier -> decodeBytes -> parseCsv -> detect -> parse.
// Les fichiers de tests/fixtures/shopify_*.csv reprennent la forme des vrais exports, avec des valeurs inventées.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { decodeBytes, parseCsv } from "../../src/core/importers/csv.js";
import { IMPORTERS } from "../../src/core/importers/shopify.js";
import { defaultConfig, normalizeConfig, normalizeOp, validateOp } from "../../src/core/model.js";
import { buildBook, summarize } from "../../src/core/ledger.js";
import { findDuplicate } from "../../src/core/recon.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
const SOURCE_FILE = path.join(HERE, "..", "..", "src", "core", "importers", "shopify.js");

const bytesOf = (name) => readFileSync(path.join(FIXTURES, name));
const load = (name) => parseCsv(decodeBytes(bytesOf(name)));
const csv = (lines) => parseCsv(lines.join("\n") + "\n");
const importer = (type) => IMPORTERS.find((i) => i.type === type);
const payouts = importer("shopify_payouts");
const transactions = importer("shopify_transactions");
const orders = importer("shopify_orders");
const billing = importer("shopify_billing");

const config = normalizeConfig({
  ...defaultConfig(),
  accounts: {
    slash: { id: "slash", name: "Slash", kind: "bank", owner: "business", currency: "USD" },
    perso: { id: "perso", name: "Compte perso", kind: "bank", owner: "unknown", currency: "EUR" },
  },
});
const ctx = (extra = {}) => ({ config, book: null, accountId: "slash", options: {}, ...extra });

// Les montants affichés utilisent des espaces insécables : on les remplace pour comparer du texte simple.
const plain = (text) => String(text).replace(/[\u00a0\u202f]/g, " ");
const texts = (list) => list.map(plain);
const hasLine = (list, ...parts) => texts(list).some((line) => parts.every((part) => line.includes(part)));
const splitsOf = (draft) => Object.fromEntries(draft.splits.map((s) => [s.categoryId, s.amountCents]));
const splitSum = (draft) => draft.splits.reduce((total, s) => total + s.amountCents, 0);
const byDate = (drafts, date) => drafts.find((d) => d.date === date);

function assertResultShape(result) {
  assert.ok(result && typeof result === "object");
  assert.ok(Array.isArray(result.drafts));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.info));
  assert.ok(result.stats === null || typeof result.stats === "object");
  for (const line of [...result.warnings, ...result.info]) assert.equal(typeof line, "string");
}

// Un virement est toujours une opération "pl" dont la ventilation tombe juste, au centime.
function assertPayoutDraft(draft) {
  assert.equal(draft.kind, "pl");
  assert.equal(draft.party, "Shopify");
  assert.equal(draft.source, "shopify");
  assert.match(draft.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(draft.amountCents) && draft.amountCents !== 0);
  assert.ok(draft.extId.startsWith("shopify_payout:"));
  assert.equal(typeof draft.needsReview, "boolean");
  assert.ok(draft.splits.length >= 1);
  for (const s of draft.splits) assert.ok(Number.isInteger(s.amountCents) && s.amountCents !== 0 && !Object.is(s.amountCents, -0));
  assert.equal(splitSum(draft), draft.amountCents, "la ventilation doit valoir le net du virement " + draft.date);
  const m = draft.meta;
  assert.equal(draft.amountCents, m.grossCents - m.refundsCents - m.feesCents + m.adjustmentsCents, "identité des montants du virement " + draft.date);
  assert.ok(m.refundsCents >= 0 && !Object.is(m.refundsCents, -0));
  const dd = draft.date.slice(8, 10) + "/" + draft.date.slice(5, 7);
  assert.equal(draft.label, (draft.amountCents < 0 ? "Prélèvement Shopify du " : "Virement Shopify du ") + dd);
}

/* ------------------------------------------------------------------ registre et détection */

test("IMPORTERS : quatre importeurs au contrat attendu", () => {
  assert.deepEqual(IMPORTERS.map((i) => i.type), ["shopify_payouts", "shopify_transactions", "shopify_orders", "shopify_billing"]);
  for (const imp of IMPORTERS) {
    assert.equal(typeof imp.label, "string");
    assert.ok(imp.label.length > 5);
    assert.ok(imp.help.startsWith("Dans Shopify : "));
    assert.equal(typeof imp.detect, "function");
    assert.equal(typeof imp.parse, "function");
    assert.equal(imp.needs.platform, false);
  }
  assert.deepEqual(payouts.needs, { account: true, platform: false });
  assert.deepEqual(transactions.needs, { account: true, platform: false });
  assert.deepEqual(orders.needs, { account: false, platform: false });
  assert.deepEqual(billing.needs, { account: true, platform: false });
});

const OWN_FIXTURES = {
  shopify_payouts: /^shopify_payouts/,
  shopify_transactions: /^shopify_transactions/,
  shopify_orders: /^shopify_orders/,
  shopify_billing: /^shopify_billing/,
};

test("detect : sûr de lui sur ses fichiers, sous 0,3 sur tous les autres fichiers de tests/fixtures", () => {
  const files = readdirSync(FIXTURES).filter((name) => /\.(csv|tsv|txt)$/i.test(name)).sort();
  const seen = { shopify_payouts: 0, shopify_transactions: 0, shopify_orders: 0, shopify_billing: 0 };
  for (const name of files) {
    const parsed = load(name);
    for (const imp of IMPORTERS) {
      const score = imp.detect(parsed);
      assert.ok(score >= 0 && score <= 1, `${imp.type} sur ${name} : ${score}`);
      if (OWN_FIXTURES[imp.type].test(name)) {
        seen[imp.type]++;
        assert.ok(score >= 0.9, `${imp.type} devrait reconnaître ${name} (confiance ${score})`);
      } else {
        assert.ok(score < 0.3, `${imp.type} ne devrait pas reconnaître ${name} (confiance ${score})`);
      }
    }
  }
  assert.deepEqual(seen, { shopify_payouts: 2, shopify_transactions: 2, shopify_orders: 2, shopify_billing: 1 });
});

test("detect : exports voisins et entrées invalides", () => {
  const others = [
    // Deuxième bouton du même écran Shopify : historique des transactions des commandes.
    csv(["Order,Name,Payment Method,Kind,Gateway,Created At,Status,Amount,Currency,Card Type",
      "6312455500131,#2316,Shopify Payments,sale,shopify_payments,2026-11-18 11:05:19 -0500,success,59.00,USD,visa"]),
    // Rapport Stripe.
    csv(["balance_transaction_id,created,reporting_category,gross,fee,net,currency,automatic_payout_id",
      "txn_1,2026-11-18 11:05:19,charge,59.00,2.01,56.99,usd,po_1"]),
    // Activité PayPal.
    csv(["Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net",
      "11/18/2026,11:05:19,PST,Sam Buyer,Express Checkout Payment,Completed,USD,59.00,-2.36,56.64"]),
    // Relevé bancaire.
    csv(["Date,Description,Amount,Currency,Status,Total",
      "2026-11-18,SHOPIFY PAYOUT,397.65,USD,paid,397.65"]),
    // Export publicitaire.
    csv(["Day,Campaign name,Amount spent (USD),Impressions,Purchases", "2026-11-18,Dragon,94.77,12000,4"]),
  ];
  for (const parsed of others) for (const imp of IMPORTERS) assert.equal(imp.detect(parsed), 0);
  for (const bad of [null, undefined, 42, "texte", {}, { headers: null, rows: null }, { headers: ["Payout Date"], rows: [null, 5, ["x"]] }]) {
    for (const imp of IMPORTERS) assert.equal(imp.detect(bad), 0);
  }
  // Bons titres mais lignes qui ne ressemblent à rien : confiance divisée par deux.
  const odd = csv(["Payout Date,Status,Charges,Refunds,Fees,Retried Amount,Total,Currency", "hier,paid,a,b,c,d,e,USD", "demain,paid,a,b,c,d,e,USD"]);
  assert.equal(payouts.detect(odd), 0.5);
  // Titres incomplets : confiance moyenne, et sous 0,3 si en plus les lignes ne ressemblent à rien.
  assert.equal(payouts.detect(csv(["Payout Date,Charges,Fees,Total", "2026-11-20,412.00,14.35,397.65"])), 0.5);
  assert.equal(payouts.detect(csv(["Payout Date,Charges,Fees,Total", "hier,a,b,c"])), 0.25);
  assert.equal(transactions.detect(csv(["Transaction Date,Type,Payout Date,Net", "2026-11-20 10:00:00 -0500,charge,2026-11-22,56.99"])), 0.5);
  assert.equal(orders.detect(csv(["Name,Created at,Lineitem quantity,Lineitem price", "#1,2026-11-18 11:05:02 -0500,1,59.00"])), 0.5);
  assert.equal(billing.detect(csv(["Bill #,Description,Amount", "612345678,Subscription Fee,39.0"])), 0.5);
  assert.equal(billing.detect(csv(["Bill #,Description,Amount", "abc,Subscription Fee,39.0"])), 0.25);
  // Fichier vide mais bons titres : c'est bien le bon type.
  assert.equal(payouts.detect({ headers: ["Payout Date", "Status", "Charges", "Refunds", "Fees", "Total"], rows: [] }), 0.9);
});

/* ------------------------------------------------------------------ 1. liste des virements */

const PAYOUT_ROWS = [
  // date, net, ventilation, à vérifier, estimé, statut
  ["2026-11-23", 18165, { sales_shopify: 18800, fees_payment: -635 }, true, true, "scheduled"],
  ["2026-11-21", 5699, { sales_shopify: 5900, fees_payment: -201 }, true, true, "in_transit"],
  ["2026-11-20", 39765, { sales_shopify: 41200, fees_payment: -1435 }, false, false, "paid"],
  ["2026-11-19", 3334, { sales_shopify: 16410, refunds: -4900, fees_payment: -2036, chargebacks: -6140 }, false, false, "paid"],
  ["2026-11-17", 11727, { sales_shopify: 17700, fees_payment: -573, chargebacks: -5400 }, false, false, "paid"],
  ["2026-11-14", 5028, { sales_shopify: 4900, fees_payment: -172, chargebacks: 300 }, false, false, "paid"],
  ["2026-11-13", 16801, { sales_shopify: 31000, refunds: -13120, fees_payment: -1079 }, false, false, "paid"],
  ["2026-11-10", 73111, { sales_shopify: 84525, fees_payment: -2961, chargebacks: -8453 }, false, false, "paid"],
  ["2026-11-06", 4570, { sales_shopify: 4858, fees_payment: -1788, chargebacks: 3000, other_expense: -1500 }, true, false, "paid"],
  ["2026-11-05", -7790, { refunds: -7790 }, false, false, "paid"],
  ["2026-11-04", 5286, { sales_shopify: 5487, fees_payment: -201 }, false, false, "paid"],
];

test("virements : un brouillon par virement, net exact et ventilation qui tombe juste", () => {
  const parsed = load("shopify_payouts.csv");
  assert.equal(payouts.detect(parsed), 1);
  const result = payouts.parse(parsed, ctx());
  assertResultShape(result);
  assert.equal(result.stats, null);
  assert.equal(result.drafts.length, PAYOUT_ROWS.length);
  result.drafts.forEach((draft, i) => {
    const [date, cents, splits, review, estimated, status] = PAYOUT_ROWS[i];
    assertPayoutDraft(draft);
    assert.equal(draft.date, date);
    assert.equal(draft.amountCents, cents);
    assert.equal(draft.currency, "USD");
    assert.equal(draft.accountId, "slash");
    assert.deepEqual(splitsOf(draft), splits);
    assert.equal(draft.needsReview, review, "needsReview du " + date);
    assert.equal(draft.estimated === true, estimated, "estimated du " + date);
    assert.equal(draft.meta.status, status);
    assert.equal(draft.meta.payoutId, undefined);
    assert.equal(draft.extId, `shopify_payout:${date}:${cents}`);
  });
});

test("virements : forme exacte d'un brouillon", () => {
  const { drafts } = payouts.parse(load("shopify_payouts.csv"), ctx());
  assert.deepEqual(byDate(drafts, "2026-11-19"), {
    kind: "pl",
    date: "2026-11-19",
    label: "Virement Shopify du 19/11",
    accountId: "slash",
    amountCents: 3334,
    currency: "USD",
    splits: [
      { categoryId: "sales_shopify", amountCents: 16410 },
      { categoryId: "refunds", amountCents: -4900 },
      { categoryId: "fees_payment", amountCents: -2036 },
      { categoryId: "chargebacks", amountCents: -6140 },
    ],
    party: "Shopify",
    source: "shopify",
    extId: "shopify_payout:2026-11-19:3334",
    needsReview: false,
    meta: { status: "paid", grossCents: 16410, refundsCents: 4900, feesCents: 2036, adjustmentsCents: -6140, bankRef: "4T7J8L3PW6", export: "payouts" },
    ref: "4T7J8L3PW6",
  });
});

test("virements : cas particuliers du fichier (échec repris, réserve, écart, prélèvement, taxe retenue)", () => {
  const { drafts } = payouts.parse(load("shopify_payouts.csv"), ctx());

  // Le virement échoué du 12/11 est repris le 13/11 : son remboursement est compté là où l'argent a bougé.
  const retried = byDate(drafts, "2026-11-13");
  assert.equal(retried.meta.retriedFrom, "2026-11-12");
  assert.equal(retried.meta.refundsCents, 13120);
  assert.equal(retried.meta.adjustmentsCents, 0);
  assert.equal(retried.needsReview, false);
  assert.equal(byDate(drafts, "2026-11-12"), undefined);
  assert.equal(byDate(drafts, "2026-11-02"), undefined);

  // Réserve : dans les litiges et ajustements, montant gardé dans meta.
  assert.equal(byDate(drafts, "2026-11-10").meta.reservedCents, -8453);
  assert.equal(byDate(drafts, "2026-11-17").meta.reservedCents, -2000);

  // Écart de 15,00 que les colonnes n'expliquent pas : ligne "Autres dépenses", à vérifier, valeur entre guillemets lue.
  const gap = byDate(drafts, "2026-11-06");
  assert.equal(gap.meta.unexplainedCents, -1500);
  assert.equal(gap.meta.adjustmentsCents, 1500);
  assert.equal(gap.ref, "4T6X1W8,NB3");
  assert.match(plain(gap._note), /15,00 \$ non expliqués/);

  // Total négatif : Shopify reprend de l'argent, c'est une sortie.
  const debit = byDate(drafts, "2026-11-05");
  assert.equal(debit.label, "Prélèvement Shopify du 05/11");
  assert.equal(debit.extId, "shopify_payout:2026-11-05:-7790");
  assert.deepEqual(debit.meta, { status: "paid", grossCents: 0, refundsCents: 7790, feesCents: 0, adjustmentsCents: 0, bankRef: "4T6V7E2MC9", export: "payouts" });

  // Taxe retenue par Shopify (marketplace) : déduite des ventes.
  const market = byDate(drafts, "2026-11-04");
  assert.equal(market.meta.grossCents, 5900);
  assert.equal(market.meta.adjustmentsCents, -413);

  // Pas encore versé : estimation à vérifier, sans référence bancaire.
  const upcoming = byDate(drafts, "2026-11-23");
  assert.equal(upcoming.ref, undefined);
  assert.equal(upcoming._note, "Pas encore versé par Shopify : montant estimé.");
  assert.equal(byDate(drafts, "2026-11-20")._note, undefined);
});

test("virements : avertissements avec numéro de ligne, et résumé en français", () => {
  const result = payouts.parse(load("shopify_payouts.csv"), ctx());
  assert.deepEqual(texts(result.warnings), [
    "Ligne 14 : date du virement illisible (\"bientot\"), ligne ignorée.",
    "Ligne 15 : montant total du virement du 03/11 absent ou illisible, ligne ignorée.",
    "Virement du 06/11 (ligne 11) : les colonnes du fichier n'expliquent pas 15,00 $ du total (souvent des frais de litige). " +
      "L'écart est classé en \"Autres dépenses\", à vérifier.",
  ]);
  const info = texts(result.info);
  assert.equal(info[0], "11 virements Shopify du 04/11/2026 au 23/11/2026.");
  assert.equal(info[1], "Déjà versé : 1 518,32 $ en 9 virements (ventes 2 060,80 $, remboursements -258,10 $, frais de paiement -102,45 $).");
  assert.ok(info[2].startsWith("Pas encore versé : 238,64 $ en 2 virements, importé comme estimation"));
  assert.ok(hasLine(result.info, "échoué du 12/11", "-131,20 $", "repris dans le virement du 13/11"));
  assert.ok(hasLine(result.info, "annulé du 02/11", "24,13 $", "n'est pas importé"));
  assert.ok(hasLine(result.info, "Virement du 10/11", "84,53 $ en réserve"));
  assert.ok(hasLine(result.info, "Le 05/11", "repris 77,90 $"));
});

test("virements : ancien format repassé par un Excel français (BOM, point-virgule, virgule décimale, JJ/MM/AAAA, ligne de total)", () => {
  const bytes = bytesOf("shopify_payouts_ancien_fr.csv");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const parsed = parseCsv(decodeBytes(bytes));
  assert.equal(parsed.delimiter, ";");
  assert.equal(payouts.detect(parsed), 1);

  const result = payouts.parse(parsed, ctx({ accountId: "perso" }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, d.currency, d.extId, d.needsReview, d.accountId]), [
    ["2026-11-20", 39765, "EUR", "shopify_payout:2026-11-20:39765", false, "perso"],
    ["2026-11-19", 118530, "EUR", "shopify_payout:2026-11-19:118530", false, "perso"],
    ["2026-11-05", -7790, "EUR", "shopify_payout:2026-11-05:-7790", false, "perso"],
  ]);
  result.drafts.forEach(assertPayoutDraft);
  assert.deepEqual(splitsOf(result.drafts[1]), { sales_shopify: 128950, refunds: -5900, fees_payment: -4520 });
  assert.equal(texts(result.info)[1], "Déjà versé : 1 505,05 € en 3 virements (ventes 1 701,50 €, remboursements -136,90 €, frais de paiement -59,55 €).");

  // La devise du fichier est gardée même si le compte choisi est dans une autre devise : on prévient seulement.
  const other = payouts.parse(parsed, ctx({ accountId: "slash" }));
  assert.deepEqual(other.drafts.map((d) => d.currency), ["EUR", "EUR", "EUR"]);
  assert.deepEqual(texts(other.warnings), [
    "Ces virements sont en EUR alors que le compte choisi est en USD : vérifie que c'est bien le compte qui reçoit les virements Shopify.",
  ]);
});

test("virements : format 2022, écarts de frais de litige dans les deux sens, échec repris", () => {
  const parsed = csv([
    "Payout Date,Status,Charges,Refunds,Adjustments,Reserved Funds,Fees,Retried Amount,Total,Currency",
    "2023-03-27,paid,0.00,0.00,-64.20,0.00,15.00,0.00,-94.20,USD",
    "2022-12-13,paid,0.00,-58.40,-30.00,0.00,-15.00,0.00,-58.40,USD",
    "2022-11-25,paid,52.30,0.00,0.00,0.00,1.82,-140.75,-90.27,USD",
    "2022-11-21,failed,0.00,-140.75,0.00,0.00,0.00,0.00,-140.75,USD",
  ]);
  assert.equal(payouts.detect(parsed), 1);
  const result = payouts.parse(parsed, ctx());
  result.drafts.forEach(assertPayoutDraft);
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, splitsOf(d), d.needsReview]), [
    ["2023-03-27", -9420, { fees_payment: -1500, chargebacks: -6420, other_expense: -1500 }, true],
    ["2022-12-13", -5840, { refunds: -5840, fees_payment: 1500, chargebacks: -3000, other_income: 1500 }, true],
    ["2022-11-25", -9027, { sales_shopify: 5230, refunds: -14075, fees_payment: -182 }, false],
  ]);
  assert.equal(result.warnings.length, 2);
  assert.ok(hasLine(result.warnings, "Virement du 27/03 (ligne 2)", "15,00 $", "\"Autres dépenses\""));
  assert.ok(hasLine(result.warnings, "Virement du 13/12 (ligne 3)", "15,00 $", "\"Autres encaissements\""));
});

test("virements : deux échecs de suite puis reprise, le détail remonte jusqu'au virement versé", () => {
  const result = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Adjustments,Reserved Funds,Fees,Retried Amount,Total,Currency",
    "2026-10-09,paid,80.00,0.00,0.00,0.00,2.62,150.55,227.93,USD",
    "2026-10-07,failed,60.00,0.00,0.00,0.00,2.04,92.59,150.55,USD",
    "2026-10-05,Failed,95.00,0.00,0.00,0.00,2.41,0.00,92.59,USD",
    "2026-10-03,canceled,10.00,0.00,0.00,0.00,0.59,0.00,9.41,USD",
  ]), ctx());
  assert.equal(result.drafts.length, 1);
  const draft = result.drafts[0];
  assertPayoutDraft(draft);
  assert.equal(draft.amountCents, 22793);
  assert.deepEqual(splitsOf(draft), { sales_shopify: 23500, fees_payment: -707 });
  assert.equal(draft.needsReview, false);
  assert.equal(draft.meta.retriedFrom, "2026-10-07");
  assert.deepEqual(result.warnings, []);
  assert.ok(hasLine(result.info, "virement échoué du 07/10 (150,55 $)", "repris dans le virement du 09/10"));
  assert.ok(hasLine(result.info, "virement échoué du 05/10 (92,59 $)", "repris dans le virement du 07/10"));
  assert.ok(hasLine(result.info, "virement annulé du 03/10 (9,41 $) n'est pas importé : l'argent n'a pas bougé."));
});

test("virements : colonnes manquantes, statuts inattendus, devise absente", () => {
  // Montant reporté d'un virement échoué qui n'est pas dans le fichier : classé à part, à vérifier.
  const unmatched = csv(["Payout Date,Status,Charges,Fees,Retried Amount,Total,Currency", "2026-10-05,paid,100.00,3.20,45.10,141.90,USD"]);
  assert.equal(payouts.detect(unmatched), 0.5);
  let result = payouts.parse(unmatched, ctx());
  assert.deepEqual(splitsOf(result.drafts[0]), { sales_shopify: 10000, fees_payment: -320, other_income: 4510 });
  assert.equal(result.drafts[0].needsReview, true);
  assert.ok(hasLine(result.warnings, "Virement du 05/10 (ligne 2)", "45,10 $", "report d'un virement échoué", "\"Autres encaissements\""));

  // Sans colonne Total : le net est recalculé, avec un avertissement.
  result = payouts.parse(csv(["Payout Date,Status,Charges,Refunds,Fees,Currency", "2026-10-06,paid,200.00,-20.00,6.10,USD"]), ctx());
  assert.equal(result.drafts[0].amountCents, 17390);
  assert.deepEqual(splitsOf(result.drafts[0]), { sales_shopify: 20000, refunds: -2000, fees_payment: -610 });
  assert.ok(hasLine(result.warnings, "Colonne \"Total\" absente"));

  // Sans colonne Status : tout est considéré comme versé.
  result = payouts.parse(csv(["Payout Date,Charges,Refunds,Fees,Total,Currency", "2026-10-06,200.00,-20.00,6.10,173.90,USD"]), ctx());
  assert.equal(result.drafts[0].needsReview, false);
  assert.equal(result.drafts[0].meta.status, "paid");
  assert.ok(hasLine(result.warnings, "Colonne \"Status\" absente"));

  // Statut inconnu : gardé, à vérifier, pas "estimé". Synonymes de "paid" acceptés. Virement à zéro ignoré.
  result = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Fees,Total,Currency",
    "2026-10-09,on_hold,50.00,0.00,1.75,48.25,USD",
    "2026-10-08,Deposited,50.00,0.00,1.75,48.25,USD",
    "2026-10-07,paid,50.00,-48.25,1.75,0.00,USD",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => [d.date, d.needsReview, d.estimated, d.meta.status]), [
    ["2026-10-09", true, undefined, "on_hold"],
    ["2026-10-08", false, undefined, "paid"],
  ]);
  assert.ok(hasLine(result.warnings, "Virement du 09/10 (ligne 2)", "statut \"on_hold\" non reconnu"));
  assert.ok(hasLine(result.info, "1 virement à 0 ignoré"));

  // Sans colonne Currency : devise du compte choisi, sinon USD ; l'option `currency` passe avant.
  const noCurrency = csv(["Payout Date,Status,Charges,Refunds,Fees,Total", "2026-10-06,paid,200.00,-20.00,6.10,173.90"]);
  assert.equal(payouts.parse(noCurrency, ctx({ accountId: "perso" })).drafts[0].currency, "EUR");
  assert.equal(payouts.parse(noCurrency, ctx({ accountId: "perso", options: { currency: "gbp" } })).drafts[0].currency, "GBP");
  result = payouts.parse(noCurrency);
  assert.equal(result.drafts[0].currency, "USD");
  assert.equal(result.drafts[0].accountId, undefined);
  assert.ok(hasLine(result.info, "Devise absente du fichier : montants lus en USD."));
});

test("virements : identifiant, dates américaines, doublons dans le fichier, fichier vide", () => {
  // Si Shopify ajoute un jour l'identifiant du virement à cet export, il sert de clé.
  let result = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Fees,Total,Currency,Payout ID",
    "2026-10-06,paid,200.00,-20.00,6.10,173.90,USD,134700000001",
  ]), ctx());
  assert.equal(result.drafts[0].extId, "shopify_payout:134700000001");
  assert.equal(result.drafts[0].meta.payoutId, "134700000001");

  // Fichier repassé par un Excel américain : mois d'abord, montants avec séparateur de milliers.
  result = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Fees,Total,Currency",
    "11/20/2026,paid,\"1,412.00\",0.00,41.25,\"1,370.75\",USD",
    "11/5/2026,paid,412.00,0.00,14.35,397.65,USD",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents]), [["2026-11-20", 137075], ["2026-11-05", 39765]]);

  // Deux virements identiques le même jour : la deuxième clé reçoit un rang.
  result = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Fees,Total,Currency",
    "2026-10-06,paid,100.00,0.00,3.20,96.80,USD",
    "2026-10-06,paid,100.00,0.00,3.20,96.80,USD",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => d.extId), ["shopify_payout:2026-10-06:9680", "shopify_payout:2026-10-06:9680:2"]);

  result = payouts.parse({ headers: ["Payout Date", "Status", "Charges", "Refunds", "Fees", "Total"], rows: [] }, ctx());
  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.warnings, ["Le fichier ne contient aucun virement."]);
});

/* ------------------------------------------------------------------ 2. transactions des virements */

test("transactions : regroupées par virement, mêmes brouillons que la liste des virements", () => {
  const parsed = load("shopify_transactions.csv");
  assert.equal(transactions.detect(parsed), 1);
  const result = transactions.parse(parsed, ctx());
  assertResultShape(result);
  assert.equal(result.stats, null);
  result.drafts.forEach(assertPayoutDraft);
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, splitsOf(d), d.needsReview, d.estimated === true, d.extId]), [
    ["2026-11-21", 5699, { sales_shopify: 5900, fees_payment: -201 }, true, true, "shopify_payout:134774400888"],
    ["2026-11-19", 3334, { sales_shopify: 16410, refunds: -4900, fees_payment: -536, chargebacks: -7640 }, false, false, "shopify_payout:134772916323"],
    ["2026-11-17", 11727, { sales_shopify: 18200, fees_payment: -573, chargebacks: -2000, shopify_sub: -3900 }, false, false, "shopify_payout:134771100200"],
    ["2026-11-14", 5028, { sales_shopify: 4900, fees_payment: -172, other_income: 300 }, true, false, "shopify_payout:134769955111"],
  ]);
  assert.deepEqual(byDate(result.drafts, "2026-11-19"), {
    kind: "pl",
    date: "2026-11-19",
    label: "Virement Shopify du 19/11",
    accountId: "slash",
    amountCents: 3334,
    currency: "USD",
    splits: [
      { categoryId: "sales_shopify", amountCents: 16410 },
      { categoryId: "refunds", amountCents: -4900 },
      { categoryId: "fees_payment", amountCents: -536 },
      { categoryId: "chargebacks", amountCents: -7640 },
    ],
    party: "Shopify",
    source: "shopify",
    extId: "shopify_payout:134772916323",
    needsReview: false,
    meta: { payoutId: "134772916323", status: "paid", grossCents: 16410, refundsCents: 4900, feesCents: 536, adjustmentsCents: -7640, txCount: 5, orderCount: 2, export: "transactions" },
  });
  assert.deepEqual(byDate(result.drafts, "2026-11-17").meta, {
    payoutId: "134771100200", status: "paid", grossCents: 17700, refundsCents: 0, feesCents: 573, adjustmentsCents: -5400,
    reservedCents: -2000, txCount: 5, orderCount: 2, export: "transactions",
  });
  assert.equal(byDate(result.drafts, "2026-11-21").meta.status, "in_transit");
  assert.equal(byDate(result.drafts, "2026-11-14").meta.unexplainedCents, 300);

  // Les mêmes virements dans la liste des virements : même date, même net, même devise.
  const list = payouts.parse(load("shopify_payouts.csv"), ctx()).drafts;
  for (const draft of result.drafts) {
    const twin = byDate(list, draft.date);
    assert.equal(twin.amountCents, draft.amountCents);
    assert.equal(twin.currency, draft.currency);
    assert.equal(twin.meta.grossCents, draft.meta.grossCents);
  }
});

test("transactions : lignes ignorées, avertissements et résumé", () => {
  const result = transactions.parse(load("shopify_transactions.csv"), ctx());
  assert.deepEqual(texts(result.warnings), [
    "Ligne 19 : date du virement absente, transaction ignorée.",
    "Ligne 20 : montant net absent ou illisible, transaction ignorée.",
    "Virement du 17/11 : une facture Shopify a été payée avec ton solde Shopify (39,00 $, classé en \"Abonnement Shopify\"). " +
      "Si tu importes aussi les factures Shopify, ne la compte pas deux fois.",
    "Virement du 14/11 : type de transaction inconnu \"loyalty_bonus\" (ligne 17). 3,00 $ classés en \"Autres encaissements\", à vérifier.",
    "Le premier et le dernier virement du fichier (14/11 et 21/11) peuvent être incomplets si l'export a été filtré par dates : " +
      "ils sont marqués \"À vérifier\", compare leur montant avec ton relevé bancaire.",
  ]);
  const info = texts(result.info);
  assert.equal(info[0], "4 virements Shopify reconstitués à partir de 13 transactions, du 14/11/2026 au 21/11/2026.");
  assert.equal(info[1], "Déjà versé : 200,89 $ en 3 virements (ventes 395,10 $, remboursements -49,00 $, frais de paiement -12,81 $).");
  assert.ok(hasLine(result.info, "Pas encore versé : 56,99 $ en 1 virement"));
  assert.ok(hasLine(result.info, "2 transactions en attente de versement (37,10 $ net)", "rien n'est créé"));
  assert.ok(hasLine(result.info, "1 transaction ignorée (23,97 $ net)", "a échoué ou a été annulé"));
  assert.ok(hasLine(result.info, "1 ligne \"payout\" ignorée"));
  assert.ok(hasLine(result.info, "Virement du 17/11", "20,00 $ en réserve"));
});

test("transactions : ancien format sans Payout ID, virements dans une autre devise que la boutique", () => {
  const bytes = bytesOf("shopify_transactions_ancien.csv");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const parsed = parseCsv(decodeBytes(bytes));
  assert.equal(transactions.detect(parsed), 1);
  const result = transactions.parse(parsed, ctx());
  result.drafts.forEach(assertPayoutDraft);
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, d.currency, splitsOf(d), d.extId]), [
    ["2023-10-16", 249205, "CZK", { sales_shopify: 336769, refunds: -73851, fees_payment: -13713 }, "shopify_payout:2023-10-16:249205"],
    ["2023-10-13", 116069, "CZK", { sales_shopify: 121000, fees_payment: -4931 }, "shopify_payout:2023-10-13:116069"],
  ]);
  assert.equal(result.drafts[0].meta.payoutId, undefined);
  assert.equal(result.drafts[0].meta.txCount, 3);
  assert.equal(result.drafts[0].meta.orderCount, 2);
  // Les deux virements sont aux bords du fichier : ils peuvent être coupés par les dates de l'export.
  assert.deepEqual(result.drafts.map((d) => d.needsReview), [true, true]);
  assert.ok(hasLine(result.warnings, "Ces virements sont en CZK alors que le compte choisi est en USD"));
  assert.ok(hasLine(result.warnings, "(13/10 et 16/10) peuvent être incomplets"));
});

test("transactions : format court sans devise, litige au nom de l'API, net recalculé", () => {
  const parsed = csv([
    "Transaction Date,Type,Order,Card Brand,Card Source,Payout Status,Payout Date,Available On,Amount,Fee,Net",
    "2021-05-03 10:00:00 -0400,charge,#1001,visa,online,paid,2021-05-05,2021-05-05,40.00,1.46,",
    "2021-05-03 12:00:00 -0400,dispute,#0990,visa,online,paid,2021-05-05,2021-05-05,-25.00,15.00,-40.00",
  ]);
  assert.equal(transactions.detect(parsed), 1);
  const result = transactions.parse(parsed, ctx({ accountId: "perso" }));
  assert.equal(result.drafts.length, 1);
  const draft = result.drafts[0];
  assertPayoutDraft(draft);
  assert.equal(draft.amountCents, -146);
  assert.equal(draft.currency, "EUR");
  assert.equal(draft.label, "Prélèvement Shopify du 05/05");
  assert.equal(draft.extId, "shopify_payout:2021-05-05:-146");
  assert.deepEqual(splitsOf(draft), { sales_shopify: 4000, fees_payment: -146, chargebacks: -4000 });
  assert.ok(hasLine(result.info, "Le fichier n'indique pas la devise : montants lus en EUR."));
  assert.ok(hasLine(result.warnings, "Le virement du 05/05 peut être incomplet"));
});

test("transactions : report d'un virement échoué, net incohérent, identifiants abîmés, deux devises", () => {
  const head = "Transaction Date,Type,Order,Payout Status,Payout Date,Payout ID,Amount,Fee,Net,Currency";
  // Ligne "payout_failure" : elle fait partie du virement suivant, classée à part.
  let result = transactions.parse(csv([
    head,
    "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900001,100.00,3.20,96.80,USD",
    "2026-10-04 10:00:00 -0400,payout_failure,,paid,2026-10-07,900001,-30.00,0.00,-30.00,USD",
  ]), ctx());
  assert.equal(result.drafts[0].amountCents, 6680);
  assert.deepEqual(splitsOf(result.drafts[0]), { sales_shopify: 10000, fees_payment: -320, other_expense: -3000 });
  assert.equal(result.drafts[0].needsReview, true);
  assert.ok(hasLine(result.warnings, "Virement du 07/10", "-30,00 $", "virement échoué ou annulé", "\"Autres dépenses\""));

  // Net différent de montant moins frais : le net fait foi, l'écart est classé à part.
  result = transactions.parse(csv([head, "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900002,100.00,3.20,95.00,USD"]), ctx());
  assert.equal(result.drafts[0].amountCents, 9500);
  assert.deepEqual(splitsOf(result.drafts[0]), { sales_shopify: 10000, fees_payment: -320, other_expense: -180 });
  assert.ok(hasLine(result.warnings, "le net ne correspond pas au montant moins les frais", "1,80 $"));

  // Identifiants transformés par un tableur : regroupement par date de virement.
  result = transactions.parse(csv([
    head,
    "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,\"1,34773E+11\",100.00,3.20,96.80,USD",
    "2026-10-03 10:00:00 -0400,charge,#2,paid,2026-10-05,\"1,34773E+11\",50.00,1.75,48.25,USD",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, d.extId]), [
    ["2026-10-07", 9680, "shopify_payout:2026-10-07:9680"],
    ["2026-10-05", 4825, "shopify_payout:2026-10-05:4825"],
  ]);
  assert.ok(hasLine(result.warnings, "identifiants de virement sont illisibles"));

  // Même identifiant dans deux devises : deux opérations, deux clés.
  result = transactions.parse(csv([
    head,
    "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900003,100.00,3.20,96.80,USD",
    "2026-10-05 11:00:00 -0400,shop_cash_credit,#1,paid,2026-10-07,900003,5.00,0.00,5.00,CAD",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => [d.currency, d.amountCents, d.extId]), [
    ["USD", 9680, "shopify_payout:900003"],
    ["CAD", 500, "shopify_payout:900003-CAD"],
  ]);

  // Sans colonne Net ni Payout Status : net = montant moins frais, tout est considéré comme versé.
  result = transactions.parse(csv([
    "Transaction Date,Type,Payout Date,Amount,Fee,Currency",
    "2026-10-05 10:00:00 -0400,charge,2026-10-07,100.00,3.20,USD",
    "2026-10-05 11:00:00 -0400,refund,2026-10-07,-20.00,0.00,USD",
  ]), ctx());
  assert.equal(result.drafts[0].amountCents, 7680);
  assert.deepEqual(splitsOf(result.drafts[0]), { sales_shopify: 10000, refunds: -2000, fees_payment: -320 });
  assert.ok(hasLine(result.warnings, "Colonne \"Payout Status\" absente"));

  // Que des transactions en attente : aucun brouillon, une information, pas d'avertissement.
  result = transactions.parse(csv([head, "2026-10-05 10:00:00 -0400,charge,#1,pending,2026-10-07,,100.00,3.20,96.80,USD"]), ctx());
  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(hasLine(result.info, "1 transaction en attente de versement (96,80 $ net)"));
});

/* ------------------------------------------------------------------ les deux exports de virements ensemble */

// Enregistre des brouillons comme le ferait l'appli, puis reconstruit le livre.
function bookFrom(drafts) {
  const ops = drafts.map((draft, i) => normalizeOp({ ...draft, id: "op_" + String(i + 1).padStart(3, "0") }));
  assert.ok(ops.every(Boolean));
  return buildBook(config, ops);
}

test("virements puis transactions : le même virement n'est jamais compté deux fois", () => {
  const listDrafts = payouts.parse(load("shopify_payouts.csv"), ctx()).drafts;
  const book = bookFrom(listDrafts);
  const result = transactions.parse(load("shopify_transactions.csv"), ctx({ book }));
  // L'export des transactions reprend la clé déjà enregistrée (date + montant) au lieu de l'identifiant Shopify.
  assert.deepEqual(result.drafts.map((d) => d.extId), [
    "shopify_payout:2026-11-21:5699",
    "shopify_payout:2026-11-19:3334",
    "shopify_payout:2026-11-17:11727",
    "shopify_payout:2026-11-14:5028",
  ]);
  for (const draft of result.drafts) {
    const dup = findDuplicate(draft, book);
    assert.ok(dup && dup.exact, "doublon certain attendu pour le virement du " + draft.date);
    assert.equal(book.byId.get(dup.opId).date, draft.date);
    assert.equal(draft.meta.payoutId.length, 12);
  }
});

test("transactions puis virements : la liste des virements reprend la clé par identifiant", () => {
  const txDrafts = transactions.parse(load("shopify_transactions.csv"), ctx()).drafts;
  const book = bookFrom(txDrafts);
  const result = payouts.parse(load("shopify_payouts.csv"), ctx({ book }));
  const keys = Object.fromEntries(result.drafts.map((d) => [d.date, d.extId]));
  assert.equal(keys["2026-11-21"], "shopify_payout:134774400888");
  assert.equal(keys["2026-11-19"], "shopify_payout:134772916323");
  assert.equal(keys["2026-11-17"], "shopify_payout:134771100200");
  assert.equal(keys["2026-11-14"], "shopify_payout:134769955111");
  assert.equal(keys["2026-11-20"], "shopify_payout:2026-11-20:39765");
  const duplicates = result.drafts.filter((d) => { const dup = findDuplicate(d, book); return dup && dup.exact; });
  assert.deepEqual(duplicates.map((d) => d.date), ["2026-11-21", "2026-11-19", "2026-11-17", "2026-11-14"]);

  // Réimporter le même fichier : chaque virement retrouve sa clé, quel que soit le fichier d'origine.
  const again = transactions.parse(load("shopify_transactions.csv"), ctx({ book }));
  assert.deepEqual(again.drafts.map((d) => d.extId), txDrafts.map((d) => d.extId));
  const listBook = bookFrom(payouts.parse(load("shopify_payouts.csv"), ctx()).drafts);
  const listAgain = payouts.parse(load("shopify_payouts.csv"), ctx({ book: listBook }));
  assert.ok(listAgain.drafts.every((d) => findDuplicate(d, listBook).exact));
});

test("journal et fichier qui se contredisent : estimation devenue virement, montant qui a changé", () => {
  const book = bookFrom(payouts.parse(load("shopify_payouts.csv"), ctx()).drafts);
  // Quelques jours plus tard : le virement du 21/11 est versé tel quel, celui du 23/11 est parti avec un autre montant.
  const later = payouts.parse(csv([
    "Payout Date,Status,Charges,Refunds,Adjustments,Marketplace Sales Tax,Advances,Reserved Funds,Fees,Retried Amount,Total,Currency,Bank Reference",
    "2026-11-23,paid,259.00,0.00,0.00,0.00,0.00,0.00,8.90,0.00,250.10,USD,4T7N1P5LM3",
    "2026-11-21,paid,59.00,0.00,0.00,0.00,0.00,0.00,2.01,0.00,56.99,USD,4T7M8Q2KD6",
    "2026-11-20,paid,412.00,0.00,0.00,0.00,0.00,0.00,14.35,0.00,397.65,USD,4T7K2M9QX1",
  ]), ctx({ book }));
  assert.deepEqual(later.drafts.map((d) => [d.extId, !!(findDuplicate(d, book) || {}).exact]), [
    ["shopify_payout:2026-11-23:25010", false],
    ["shopify_payout:2026-11-21:5699", true],
    ["shopify_payout:2026-11-20:39765", true],
  ]);
  assert.deepEqual(texts(later.warnings), [
    "Un virement Shopify du 23/11 est déjà dans tes opérations avec un autre montant (181,65 $, à vérifier) : " +
      "si c'est le même virement, supprime l'ancien pour ne pas le compter deux fois.",
  ]);
  assert.ok(hasLine(later.info, "Le virement du 21/11 (56,99 $), importé comme estimation, est maintenant versé"));
  assert.ok(!hasLine(later.info, "Le virement du 20/11"));

  // Avec l'identifiant Shopify, le virement est reconnu même si son montant a changé : on le dit.
  const head = "Transaction Date,Type,Order,Payout Status,Payout Date,Payout ID,Amount,Fee,Net,Currency";
  const txBook = bookFrom(transactions.parse(csv([head, "2026-10-05 10:00:00 -0400,charge,#1,scheduled,2026-10-07,900020,100.00,3.20,96.80,USD"]), ctx()).drafts);
  const grown = transactions.parse(csv([
    head,
    "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900020,100.00,3.20,96.80,USD",
    "2026-10-05 18:00:00 -0400,charge,#2,paid,2026-10-07,900020,50.00,1.75,48.25,USD",
  ]), ctx({ book: txBook }));
  assert.equal(grown.drafts[0].extId, "shopify_payout:900020");
  assert.equal(grown.drafts[0].amountCents, 14505);
  assert.ok(hasLine(grown.warnings, "Le virement du 07/10 est déjà dans tes opérations pour 96,80 $", "le fichier indique 145,05 $"));
  // Réimporter un fichier inchangé ne dit rien de plus.
  const same = payouts.parse(load("shopify_payouts.csv"), ctx({ book }));
  assert.deepEqual(same.warnings, payouts.parse(load("shopify_payouts.csv"), ctx()).warnings);
  assert.deepEqual(same.info, payouts.parse(load("shopify_payouts.csv"), ctx()).info);
});

test("clés des virements : un autre virement de même date et même montant n'est pas confondu", () => {
  const head = "Transaction Date,Type,Order,Payout Status,Payout Date,Payout ID,Amount,Fee,Net,Currency";
  const first = transactions.parse(csv([head, "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900010,100.00,3.20,96.80,USD"]), ctx()).drafts;
  const book = bookFrom(first);
  // Un deuxième virement Shopify (autre identifiant), même jour, même montant : il garde sa propre clé.
  const second = transactions.parse(csv([head, "2026-10-05 12:00:00 -0400,charge,#2,paid,2026-10-07,900011,100.00,3.20,96.80,USD"]), ctx({ book })).drafts;
  assert.equal(second[0].extId, "shopify_payout:900011");
  // Un livre sans opérations, ou mal formé, ne casse rien.
  for (const odd of [{}, { ops: null }, { ops: [null, 3, { extId: 12 }, { extId: "shopify_payout:" }] }]) {
    assert.equal(transactions.parse(csv([head, "2026-10-05 10:00:00 -0400,charge,#1,paid,2026-10-07,900010,100.00,3.20,96.80,USD"]), ctx({ book: odd })).drafts[0].extId,
      "shopify_payout:900010");
  }
});

/* ------------------------------------------------------------------ 3. commandes */

test("commandes : statistiques par jour, sans compter deux fois les commandes de plusieurs lignes", () => {
  const parsed = load("shopify_orders.csv");
  assert.equal(parsed.headers.length, 79);
  assert.equal(orders.detect(parsed), 1);
  const result = orders.parse(parsed, ctx());
  assertResultShape(result);
  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.stats, {
    "2026-11": { shopify: { days: {
      "18": { orders: 1, grossCents: 5900, discountsCents: 0, refundsCents: 0, shippingCents: 0, taxCents: 0, netCents: 5900, totalCents: 5900, currency: "USD" },
      // #2315 (deux articles, remise, livraison), #2314 (quantité 2), #2313 (PayPal, pourboire hors ventes).
      "17": { orders: 3, grossCents: 22500, discountsCents: 680, refundsCents: 0, shippingCents: 490, taxCents: 0, netCents: 21820, totalCents: 22810, currency: "USD" },
      // #2311 (gratuite) et #2309 (taxe) ; #2312 (voided) et #2310 (en attente puis annulée) ne comptent pas.
      "16": { orders: 2, grossCents: 10800, discountsCents: 4900, refundsCents: 0, shippingCents: 0, taxCents: 487, netCents: 5900, totalCents: 6387, currency: "USD" },
      "12": { orders: 1, grossCents: 4900, discountsCents: 0, refundsCents: 4900, shippingCents: 0, taxCents: 0, netCents: 0, totalCents: 0, currency: "USD" },
      "11": { orders: 1, grossCents: 5900, discountsCents: 0, refundsCents: 1000, shippingCents: 0, taxCents: 0, netCents: 4900, totalCents: 4900, currency: "USD" },
    } } },
  });
  for (const day of Object.values(result.stats["2026-11"].shopify.days)) {
    assert.equal(day.netCents, day.grossCents - day.discountsCents - day.refundsCents);
    for (const value of Object.values(day)) assert.ok(typeof value === "string" || Number.isInteger(value));
  }
});

test("commandes : avertissements avec la bonne ligne du fichier, totaux et part hors Shopify Payments", () => {
  const raw = decodeBytes(bytesOf("shopify_orders.csv")).split("\n");
  const lineOf = (needle) => raw.findIndex((line) => line.includes(needle)) + 1;
  // Une cellule sur plusieurs lignes décale les numéros : la ligne citée doit rester celle du fichier.
  assert.equal(lineOf("sans-numero@example.com"), 16);
  assert.equal(lineOf("cut.order@example.com"), 17);

  const result = orders.parse(load("shopify_orders.csv"), ctx());
  assert.deepEqual(texts(result.warnings), [
    "Ligne 16 : pas de numéro de commande, ligne ignorée.",
    "Commande #2296 (ligne 17) : la ligne principale de la commande manque (fichier coupé ?), commande ignorée.",
  ]);
  const info = texts(result.info);
  assert.ok(info[0].startsWith("8 commandes lues (14 lignes) du 11/11/2026 au 18/11/2026, sur 5 jours."));
  assert.ok(info[0].includes("Aucune opération n'est créée"));
  assert.equal(info[1], "Ventes brutes 500,00 $, remises 55,80 $, remboursements 59,00 $ : ventes nettes 385,20 $. " +
    "Total encaissé, livraison et taxes comprises, remboursements déduits : 399,97 $.");
  assert.equal(info[2], "Ventes payées sans passer par Shopify Payments : 127,87 $ sur 458,97 $ (27,9 %). " +
    "Elles n'arrivent pas par les virements Shopify. Détail : PayPal Express Checkout 64,00 $, manual 63,87 $.");
  assert.ok(hasLine(result.info, "1 commande gratuite comptée"));
  assert.ok(hasLine(result.info, "2 commandes annulées avant paiement ignorées"));
  assert.ok(hasLine(result.info, "Pourboires : 5,00 $"));
  assert.ok(hasLine(result.info, "remboursements sont comptés le jour de la commande"));
  assert.ok(hasLine(result.info, "le premier (11/11)", "le dernier (18/11)"));
});

test("commandes : option pour écarter les commandes gratuites", () => {
  const result = orders.parse(load("shopify_orders.csv"), ctx({ options: { excludeFreeOrders: true } }));
  assert.deepEqual(result.stats["2026-11"].shopify.days["16"],
    { orders: 1, grossCents: 5900, discountsCents: 0, refundsCents: 0, shippingCents: 0, taxCents: 487, netCents: 5900, totalCents: 6387, currency: "USD" });
  assert.ok(hasLine(result.info, "1 commande gratuite ignorée"));
});

test("commandes : fichier réduit repassé par un tableur français, deux devises, ligne de total", () => {
  const parsed = load("shopify_orders_reduit_fr.csv");
  assert.equal(parsed.delimiter, ";");
  assert.equal(orders.detect(parsed), 1);
  const result = orders.parse(parsed, ctx());
  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.stats, {
    "2026-11": { shopify: { days: {
      "18": { orders: 1, grossCents: 4500, discountsCents: 0, refundsCents: 0, shippingCents: 299, taxCents: 0, netCents: 4500, totalCents: 4799, currency: "EUR" },
      // Livraison offerte par un code : la remise est dans "Discount Amount", le total encaissé reste exact.
      "17": { orders: 1, grossCents: 9000, discountsCents: 299, refundsCents: 0, shippingCents: 299, taxCents: 0, netCents: 8701, totalCents: 9000, currency: "EUR" },
    } } },
  });
  assert.deepEqual(texts(result.warnings), ["1 commande en USD ignorée : les statistiques d'un jour n'ont qu'une devise (ici EUR)."]);
  assert.ok(hasLine(result.info, "2 commandes lues (4 lignes) du 17/11/2026 au 18/11/2026, sur 2 jours."));
  assert.ok(hasLine(result.info, "Toutes les ventes payées (137,99 €) sont passées par Shopify Payments"));
});

test("commandes : 50 commandes, mois différents, colonnes manquantes, moyens de paiement mélangés", () => {
  const head = "Name,Financial Status,Currency,Total,Discount Amount,Created at,Lineitem quantity,Lineitem name,Lineitem price,Refunded Amount,Payment Method";
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const day = i < 20 ? "2026-10-31" : "2026-11-01";
    rows.push(`#${3000 + i},paid,USD,49.00,0.00,${day} 10:00:00 -0400,1,Personalized Movie,49.00,0.00,${i === 0 ? "Shopify Payments + Gift Card" : "Shopify Payments"}`);
  }
  let result = orders.parse(csv([head, ...rows]), ctx());
  assert.equal(result.stats["2026-10"].shopify.days["31"].orders, 20);
  assert.equal(result.stats["2026-10"].shopify.days["31"].grossCents, 98000);
  assert.equal(result.stats["2026-11"].shopify.days["01"].orders, 30);
  assert.equal(result.stats["2026-11"].shopify.days["01"].totalCents, 147000);
  assert.ok(hasLine(result.warnings, "exactement 50 commandes"));
  // Un paiement mélangé n'est ni "tout Shopify Payments" ni "sans Shopify Payments" : il a sa propre ligne.
  assert.ok(!hasLine(result.info, "sans passer par Shopify Payments"));
  assert.ok(!hasLine(result.info, "Toutes les ventes payées"));
  assert.ok(hasLine(result.info, "en partie par Shopify Payments et en partie par un autre moyen : 49,00 $ (Shopify Payments + Gift Card 49,00 $)"));

  // Sans colonne de prix par article : ventes brutes = sous-total + remises.
  result = orders.parse(csv([
    "Name,Financial Status,Currency,Subtotal,Total,Discount Amount,Created at",
    "#1,paid,USD,44.10,44.10,4.90,2026-11-18 11:05:02 -0500",
  ]), ctx());
  assert.deepEqual(result.stats["2026-11"].shopify.days["18"],
    { orders: 1, grossCents: 4900, discountsCents: 490, refundsCents: 0, shippingCents: 0, taxCents: 0, netCents: 4410, totalCents: 4410, currency: "USD" });

  // Prix illisible sur un article, total illisible sur une commande : avertissements avec la ligne.
  result = orders.parse(csv([
    head,
    "#1,paid,USD,49.00,0.00,2026-11-18 11:05:02 -0500,1,Personalized Movie,gratuit,0.00,Shopify Payments",
    "#2,paid,USD,???,0.00,2026-11-18 12:00:00 -0500,1,Personalized Movie,49.00,0.00,Shopify Payments",
    "#3,paid,USD,49.00,0.00,pas de date,1,Personalized Movie,49.00,0.00,Shopify Payments",
  ]), ctx());
  assert.deepEqual(texts(result.warnings), [
    "Ligne 2 : prix ou quantité illisible pour la commande #1, article ignoré.",
    "Commande #2 (ligne 3) : total illisible, commande ignorée.",
    "Commande #3 (ligne 4) : date de commande absente ou illisible, commande ignorée.",
  ]);
  assert.equal(result.stats["2026-11"].shopify.days["18"].orders, 1);

  result = orders.parse({ headers: ["Name", "Created at", "Lineitem quantity", "Lineitem price"], rows: [] }, ctx());
  assert.equal(result.stats, null);
  assert.deepEqual(result.warnings, ["Le fichier ne contient aucune commande."]);
});

/* ------------------------------------------------------------------ 4. factures Shopify */

const BILL_ROWS = [
  // clé, date, montant, catégorie, à vérifier, libellé
  ["shopify_bill:612345678:1", "2026-11-20", -3900, "shopify_sub", false, "Abonnement Shopify (facture 612345678)"],
  ["shopify_bill:612345678:2", "2026-11-20", -1500, "shopify_apps", false, "App Shopify : Reviews App Pro (facture 612345678)"],
  ["shopify_bill:612345678:3", "2026-11-20", -999, "shopify_apps", false, "App Shopify : Upsell Booster (facture 612345678)"],
  ["shopify_bill:612345678:4", "2026-11-20", -128, "fees_payment", false, "Frais de transaction Shopify (facture 612345678)"],
  ["shopify_bill:598765432:1", "2026-10-20", -3900, "shopify_sub", false, "Abonnement Shopify (facture 598765432)"],
  ["shopify_bill:598765432:2", "2026-10-20", -1500, "shopify_apps", false, "App Shopify : Reviews App Pro (facture 598765432)"],
  ["shopify_bill:598765432:3", "2026-10-20", -2000, "shopify_apps", false, "App Shopify : Klaviyo: Email Marketing, SMS (facture 598765432)"],
  ["shopify_bill:598765432:4", "2026-10-20", 450, "shopify_apps", false, "App Shopify : Upsell Booster (facture 598765432, avoir)"],
  ["shopify_bill:591112223:1", "2026-10-12", -1200, "shopify_apps", true, "Shopify : Something new (facture 591112223)"],
];

test("factures : une dépense par ligne de facture, classée par type de frais", () => {
  const parsed = load("shopify_billing.csv");
  assert.equal(billing.detect(parsed), 1);
  const result = billing.parse(parsed, ctx());
  assertResultShape(result);
  assert.equal(result.stats, null);
  assert.deepEqual(result.drafts.map((d) => [d.extId, d.date, d.amountCents, d.categoryId, d.needsReview, d.label]), BILL_ROWS);
  for (const draft of result.drafts) {
    assert.equal(draft.kind, "pl");
    assert.equal(draft.currency, "USD");
    assert.equal(draft.accountId, "slash");
    assert.equal(draft.party, "Shopify");
    assert.equal(draft.source, "shopify");
    assert.equal(draft.splits, undefined);
    assert.equal(draft.ref, draft.meta.billNumber);
    assert.equal(draft.extId, `shopify_bill:${draft.meta.billNumber}:${draft.meta.line}`);
  }
  assert.deepEqual(result.drafts[1], {
    kind: "pl",
    date: "2026-11-20",
    label: "App Shopify : Reviews App Pro (facture 612345678)",
    accountId: "slash",
    amountCents: -1500,
    currency: "USD",
    categoryId: "shopify_apps",
    party: "Shopify",
    ref: "612345678",
    source: "shopify",
    extId: "shopify_bill:612345678:2",
    needsReview: false,
    meta: {
      billNumber: "612345678", line: 2, chargeCategory: "application_fee", app: "Reviews App Pro", store: "Example Kids Films",
      periodStart: "2026-10-28", periodEnd: "2026-11-27", chargeDate: "2026-10-28", export: "billing", billTotalCents: -6527, billLines: 4,
    },
  });
  // Le total de la facture (un seul débit sur le relevé) est rappelé sur chaque ligne.
  assert.deepEqual(result.drafts.map((d) => d.meta.billTotalCents), [-6527, -6527, -6527, -6527, -6950, -6950, -6950, -6950, -1200]);
  assert.equal(result.drafts[3].meta.order, "#2309");
  assert.equal(result.drafts[8]._note, "Type de frais non reconnu.");

  assert.deepEqual(texts(result.warnings), [
    "Ligne 10 : type de frais \"mystery_charge\" non reconnu sur la facture 591112223, ligne classée en \"Apps Shopify\" et marquée \"À vérifier\".",
    "Ligne 12 : numéro de facture absent, ligne ignorée.",
    "Ligne 13 : montant illisible (\"n/a\") sur la facture 577700011, ligne ignorée.",
  ]);
  const info = texts(result.info);
  assert.equal(info[0], "3 factures Shopify (9 lignes) du 12/10/2026 au 20/11/2026.");
  assert.equal(info[1], "Total facturé : 146,77 $ (abonnement 78,00 $, apps 67,49 $, frais de transaction 1,28 $).");
  assert.ok(hasLine(result.info, "ne dit pas si une facture a été payée"));
  assert.ok(hasLine(result.info, "1 ligne à 0 ignorée"));
});

test("factures : une règle de l'utilisateur passe avant le type de frais", () => {
  const withRule = normalizeConfig({ ...config, rules: { r1: { id: "r1", contains: "klaviyo", categoryId: "email_sms", enabled: true } } });
  const result = billing.parse(load("shopify_billing.csv"), ctx({ config: withRule }));
  assert.deepEqual(result.drafts.map((d) => d.categoryId),
    ["shopify_sub", "shopify_apps", "shopify_apps", "fees_payment", "shopify_sub", "shopify_apps", "email_sms", "shopify_apps", "shopify_apps"]);
  // Une règle qui reconnaît la ligne au type inconnu lui retire son "À vérifier".
  const second = normalizeConfig({ ...config, rules: { r2: { id: "r2", contains: "something new", categoryId: "software", enabled: true } } });
  const other = billing.parse(load("shopify_billing.csv"), ctx({ config: second }));
  assert.equal(other.drafts[8].categoryId, "software");
  assert.equal(other.drafts[8].needsReview, false);
  assert.equal(other.warnings.length, 2);
});

test("factures : autres types de frais, devises, décimales non complétées, fichier français", () => {
  const head = "Bill #,Charge category,Description,Amount,Currency,Date,App,Original amount,Original currency,Charge date";
  let result = billing.parse(csv([
    head,
    "600000001,shipping_label,USPS label,4.5,USD,2026-11-02,,4.5,USD,2026-11-01",
    "600000001,sales_tax,Tax,3.21,USD,2026-11-02,,3.21,USD,2026-11-02",
    "600000001,domain,example-kids-films.com,15.0,USD,2026-11-02,,15.0,USD,2026-11-02",
    "600000001,theme_purchase,Dawn Pro,180.0,USD,2026-11-02,,180.0,USD,2026-11-02",
    "600000001,usage_fee,Shopify Email,0.125,USD,2026-11-02,,0.125,USD,2026-11-02",
    "600000001,application_fee,Euro App,10.9,USD,2026-11-02,Euro App,10.0,EUR,2026-11-02",
    "#600000002,,Loox Reviews,9.99,USD,,Loox Reviews,9.99,USD,2026-11-05",
  ]), ctx());
  assert.deepEqual(result.drafts.map((d) => [d.extId, d.amountCents, d.categoryId, d.needsReview]), [
    ["shopify_bill:600000001:1", -450, "shipping", false],
    ["shopify_bill:600000001:2", -321, "taxes", false],
    ["shopify_bill:600000001:3", -1500, "domain_hosting", false],
    ["shopify_bill:600000001:4", -18000, "shopify_apps", false],
    // "0.125" est une décimale, pas un millier : 13 centimes.
    ["shopify_bill:600000001:5", -13, "shopify_apps", true],
    ["shopify_bill:600000001:6", -1090, "shopify_apps", false],
    // Sans type de frais ni date de facture : le nom de l'app et la date du frais suffisent.
    ["shopify_bill:600000002:1", -999, "shopify_apps", false],
  ]);
  assert.equal(result.drafts[5].meta.originalCurrency, "EUR");
  assert.equal(result.drafts[5].meta.originalAmountCents, -1000);
  assert.equal(result.drafts[6].date, "2026-11-05");
  assert.equal(result.drafts[6].ref, "600000002");

  // Fichier repassé par un tableur français, facturé en euros, avec une ligne de total.
  const parsed = parseCsv([
    "Bill #;Charge category;Description;Amount;Currency;Date",
    "612345678;subscription_fee;Subscription Fee;36,00;EUR;20/11/2026",
    "612345678;application_fee;Reviews App Pro;13,90;EUR;20/11/2026",
    "Total;;;49,90;;",
  ].join("\r\n"));
  assert.equal(parsed.delimiter, ";");
  assert.equal(billing.detect(parsed), 1);
  result = billing.parse(parsed, ctx({ accountId: "perso" }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.drafts.map((d) => [d.date, d.amountCents, d.currency, d.categoryId, d.accountId]), [
    ["2026-11-20", -3600, "EUR", "shopify_sub", "perso"],
    ["2026-11-20", -1390, "EUR", "shopify_apps", "perso"],
  ]);
});

/* ------------------------------------------------------------------ garanties communes */

test("tous les brouillons sont des opérations valides pour le modèle", () => {
  const cases = [
    [payouts, "shopify_payouts.csv", "slash"],
    [payouts, "shopify_payouts_ancien_fr.csv", "perso"],
    [transactions, "shopify_transactions.csv", "slash"],
    [transactions, "shopify_transactions_ancien.csv", "slash"],
    [billing, "shopify_billing.csv", "slash"],
  ];
  let count = 0;
  for (const [imp, name, accountId] of cases) {
    const { drafts } = imp.parse(load(name), ctx({ accountId }));
    assert.ok(drafts.length > 0);
    for (const draft of drafts) {
      count++;
      assert.deepEqual(validateOp(draft, config), [], `${name} ${draft.extId}`);
      const op = normalizeOp({ ...draft, id: "op_test" });
      assert.ok(op, `${name} ${draft.extId}`);
      assert.equal(op.amountCents, draft.amountCents);
      assert.equal(op.extId, draft.extId);
      assert.equal(op._note, undefined);
      if (draft.splits) assert.deepEqual(op.splits, draft.splits);
      else assert.equal(op.categoryId, draft.categoryId);
    }
  }
  assert.equal(count, 11 + 3 + 4 + 2 + 9);
  // Les clés externes sont uniques dans chaque fichier.
  for (const [imp, name] of cases) {
    const ids = imp.parse(load(name), ctx()).drafts.map((d) => d.extId);
    assert.equal(new Set(ids).size, ids.length, name);
  }
});

test("une fois enregistrés, les virements donnent le bon solde et le bon détail par catégorie", () => {
  const book = bookFrom(payouts.parse(load("shopify_payouts.csv"), ctx()).drafts);
  // 1 518,32 déjà versés + 238,64 à venir.
  assert.equal(book.accounts.slash.balanceCents, 175696);
  assert.equal(book.profitCents, 175696);
  assert.equal(book.checks.identityDiffCents, 0);
  const summary = summarize(book, {});
  assert.deepEqual(summary.byCategory, { sales_shopify: 230780, refunds: -25810, fees_payment: -11081, chargebacks: -16693, other_expense: -1500 });
  assert.equal(summary.refundsCents, 25810);
  assert.equal(summary.feesCents, 11081);
  assert.equal(summary.salesCents, 230780 - 25810);
  assert.equal(book.todo.uncategorized, 0);
  assert.equal(book.todo.needsReview, 3);

  // Les factures : des dépenses classées, une seule ligne en avoir.
  const bills = bookFrom(billing.parse(load("shopify_billing.csv"), ctx()).drafts);
  assert.equal(bills.profitCents, -14677);
  assert.deepEqual(summarize(bills, {}).byCategory, { shopify_sub: -7800, shopify_apps: -6749, fees_payment: -128 });
});

test("parse ne lève jamais d'exception, quel que soit le fichier ou le contexte", () => {
  const files = readdirSync(FIXTURES).filter((name) => /\.(csv|tsv|txt)$/i.test(name)).map(load);
  const inputs = [
    null, undefined, 0, "texte", [], {}, { headers: null, rows: null }, { headers: [null, 3, {}], rows: [null, 5, "x", [null, {}, 7]] },
    { headers: ["Payout Date", "Total"], rows: [[]] },
    parseCsv(""), parseCsv("\ufeff"), parseCsv("a,b,c\n1,2,3\n"),
    ...files,
  ];
  const contexts = [undefined, null, {}, { config: null, book: null }, { config: 3, book: "x", accountId: 12, options: "y" }, ctx()];
  for (const imp of IMPORTERS) {
    for (const input of inputs) {
      for (const context of contexts) {
        const result = imp.parse(input, context);
        assertResultShape(result);
      }
    }
  }
  // Un fichier d'un autre type donne un message clair, pas un résultat silencieux.
  const wrong = payouts.parse(load("shopify_orders.csv"), ctx());
  assert.deepEqual(wrong.drafts, []);
  assert.ok(hasLine(wrong.warnings, "Colonne \"Payout Date\" introuvable"));
  assert.ok(hasLine(transactions.parse(load("shopify_billing.csv"), ctx()).warnings, "ne ressemble pas à l'export des transactions Shopify"));
  assert.ok(hasLine(orders.parse(load("shopify_payouts.csv"), ctx()).warnings, "ne ressemble pas à l'export des commandes Shopify"));
  assert.ok(hasLine(billing.parse(load("shopify_orders.csv"), ctx()).warnings, "ne ressemble pas à l'export des factures Shopify"));
  // Type choisi à la main sur le mauvais export de virements : surtout pas un virement par transaction.
  const mixedUp = payouts.parse(load("shopify_transactions.csv"), ctx());
  assert.deepEqual(mixedUp.drafts, []);
  assert.ok(hasLine(mixedUp.warnings, "export des transactions", "\"Transactions des virements Shopify\""));
  const reversed = transactions.parse(load("shopify_payouts.csv"), ctx());
  assert.deepEqual(reversed.drafts, []);
  assert.ok(hasLine(reversed.warnings, "ne ressemble pas à l'export des transactions Shopify"));
  // "Exporter les historiques de transactions" au lieu de "Exporter les commandes" : aucune statistique à zéro.
  const histories = orders.parse(csv([
    "Order,Name,Payment Method,Kind,Gateway,Created At,Status,Amount,Currency,Card Type",
    "6312455500131,#2316,Shopify Payments,sale,shopify_payments,2026-11-18 11:05:19 -0500,success,59.00,USD,visa",
  ]), ctx());
  assert.equal(histories.stats, null);
  assert.ok(hasLine(histories.warnings, "historique des transactions des commandes", "\"Exporter les commandes\""));
});

test("parse ne modifie ni le fichier lu ni le contexte", () => {
  for (const [imp, name] of [[payouts, "shopify_payouts.csv"], [transactions, "shopify_transactions.csv"], [orders, "shopify_orders.csv"], [billing, "shopify_billing.csv"]]) {
    const parsed = load(name);
    const before = JSON.stringify(parsed);
    const context = ctx();
    const first = imp.parse(parsed, context);
    const second = imp.parse(parsed, context);
    assert.equal(JSON.stringify(parsed), before);
    assert.deepEqual(first, second);
    assert.deepEqual(context, ctx());
  }
});

test("registre des importeurs : les fichiers Shopify sont reconnus et les doublons décochés", async (t) => {
  let registry;
  try {
    registry = await import("../../src/core/importers/index.js");
  } catch {
    t.skip("registre des importeurs pas encore disponible");
    return;
  }
  for (const name of readdirSync(FIXTURES).filter((file) => /^shopify_.*\.csv$/.test(file))) {
    const expected = Object.keys(OWN_FIXTURES).find((type) => OWN_FIXTURES[type].test(name));
    const candidates = registry.detectImport(load(name));
    assert.equal(candidates[0].type, expected, name);
  }
  const first = registry.runImport("shopify_payouts", load("shopify_payouts.csv"), ctx());
  assert.equal(first.type, "shopify_payouts");
  assert.ok(first.drafts.every((d) => d._selected === true && d._dupOf === null));
  const book = bookFrom(first.drafts);
  const second = registry.runImport("shopify_transactions", load("shopify_transactions.csv"), ctx({ book }));
  assert.deepEqual(second.drafts.map((d) => [d._dupExact, d._selected]), [[true, false], [true, false], [true, false], [true, false]]);
  const stats = registry.runImport("shopify_orders", load("shopify_orders.csv"), ctx({ book }));
  assert.deepEqual(stats.drafts, []);
  assert.equal(stats.stats["2026-11"].shopify.days["17"].orders, 3);
});

test("aucun tiret long dans les fichiers de l'importeur Shopify", () => {
  const dash = /[\u2013\u2014]/;
  const files = [SOURCE_FILE, fileURLToPath(import.meta.url), ...readdirSync(FIXTURES).filter((name) => name.startsWith("shopify_")).map((name) => path.join(FIXTURES, name))];
  for (const file of files) assert.ok(!dash.test(readFileSync(file, "utf8")), file);
});
