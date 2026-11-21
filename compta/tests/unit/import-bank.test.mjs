import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decodeBytes, parseCsv } from "../../src/core/importers/csv.js";
import { IMPORTERS, guessMapping, parseBankRows, ignoreKey } from "../../src/core/importers/bank.js";
import { normalizeConfig, defaultConfig, validateOp, normalizeOp } from "../../src/core/model.js";
import { buildBook } from "../../src/core/ledger.js";
import { findDuplicate } from "../../src/core/recon.js";

// ---------------------------------------------------------------------------------------------
// Outils de test

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const bytes = (name) => readFileSync(path.join(FIXTURES, name));
const load = (name) => parseCsv(decodeBytes(bytes(name)));
const importer = (type) => IMPORTERS.find((imp) => imp.type === type);

// Trois associés ; comptes personnels de Camille et de Noa, comptes de l'entreprise en dollars et en euros.
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
    noa_eur: { id: "noa_eur", name: "Compte de Noa", kind: "bank", owner: "noa", currency: "EUR" },
    pro_usd: { id: "pro_usd", name: "Compte pro USD", kind: "bank", owner: "business", currency: "USD", cards: ["0562", "2487"] },
    pro_eur: { id: "pro_eur", name: "Compte pro EUR", kind: "bank", owner: "business", currency: "EUR" },
  },
});

// Fichier d'exemple -> type d'importeur attendu.
const EXPECTED_TYPE = {
  "bank_revolut_en.csv": "bank_revolut",
  "bank_revolut_en_suite.csv": "bank_revolut",
  "bank_revolut_fr.csv": "bank_revolut",
  "bank_revolut_business.csv": "bank_revolut_business",
  "bank_slash.csv": "bank_slash",
  "bank_slash_variante.csv": "bank_slash",
  "bank_wise.csv": "bank_wise",
  "bank_wise_transferts.csv": "bank_wise_history",
  "bank_mercury.csv": "bank_mercury",
  "bank_paypal_en.csv": "bank_paypal",
  "bank_paypal_fr.csv": "bank_paypal",
  "bank_qonto.csv": "bank_qonto",
  "bank_n26.csv": "bank_n26",
  "bank_payoneer.csv": "bank_payoneer",
  "bank_generic_fortuneo.csv": "bank_generic",
  "bank_generic_banque_postale.csv": "bank_generic",
  "bank_generic_caisse_epargne.csv": "bank_generic",
  "bank_generic_boursobank.csv": "bank_generic",
  "bank_generic_banque_us.csv": "bank_generic",
};

// Compte dans lequel chaque fichier d'exemple est importé.
const ACCOUNT_OF = {
  "bank_revolut_en.csv": "perso_usd", "bank_revolut_en_suite.csv": "perso_usd", "bank_revolut_fr.csv": "perso_eur",
  "bank_revolut_business.csv": "pro_usd", "bank_slash.csv": "pro_usd", "bank_slash_variante.csv": "pro_usd", "bank_wise.csv": "pro_usd",
  "bank_wise_transferts.csv": "pro_usd", "bank_mercury.csv": "pro_usd", "bank_paypal_en.csv": "pro_usd", "bank_paypal_fr.csv": "perso_eur",
  "bank_qonto.csv": "pro_eur", "bank_n26.csv": "perso_eur", "bank_payoneer.csv": "pro_usd", "bank_generic_fortuneo.csv": "noa_eur",
  "bank_generic_banque_postale.csv": "pro_eur", "bank_generic_caisse_epargne.csv": "pro_eur", "bank_generic_boursobank.csv": "noa_eur",
  "bank_generic_banque_us.csv": "pro_usd",
};

/** De bout en bout : octets -> texte -> CSV -> meilleur importeur -> brouillons. */
function importFile(name, accountId = ACCOUNT_OF[name], extra = {}) {
  const parsed = load(name);
  const ranked = IMPORTERS.map((imp) => ({ imp, score: imp.detect(parsed) })).sort((a, b) => b.score - a.score);
  const result = ranked[0].imp.parse(parsed, { config: CONFIG, book: null, accountId, ...extra });
  return { type: ranked[0].imp.type, parsed, ...result };
}

/** L'essentiel d'un brouillon : date, centimes, devise, catégorie, coché ou non. */
const brief = (d) => [d.date, d.amountCents, d.currency, d.categoryId, d._selected];
const byLabel = (drafts, label) => drafts.find((d) => d.label === label);
const hasLine = (lines, re) => lines.some((s) => re.test(s));

function toOps(drafts, prefix = "op") {
  return drafts.map((d, i) => {
    const op = { id: prefix + "_" + i };
    for (const key of Object.keys(d)) if (key[0] !== "_") op[key] = d[key];
    return op;
  });
}

// ---------------------------------------------------------------------------------------------
// Contrat des importeurs

test("IMPORTERS : un importeur par banque, plus l'importeur générique", () => {
  const types = IMPORTERS.map((imp) => imp.type);
  assert.equal(new Set(types).size, types.length);
  for (const wanted of ["bank_revolut", "bank_revolut_business", "bank_slash", "bank_wise", "bank_mercury", "bank_paypal", "bank_qonto", "bank_generic"]) {
    assert.ok(types.includes(wanted), wanted);
  }
  assert.equal(types[types.length - 1], "bank_generic", "l'importeur générique passe en dernier");
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const imp of IMPORTERS) {
    assert.match(imp.type, /^bank_[a-z0-9_]+$/);
    assert.ok(imp.label.length > 2 && imp.help.length > 20, imp.type);
    assert.ok(!dash.test(imp.label + imp.help), imp.type);
    assert.deepEqual(imp.needs, { account: true, platform: false });
    assert.equal(typeof imp.detect, "function");
    assert.equal(typeof imp.parse, "function");
  }
});

test("detect : forte sur son fichier, sous 0,3 sur tous les autres fichiers d'exemple", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".csv")).sort();
  for (const name of Object.keys(EXPECTED_TYPE)) assert.ok(files.includes(name), "fichier manquant : " + name);
  for (const name of files) {
    const parsed = load(name);
    const expected = EXPECTED_TYPE[name] || null;
    let best = null;
    for (const imp of IMPORTERS) {
      const score = imp.detect(parsed);
      assert.ok(score >= 0 && score <= 1, imp.type + " sur " + name);
      if (imp.type === expected) {
        // L'importeur générique reste volontairement bas : il ne doit jamais passer devant un préréglage.
        if (expected === "bank_generic") assert.ok(score >= 0.15 && score < 0.3, `${imp.type} sur ${name} : ${score}`);
        else assert.ok(score >= 0.6, `${imp.type} sur ${name} : ${score}`);
      } else {
        assert.ok(score < 0.3, `${imp.type} ne devrait pas reconnaître ${name} : ${score}`);
      }
      if (!best || score > best.score) best = { type: imp.type, score };
    }
    if (expected) assert.equal(best.type, expected, name);
  }
});

test("detect : ne lève jamais d'exception", () => {
  const odd = [null, undefined, 12, "texte", {}, { headers: null, rows: null }, { headers: [null, 5, "Date"], rows: [null, [1], "x"] }, { headers: [], rows: [] }, parseCsv("")];
  for (const imp of IMPORTERS) for (const input of odd) assert.equal(imp.detect(input), 0, imp.type);
});

// ---------------------------------------------------------------------------------------------
// Revolut (compte personnel)

test("Revolut personnel, anglais : centimes, dates, catégories, lignes ignorées", () => {
  const r = importFile("bank_revolut_en.csv");
  assert.equal(r.type, "bank_revolut");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-09-28", 50000, "USD", null, false],
    ["2026-09-29", -3900, "USD", "shopify_sub", true],
    ["2026-09-30", -100, "USD", "email_sms", true],
    ["2026-10-01", -2000, "USD", "ads_meta", true],
    ["2026-10-01", -2000, "USD", "ads_meta", true],
    ["2026-10-02", -2387, "USD", null, false],
    ["2026-10-03", -5000, "USD", "ads_tiktok", true],
    ["2026-10-03", -50, "USD", "bank_fees", true],
    ["2026-10-06", 123456, "USD", "sales_shopify", true],
    ["2026-10-07", -1420, "USD", null, false],
    ["2026-10-08", -9477, "USD", "ads_applovin", true],
    ["2026-10-09", 500, "USD", "ads_meta", true],
    ["2026-10-10", -20000, "USD", null, false],
    ["2026-10-12", -999, "USD", "bank_fees", true],
  ]);
  assert.equal(r.stats, null);
  assert.deepEqual(r.warnings, []);
  for (const d of r.drafts) {
    assert.equal(d.kind, "pl");
    assert.equal(d.accountId, "perso_usd");
    assert.equal(d.source, "revolut");
    assert.match(d.extId, /^bank:perso_usd:[0-9a-f]{16}(:fee)?$/);
    assert.equal(d.needsReview === true, d.categoryId === null, d.label);
    assert.equal(d.reconciled, true, "une ligne venue du relevé est déjà pointée");
    assert.equal(d.card, undefined, "le relevé Revolut personnel ne donne pas la carte");
  }
  assert.equal(new Set(r.drafts.map((d) => d.extId)).size, r.drafts.length, "identifiants tous différents");

  // libellé nettoyé, tiers reconnu
  const shopify = r.drafts[1];
  assert.deepEqual([shopify.label, shopify.party, shopify.bank], ["Shopify", "Shopify", { date: "2026-09-30", label: "Shopify" }]);
  assert.equal(r.drafts[3].label, "Facebk *7KQ2M9XL22");
  assert.equal(r.drafts[3].party, "Meta");
  assert.equal(r.drafts[5].label, "Carrefour City", "espaces en double réduites");
  assert.equal(r.drafts[5].party, "Carrefour City");
  assert.equal(r.drafts[9].party, "Uber");
  assert.equal(r.drafts[12].party, "Noa Lambert");
  // l'heure à un chiffre ("9:15:44") ne gêne pas la date
  assert.equal(r.drafts[1].date, "2026-09-29");

  // deux lignes identiques le même jour : deux identifiants différents
  assert.notEqual(r.drafts[3].extId, r.drafts[4].extId);

  // frais dans une colonne à part : second brouillon, catégorie Frais bancaires
  const fee = r.drafts[7];
  assert.equal(fee.label, "Frais Revolut : TikTok Ads");
  assert.equal(fee.party, "Revolut");
  assert.equal(fee.extId, r.drafts[6].extId + ":fee");
  assert.equal(fee.needsReview, undefined);

  // le virement Shopify reçu est une vente, le remboursement de pub réduit la pub
  assert.deepEqual([r.drafts[8].label, r.drafts[8].party], ["Payment from Shopify Inc", "Shopify"]);
  assert.equal(r.drafts[8]._note, undefined);
  assert.equal(r.drafts[11].categoryId, "ads_meta");
  // rechargement sans catégorie : une question pour l'aperçu
  assert.match(r.drafts[0]._note, /apport d'un associé/);
  // virement à un associé : ni dépense ni vente
  assert.equal(r.drafts[12]._partnerId, "noa");
  assert.match(r.drafts[12]._note, /^Noa apparaît dans le libellé : si c'est un remboursement, un retrait ou un règlement entre associés/);
  // ligne de type FEE
  assert.deepEqual([r.drafts[13].label, r.drafts[13].party], ["Premium plan fee", "Revolut"]);

  assert.ok(hasLine(r.info, /^14 mouvements lus du 28 sept\. 2026 au 12 oct\. 2026/), r.info.join("\n"));
  assert.ok(hasLine(r.info, /^5 lignes ignorées : 1 change entre devises, 1 mouvement de poche ou d'épargne, 1 en attente, 2 refusées, annulées ou échouées\.$/), r.info.join("\n"));
  assert.ok(hasLine(r.info, /^Compte personnel \(Camille\) : 10 lignes cochées sur 14/), r.info.join("\n"));
});

test("Revolut personnel, français : mêmes règles avec les titres et les états en français", () => {
  const r = importFile("bank_revolut_fr.csv");
  assert.equal(r.type, "bank_revolut");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-02", -8702, "EUR", "email_sms", true],
    ["2026-10-05", -460, "EUR", null, false],
    ["2026-10-06", 30000, "EUR", null, false],
    ["2026-10-07", -1199, "EUR", "software", true],
    ["2026-10-12", -1248, "EUR", "domain_hosting", true],
    ["2026-10-12", -125, "EUR", "bank_fees", true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.drafts[0].bank.date, "2026-10-03");
  assert.equal(r.drafts[5].label, "Frais Revolut : Namecheap");
  assert.ok(hasLine(r.info, /^4 lignes ignorées : 1 change entre devises, 1 en attente, 1 refusée, annulée ou échouée, 1 mouvement de poche ou d'épargne\.$/), r.info.join("\n"));
});

test("identifiants externes stables : deux relevés qui se recouvrent, puis un nouvel import", () => {
  const first = importFile("bank_revolut_en.csv");
  const second = importFile("bank_revolut_en_suite.csv");
  // relire le même fichier donne exactement les mêmes brouillons
  assert.deepEqual(importFile("bank_revolut_en.csv").drafts, first.drafts);

  const firstIds = new Map(first.drafts.map((d) => [d.extId, d]));
  const common = second.drafts.filter((d) => firstIds.has(d.extId));
  assert.deepEqual(common.map((d) => [d.date, d.label, d.amountCents]), [
    ["2026-10-08", "Applovin Corporation", -9477],
    ["2026-10-09", "Facebk *7KQ2M9XL22", 500],
    ["2026-10-10", "To Noa Lambert", -20000],
    ["2026-10-12", "Premium plan fee", -999],
  ]);
  for (const d of common) assert.deepEqual(brief(firstIds.get(d.extId)), brief(d));
  // la ligne en attente dans le premier relevé arrive terminée dans le second : elle est nouvelle
  const fresh = second.drafts.filter((d) => !firstIds.has(d.extId));
  assert.deepEqual(fresh.map((d) => [d.date, d.label, d.amountCents, d.categoryId]), [
    ["2026-10-11", "Openai *Chatgpt Subscr", -2000, "production_ai"],
    ["2026-10-15", "Facebk *8LM3N0YK31", -2000, "ads_meta"],
    ["2026-10-18", "Klaviyo", -4500, "email_sms"],
  ]);

  // Une fois le premier relevé enregistré, le second ne propose que les nouvelles lignes.
  const book = buildBook(CONFIG, toOps(first.drafts));
  assert.equal(book.checks.skippedOps, 0);
  const dups = second.drafts.map((d) => findDuplicate(d, book));
  assert.deepEqual(dups.map((dup) => (dup ? dup.exact : null)), [true, true, true, null, true, null, null]);
  // même résultat par l'importeur quand il reçoit le livre : aucune ligne déjà importée n'est rapprochée
  const withBook = importer("bank_revolut").parse(second.parsed, { config: CONFIG, book, accountId: "perso_usd" });
  assert.equal(withBook.drafts.filter((d) => d._matchOf).length, 0);
  assert.deepEqual(withBook.drafts.map((d) => d.extId), second.drafts.map((d) => d.extId));

  // l'identifiant dépend du compte choisi
  const other = importFile("bank_revolut_en.csv", "pro_usd");
  assert.ok(other.drafts.every((d) => d.extId.startsWith("bank:pro_usd:")));
});

// ---------------------------------------------------------------------------------------------
// Compte personnel ou compte de l'entreprise

test("compte personnel : seules les lignes classées par une règle ou par le dictionnaire sont cochées", () => {
  const perso = importFile("bank_revolut_en.csv", "perso_usd");
  for (const d of perso.drafts) {
    if (d.extId.endsWith(":fee")) continue;
    assert.equal(d._selected, d.categoryId !== null, d.label);
  }
  // les frais suivent la ligne dont ils dépendent
  assert.equal(perso.drafts[7]._selected, perso.drafts[6]._selected);

  // compte de l'entreprise : tout est coché
  const pro = importFile("bank_revolut_en.csv", "pro_usd");
  assert.ok(pro.drafts.every((d) => d._selected === true));
  assert.deepEqual(pro.drafts.map((d) => d.categoryId), perso.drafts.map((d) => d.categoryId));
  assert.ok(!hasLine(pro.info, /Compte personnel/));
  assert.match(pro.drafts[0]._note, /apport d'un associé/);

  // une règle de l'utilisateur fait cocher la ligne
  const config = normalizeConfig({ ...CONFIG, rules: { r1: { id: "r1", contains: "carrefour", categoryId: "other_expense", enabled: true } } });
  const ruled = importer("bank_revolut").parse(load("bank_revolut_en.csv"), { config, accountId: "perso_usd" });
  const carrefour = byLabel(ruled.drafts, "Carrefour City");
  assert.deepEqual([carrefour.categoryId, carrefour._selected, carrefour.needsReview], ["other_expense", true, undefined]);
  assert.equal(byLabel(ruled.drafts, "Uber *Trip")._selected, false);

  // compte pas encore attribué ou absent des réglages : même prudence que pour un compte personnel
  const unknown = importer("bank_revolut").parse(load("bank_revolut_en.csv"), { config: CONFIG, accountId: "inconnu" });
  assert.equal(byLabel(unknown.drafts, "Carrefour City")._selected, false);
  assert.equal(byLabel(unknown.drafts, "Klaviyo")._selected, true);
  assert.ok(hasLine(unknown.info, /pas encore attribué/));
});

test("une catégorie déduite du type d'opération ne suffit pas à cocher une ligne d'un compte personnel", () => {
  const r = importFile("bank_paypal_fr.csv");
  const refund = byLabel(r.drafts, "Sacha Colin");
  assert.equal(refund.categoryId, "refunds");
  assert.equal(refund._selected, false);
  const fees = r.drafts.filter((d) => d.extId.endsWith(":fee"));
  assert.ok(fees.length === 2 && fees.every((d) => d._selected === false));
});

// ---------------------------------------------------------------------------------------------
// Revolut Business

test("Revolut Business : identifiant de la banque, carte, montant d'origine et montant débité, frais", () => {
  const r = importFile("bank_revolut_business.csv");
  assert.equal(r.type, "bank_revolut_business");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", 500000, "USD", null, true],
    ["2026-11-14", -9477, "USD", "ads_applovin", true],
    ["2026-11-15", -25000, "USD", "ads_meta", true],
    ["2026-11-16", -1199, "EUR", "domain_hosting", true],
    ["2026-11-16", -13, "USD", "bank_fees", true],
    ["2026-11-18", -32000, "USD", null, true],
    ["2026-11-19", -2500, "USD", "bank_fees", true],
    ["2026-11-20", 1000, "USD", "ads_applovin", true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.drafts.every((d) => d.source === "revolut"));

  const topup = r.drafts[0];
  assert.equal(topup.extId, "bank:pro_usd:3f0e1c9a-5b7d-4a21-9c1e-0a1b2c3d4e01");
  assert.deepEqual([topup.label, topup.party, topup.ref, topup.needsReview], ["Money added from Idris Keller", "Idris Keller", "Apport investisseur", true]);
  assert.equal(topup.meta.txId, "3f0e1c9a-5b7d-4a21-9c1e-0a1b2c3d4e01");
  // le nom d'un associé dans une ligne sans catégorie : sans doute un apport, à enregistrer comme mouvement entre comptes
  assert.equal(topup._partnerId, "idris");
  assert.match(topup._note, /^Idris apparaît dans le libellé : si c'est un apport/);
  assert.ok(r.drafts.slice(1).every((d) => d._partnerId === undefined));

  const applovin = r.drafts[1];
  assert.deepEqual([applovin.card, applovin.meta.cardLabel, applovin.party, applovin.bank.date], ["0562", "Ads", "AppLovin", "2026-11-15"]);

  // Achat en euros payé avec le compte en dollars : le reçu est en euros, la banque a débité 13,02 $ plus 0,13 $ de frais.
  const ovh = r.drafts[3];
  assert.deepEqual([ovh.amountCents, ovh.currency, ovh.settledCents, ovh.card, ovh.party], [-1199, "EUR", -1302, "2487", "OVHcloud"]);
  const fee = r.drafts[4];
  assert.deepEqual([fee.label, fee.amountCents, fee.currency, fee.extId], ["Frais Revolut : OVH", -13, "USD", ovh.extId + ":fee"]);
  assert.equal(fee.settledCents, undefined);

  assert.deepEqual([r.drafts[5].party, r.drafts[5].ref], ["Studio Lumen", "INV-2026-0418"]);
  assert.deepEqual([r.drafts[6].label, r.drafts[6].party], ["Grow plan fee", "Revolut"]);
  assert.ok(hasLine(r.info, /^3 lignes ignorées : 1 change entre devises, 1 en attente, 1 refusée, annulée ou échouée\.$/), r.info.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Slash

test("Slash, colonnes du tableau de bord : statuts, carte, remboursement, format signalé comme supposé", () => {
  const r = importFile("bank_slash.csv");
  assert.equal(r.type, "bank_slash");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", -9477, "USD", "ads_applovin", true],
    ["2026-11-14", 1000000, "USD", null, true],
    ["2026-11-15", 100, "USD", "email_sms", true],
    ["2026-11-15", -18025, "USD", "ads_meta", true],
    ["2026-11-17", 84219, "USD", "sales_shopify", true],
    ["2026-11-18", -2900, "USD", "production_ai", true],
    ["2026-11-19", -2200, "USD", "production_ai", true],
    ["2026-11-20", -2500, "USD", "bank_fees", true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.drafts.every((d) => d.source === "slash"));
  assert.deepEqual(r.drafts.map((d) => d.extId), [
    "bank:pro_usd:txn_2b7f9c1e", "bank:pro_usd:txn_2b7f9e55", "bank:pro_usd:txn_2b7fa011", "bank:pro_usd:txn_2b7fa1c3",
    "bank:pro_usd:txn_2b7fa3e2", "bank:pro_usd:txn_2b7fa4f6", "bank:pro_usd:txn_2b7fa5a1", "bank:pro_usd:txn_2b7fa6b3",
  ]);
  const applovin = r.drafts[0];
  assert.deepEqual([applovin.label, applovin.party, applovin.card, applovin.ref, applovin.meta.cardLabel],
    ["APPLOVIN CORPORATION", "AppLovin", "0562", "txn_2b7f9c1e", "Ads AppLovin (0562)"]);
  const deposit = r.drafts[1];
  assert.deepEqual([deposit.label, deposit.party, deposit.needsReview, deposit.card], ["Deposit from Column N.A.", "Column N.A.", true, undefined]);
  assert.match(deposit._note, /Entrée d'argent à classer/);
  assert.equal(r.drafts[2].card, "2487");
  assert.equal(r.drafts[7].party, "Slash");

  assert.ok(hasLine(r.info, /^2 lignes ignorées : 1 en attente, 1 refusée, annulée ou échouée\.$/), r.info.join("\n"));
  assert.ok(hasLine(r.info, /Pas de colonne devise.*USD \(devise du compte\)/), r.info.join("\n"));
  const assumed = r.info.find((s) => /Format Slash supposé/.test(s));
  assert.ok(assumed, r.info.join("\n"));
  assert.match(assumed, /date : « Date », montant : « Amount », tiers : « To\/From », statut : « Status », carte : « Card », identifiant : « ID »/);
});

test("Slash, autre forme plausible : dates américaines, montants sans signe, statuts de l'API, montant d'origine", () => {
  const r = importFile("bank_slash_variante.csv");
  assert.equal(r.type, "bank_slash");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", -9477, "USD", "ads_applovin", true],
    ["2026-11-15", -125000, "USD", "ads_meta", true],
    ["2026-11-15", -1199, "EUR", "domain_hosting", true],
    ["2026-11-17", 231840, "USD", "sales_shopify", true],
    ["2026-11-19", 2000, "USD", "email_sms", true],
  ]);
  assert.deepEqual(r.drafts.map((d) => d.extId), ["txn_01HZX4A", "txn_01HZX4B", "txn_01HZX4C", "txn_01HZX4E", "txn_01HZX4G"].map((id) => "bank:pro_usd:" + id));
  // le tiers sert de libellé, le texte de la banque est gardé à part
  assert.deepEqual([r.drafts[0].label, r.drafts[0].bank.label, r.drafts[0].card, r.drafts[0].meta.cardLabel], ["AppLovin", "APPLOVIN* ADS SAN FRANCISCO CA", "0562", "Ads AppLovin"]);
  assert.equal(r.drafts[2].settledCents, -1302);
  assert.equal(r.drafts[3].card, undefined);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Aucun montant négatif dans ce fichier/);
  assert.ok(hasLine(r.info, /^2 lignes ignorées : 1 en attente, 1 refusée, annulée ou échouée\.$/), r.info.join("\n"));
  assert.ok(hasLine(r.info, /tiers : « Merchant », libellé : « Description », statut : « Status », carte : « Card Last 4 », identifiant : « Transaction ID »/), r.info.join("\n"));
});

test("Slash : montant en centimes, litige et statut inconnu", () => {
  const text = [
    "ID,Date,Merchant,Amount (cents),Status,Card",
    "t1,2026-11-14T18:22:31.000Z,APPLOVIN CORPORATION,-9477,settled,0562",
    "t2,2026-11-15T09:00:00.000Z,FACEBK *ADS,-2000,dispute,2487",
    "t3,2026-11-16T10:00:00.000Z,KLAVIYO INC,-4500,mystere,2487",
  ].join("\n");
  const parsed = parseCsv(text);
  assert.ok(importer("bank_slash").detect(parsed) >= 0.6);
  const r = importer("bank_slash").parse(parsed, { config: CONFIG, accountId: "pro_usd" });
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", -9477, "USD", "ads_applovin", true],
    ["2026-11-15", -2000, "USD", "ads_meta", true],
    ["2026-11-16", -4500, "USD", "email_sms", true],
  ]);
  assert.equal(r.drafts[0].needsReview, undefined);
  assert.equal(r.drafts[1].needsReview, true, "un litige est gardé, à vérifier");
  assert.equal(r.drafts[2].needsReview, true);
  assert.match(r.drafts[2]._note, /Statut inconnu sur le relevé \(« mystere »\)/);
  assert.ok(hasLine(r.warnings, /^2 lignes ont un statut que je ne connais pas/), r.warnings.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Wise

test("Wise, relevé d'un solde : ligne de frais à part, conversion entre soldes ignorée", () => {
  const r = importFile("bank_wise.csv");
  assert.equal(r.type, "bank_wise");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-24", -35738, "USD", null, true],
    ["2026-10-24", -1135, "USD", "bank_fees", true],
    ["2026-10-25", -2900, "USD", "production_ai", true],
    ["2026-10-27", 125000, "USD", "sales_shopify", true],
    ["2026-10-28", -650, "USD", null, true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.drafts.map((d) => d.extId), [
    "bank:pro_usd:TRANSFER-175545673", "bank:pro_usd:TRANSFER-175545673:fee", "bank:pro_usd:CARD-88231077",
    "bank:pro_usd:TRANSFER-175622746", "bank:pro_usd:CARD-88240519",
  ]);
  assert.deepEqual([r.drafts[0].label, r.drafts[0].party, r.drafts[0].ref], ["Sent money to Lina Moreau", "Lina Moreau", "Montage video octobre"]);
  assert.deepEqual([r.drafts[1].label, r.drafts[1].party], ["Wise Charges for: TRANSFER-175545673", "Wise"]);
  assert.deepEqual([r.drafts[2].party, r.drafts[2].card], ["HeyGen", "7741"]);
  assert.equal(r.drafts[4].party, "Blue Bottle Coffee");
  // la colonne "Total fees" n'est qu'une information : aucun brouillon de frais en plus
  assert.equal(r.drafts.filter((d) => d.categoryId === "bank_fees").length, 1);
  assert.ok(hasLine(r.info, /^1 ligne ignorée : 1 conversion entre soldes\.$/), r.info.join("\n"));
  assert.ok(r.drafts.every((d) => d.source === "bank"));
});

test("Wise, liste des transferts : sens donné par la colonne Direction, frais d'envoi à part", () => {
  const r = importFile("bank_wise_transferts.csv");
  assert.equal(r.type, "bank_wise_history");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-05", -100000, "USD", null, true],
    ["2026-10-05", -456, "USD", "bank_fees", true],
    ["2026-10-08", 250000, "USD", "sales_shopify", true],
    ["2026-10-12", -15000, "USD", null, true],
    ["2026-10-12", -120, "USD", "bank_fees", true],
  ]);
  assert.deepEqual([r.drafts[0].label, r.drafts[0].party, r.drafts[0].ref, r.drafts[0].extId], ["Lina Moreau", "Lina Moreau", "Facture 42", "bank:pro_usd:TRANSFER-1234567890"]);
  assert.deepEqual([r.drafts[1].label, r.drafts[1].extId], ["Frais Wise : Lina Moreau", "bank:pro_usd:TRANSFER-1234567890:fee"]);
  assert.equal(r.drafts[2].party, "Shopify");
  assert.ok(hasLine(r.info, /^2 lignes ignorées : 1 conversion entre soldes, 1 refusée, annulée ou échouée\.$/), r.info.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Mercury, PayPal, Qonto, N26, Payoneer

test("Mercury : dates mois-jour-année, statuts Sent, Failed, Pending", () => {
  const r = importFile("bank_mercury.csv");
  assert.equal(r.type, "bank_mercury");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-02", -31244, "USD", "ads_meta", true],
    ["2026-11-03", 189012, "USD", "sales_shopify", true],
    ["2026-11-05", -55000, "USD", null, true],
    ["2026-11-07", -2000, "USD", "production_ai", true],
  ]);
  assert.deepEqual(r.warnings, [], "l'ordre mois/jour est connu pour Mercury : pas d'avertissement");
  const meta = r.drafts[0];
  assert.deepEqual([meta.label, meta.party, meta.card, meta.bank.label, meta.meta.cardLabel],
    ["Meta Platforms", "Meta", "0562", "FACEBK *RT5KD92LM2 MENLO PARK CA", "Camille Roux"]);
  assert.deepEqual([r.drafts[2].party, r.drafts[2].ref], ["Marlow Studio", "From StarringYou LLC, voix off"]);
  assert.match(r.drafts[0].extId, /^bank:pro_usd:[0-9a-f]{16}$/);
  assert.ok(hasLine(r.info, /^2 lignes ignorées : 1 refusée, annulée ou échouée, 1 en attente\.$/), r.info.join("\n"));
});

test("PayPal, anglais : brut et commission séparés, lignes d'information et conversions ignorées", () => {
  const r = importFile("bank_paypal_en.csv");
  assert.equal(r.type, "bank_paypal");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-03", 3900, "USD", null, true],
    ["2026-11-03", -184, "USD", "fees_payment", true],
    ["2026-11-04", -9477, "USD", "email_sms", true],
    ["2026-11-05", -3900, "USD", "refunds", true],
    ["2026-11-05", 154, "USD", "fees_payment", true],
    ["2026-11-06", -10000, "EUR", null, true],
    ["2026-11-07", -150000, "USD", null, true],
    ["2026-11-09", -12000, "USD", "freelancers", true],
  ]);
  const sale = r.drafts[0];
  assert.deepEqual([sale.label, sale.party, sale.ref, sale.extId, sale.bank.label], ["Jordan Avery", "Jordan Avery", "5XY12345AB678901C", "bank:pro_usd:5XY12345AB678901C", "Personalized movie"]);
  assert.deepEqual([r.drafts[1].label, r.drafts[1].party, r.drafts[1].extId], ["Frais PayPal : Jordan Avery", "PayPal", "bank:pro_usd:5XY12345AB678901C:fee"]);
  // retrait vers la banque : libellé repris du type, pas de tiers, une remarque pour l'aperçu
  const withdrawal = r.drafts[6];
  assert.deepEqual([withdrawal.label, withdrawal.party], ["General Withdrawal", undefined]);
  assert.match(withdrawal._note, /mouvement entre comptes/);
  assert.equal(r.drafts[7].party, "Fiverr");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^1 ligne est en EUR alors que le compte « Compte pro USD » est en USD/);
  assert.ok(hasLine(r.info, /^4 lignes ignorées : 1 ligne d'information, 2 conversions entre soldes, 1 en attente\.$/), r.info.join("\n"));
});

test("PayPal, français : BOM, tout entre guillemets, virgule décimale, espace insécable des milliers, jour/mois", () => {
  assert.deepEqual(Array.from(bytes("bank_paypal_fr.csv").subarray(0, 3)), [0xef, 0xbb, 0xbf]);
  const r = importFile("bank_paypal_fr.csv");
  assert.equal(r.type, "bank_paypal");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", -9477, "USD", "email_sms", true],
    ["2026-11-15", 3900, "EUR", null, false],
    ["2026-11-15", -143, "EUR", "fees_payment", false],
    ["2026-11-16", -125000, "EUR", null, false],
    ["2026-11-18", -3900, "EUR", "refunds", false],
    ["2026-11-18", 143, "EUR", "fees_payment", false],
  ]);
  assert.equal(r.drafts[3].label, "Retrait général");
  assert.equal(r.drafts[0].extId, "bank:perso_eur:5XY12345AB678901C");
  assert.ok(hasLine(r.info, /^3 lignes ignorées : 1 ligne d'information, 1 en attente, 1 conversion entre soldes\.$/), r.info.join("\n"));
});

test("Qonto : date locale de l'opération, montant d'origine, frais d'abonnement", () => {
  const r = importFile("bank_qonto.csv");
  assert.equal(r.type, "bank_qonto");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-13", -25000, "EUR", "ads_meta", true],
    ["2026-10-14", -2000, "USD", "production_ai", true],
    ["2026-10-16", -900, "EUR", "bank_fees", true],
    ["2026-10-17", 184055, "EUR", "sales_shopify", true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.drafts[0].bank.date, "2026-10-14");
  assert.equal(r.drafts[1].settledCents, -1842);
  assert.deepEqual([r.drafts[2].label, r.drafts[2].ref], ["Qonto", "Abonnement Solo"]);
  assert.equal(r.drafts[3].extId, "bank:pro_eur:starringyou-1-transaction-1045");
  assert.ok(hasLine(r.info, /^2 lignes ignorées : 1 en attente, 1 refusée, annulée ou échouée\.$/), r.info.join("\n"));
});

test("N26 : devise lue dans le titre de la colonne, montant d'origine en dollars", () => {
  const r = importFile("bank_n26.csv");
  assert.equal(r.type, "bank_n26");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-03", -4500, "USD", "email_sms", true],
    ["2026-10-04", -1830, "EUR", null, false],
    ["2026-10-06", 61240, "EUR", "sales_shopify", true],
    ["2026-10-07", -32800, "EUR", null, false],
  ]);
  assert.equal(r.drafts[0].settledCents, -4215);
  assert.ok(!hasLine(r.info, /Pas de colonne devise/), "la devise vient du titre « Amount (EUR) »");
  assert.deepEqual(r.warnings, []);
});

test("Payoneer : colonnes crédit et débit, tiers selon le sens", () => {
  const r = importFile("bank_payoneer.csv");
  assert.equal(r.type, "bank_payoneer");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-05", 145000, "USD", "sales_shopify", true],
    ["2026-10-07", -9477, "USD", "ads_applovin", true],
    ["2026-10-11", -22000, "USD", "freelancers", true],
  ]);
  assert.deepEqual(r.drafts.map((d) => d.party), ["Shopify", "AppLovin", "Marlow Studio"]);
  assert.deepEqual(r.drafts.map((d) => d.extId), ["bank:pro_usd:880114201", "bank:pro_usd:880114377", "bank:pro_usd:880114688"]);
  assert.ok(hasLine(r.info, /^1 ligne ignorée : 1 en attente\.$/), r.info.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Importeur générique : banques françaises et autres

test("générique, Fortuneo : fichier en windows-1252, colonnes débit et crédit, virgule décimale", () => {
  const raw = bytes("bank_generic_fortuneo.csv");
  assert.ok(raw.includes(0xe9) && !raw.includes(0xc3), "le fichier d'exemple n'est pas en UTF-8");
  const r = importFile("bank_generic_fortuneo.csv");
  assert.equal(r.type, "bank_generic");
  assert.deepEqual(r.parsed.headers, ["Date", "Valeur", "Libellé", "Débit", "Crédit"]);
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-02", -4137, "EUR", "email_sms", true],
    ["2026-10-03", -3210, "EUR", null, false],
    ["2026-10-05", 124056, "EUR", "sales_shopify", true],
    ["2026-10-06", -1999, "EUR", null, false],
    ["2026-10-31", 367, "EUR", null, false],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual([r.drafts[0].label, r.drafts[0].party], ["CARTE 01/10 KLAVIYO INC", "Klaviyo"]);
  assert.equal(r.drafts[1].party, "MONOPRIX PARIS");
  assert.equal(r.drafts[3].party, "FREE MOBILE");
  assert.equal(r.drafts[4].party, undefined);
  assert.equal(r.drafts[4].bank.date, "2026-11-01", "date de valeur");
  assert.ok(r.drafts.every((d) => d.source === "bank" && /^bank:noa_eur:[0-9a-f]{16}$/.test(d.extId)));
  assert.ok(hasLine(r.info, /Pas de colonne devise.*EUR \(devise du compte\)/));
  assert.ok(hasLine(r.info, /^Compte personnel \(Noa\) : 2 lignes cochées sur 5/), r.info.join("\n"));
});

test("générique, La Banque Postale : lignes de titre avant l'en-tête, euro collé au montant, libellés remplis d'espaces", () => {
  const r = importFile("bank_generic_banque_postale.csv");
  assert.equal(r.type, "bank_generic");
  assert.equal(r.parsed.preamble.length, 5);
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-29", -42000, "EUR", null, true],
    ["2026-10-27", -1199, "EUR", "software", true],
    ["2026-10-22", 118025, "EUR", "sales_shopify", true],
    ["2026-10-20", -6410, "EUR", null, true],
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual([r.drafts[0].label, r.drafts[0].party], ["VIREMENT POUR Studio Lumen FACTURE 2026-031", "Studio Lumen"]);
  assert.equal(r.drafts[1].party, "Canva");
  assert.equal(r.drafts[3].party, "EDF CLIENTS PARTICULIERS");
});

test("générique, Caisse d'Epargne : débit déjà négatif, crédit avec un plus, date d'opération préférée à la date comptable", () => {
  const r = importFile("bank_generic_caisse_epargne.csv");
  assert.equal(r.type, "bank_generic");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-14", -9477, "EUR", "email_sms", true],
    ["2026-11-16", 231040, "EUR", "sales_shopify", true],
    ["2026-11-16", -2750, "EUR", null, true],
    ["2026-11-18", -1200, "EUR", "bank_fees", true],
  ]);
  assert.deepEqual(r.warnings, []);
  const klaviyo = r.drafts[0];
  assert.deepEqual([klaviyo.label, klaviyo.party, klaviyo.ref, klaviyo.bank.date, klaviyo.meta.type], ["CB KLAVIYO INC FACT 141126", "Klaviyo", "ABC1230", "2026-11-15", "Carte bancaire"]);
  assert.equal(r.drafts[2].party, "BOUCHERIE DU COIN");
});

test("générique, BoursoBank : montant signé avec espace des milliers, carte lue dans le libellé", () => {
  const r = importFile("bank_generic_boursobank.csv");
  assert.equal(r.type, "bank_generic");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-01", -3210, "EUR", null, false],
    ["2026-10-02", -15000, "EUR", "ads_meta", true],
    ["2026-10-05", 102030, "EUR", "sales_shopify", true],
  ]);
  assert.deepEqual(r.drafts.map((d) => d.card), ["4821", "4821", undefined]);
  assert.equal(r.drafts[0].party, "monoprix");
  assert.deepEqual(r.warnings, []);
});

test("générique, banque américaine : lignes abîmées signalées avec leur numéro, total et montant nul écartés", () => {
  const r = importFile("bank_generic_banque_us.csv");
  assert.equal(r.type, "bank_generic");
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-11-03", -31244, "USD", "ads_meta", true],
    ["2026-11-04", 189012, "USD", "sales_shopify", true],
    ["2026-11-06", -1500, "USD", "bank_fees", true],
  ]);
  assert.deepEqual(r.warnings, [
    "Ligne 5 ignorée : date illisible (« not a date »).",
    "Ligne 6 ignorée : montant illisible (« abc »).",
    "Les dates de ce fichier peuvent se lire dans les deux sens (jour/mois ou mois/jour). Je les ai lues comme mois/jour/année : vérifie une date avant d'importer.",
  ]);
  assert.ok(hasLine(r.info, /^1 ligne ignorée : 1 à montant nul\.$/), r.info.join("\n"));
  assert.equal(r.drafts[2].party, undefined);
  assert.equal(r.drafts[0].meta.type, "DEBIT_CARD");
});

// ---------------------------------------------------------------------------------------------
// Tolérance

test("colonnes inconnues et ordre des colonnes : mêmes brouillons, mêmes identifiants", () => {
  const reference = importFile("bank_revolut_en.csv");
  const rows = decodeBytes(bytes("bank_revolut_en.csv")).trim().split("\n").map((l) => l.split(","));
  const order = [8, 4, 0, 9, 5, 2, 7, 1, 6, 3];
  const shuffled = rows.map((cells, i) => [...order.map((k) => cells[k]), i === 0 ? "Emoji" : "?", i === 0 ? "Hidden" : ""].join(","));
  const parsed = parseCsv(shuffled.join("\r\n"));
  assert.equal(parsed.headers[0], "State");
  const imp = importer("bank_revolut");
  assert.ok(imp.detect(parsed) >= 0.6);
  assert.deepEqual(imp.parse(parsed, { config: CONFIG, accountId: "perso_usd" }).drafts, reference.drafts);
});

test("les deux conventions décimales, décidées sur toute la colonne", () => {
  const french = parseCsv("Date;Libellé;Montant\n05/10/2026;CB KLAVIYO;-1.234,50\n06/10/2026;CB CANVA;-12\n07/10/2026;VIR SHOPIFY;2 500,5\n");
  assert.deepEqual(parseBankRows(french, guessMapping(french), { config: CONFIG, accountId: "pro_eur" }).drafts.map((d) => d.amountCents), [-123450, -1200, 250050]);
  const us = parseCsv("Date,Description,Amount\n10/05/2026,KLAVIYO,\"-1,234.50\"\n10/06/2026,CANVA,-12\n10/07/2026,SHOPIFY,\"2,500\"\n10/15/2026,APPLOVIN,(94.77)\n");
  const usDrafts = parseBankRows(us, guessMapping(us), { config: CONFIG, accountId: "pro_usd" }).drafts;
  assert.deepEqual(usDrafts.map((d) => [d.date, d.amountCents]), [["2026-10-05", -123450], ["2026-10-06", -1200], ["2026-10-07", 250000], ["2026-10-15", -9477]]);
  assert.equal(guessMapping(french).decimal, ",");
  assert.equal(guessMapping(us).decimal, ".");
  assert.equal(guessMapping(french).dateOrder, "DMY");
  assert.equal(guessMapping(us).dateOrder, "MDY");
});

test("montants à plus de deux décimales : arrondis, avec un avertissement", () => {
  const parsed = parseCsv("Date,Description,Amount\n2026-10-05,KLAVIYO,-12.3456\n2026-10-06,CANVA,-100.0000\n2026-10-07,HEYGEN,-29.005\n");
  const r = importer("bank_generic").parse(parsed, { config: CONFIG, accountId: "pro_usd" });
  assert.deepEqual(r.drafts.map((d) => d.amountCents), [-1235, -10000, -2901]);
  assert.ok(hasLine(r.warnings, /^2 montants avaient plus de deux décimales/), r.warnings.join("\n"));
});

test("parse ne lève jamais d'exception", () => {
  const odd = [null, undefined, 7, {}, { headers: ["Date", "Amount"], rows: null }, { headers: ["Date", "Description", "Amount"], rows: [null, 5, [], ["2026-10-05"], ["2026-10-05", "KLAVIYO", "-12.00", "en trop"]] }, parseCsv("")];
  const contexts = [undefined, null, {}, { config: "x", book: 3, accountId: 12, options: "y" }, { config: CONFIG, accountId: "pro_usd", options: { mapping: { date: 99, amount: "x" }, ignored: 5 } }];
  for (const imp of IMPORTERS) {
    for (const input of odd) {
      for (const ctx of contexts) {
        const r = imp.parse(input, ctx);
        assert.ok(Array.isArray(r.drafts) && Array.isArray(r.warnings) && Array.isArray(r.info), imp.type);
        assert.equal(r.stats, null);
      }
    }
  }
  // les lignes utilisables d'un fichier abîmé sont gardées
  const r = importer("bank_generic").parse(odd[5], { config: CONFIG, accountId: "pro_usd" });
  assert.deepEqual(r.drafts.map(brief), [["2026-10-05", -1200, "USD", "email_sms", true]]);
  // fichier vide : un message, pas de brouillon
  const empty = importer("bank_generic").parse(parseCsv(""), { config: CONFIG, accountId: "pro_usd" });
  assert.deepEqual(empty.drafts, []);
  assert.equal(empty.warnings.length, 1);
  // beaucoup de lignes illisibles : la liste des avertissements reste courte
  const many = ["Date,Description,Amount"];
  for (let i = 0; i < 40; i++) many.push("pas une date,LIGNE " + i + ",-1.00");
  const flood = importer("bank_generic").parse(parseCsv(many.join("\n")), { config: CONFIG, accountId: "pro_usd" });
  assert.equal(flood.drafts.length, 0);
  assert.ok(flood.warnings.length <= 15, String(flood.warnings.length));
  assert.ok(hasLine(flood.warnings, /^28 autres lignes illisibles ignorées\.$/), flood.warnings.join("\n"));
});

test("export de compte crypto Revolut : refusé avec une explication", () => {
  const parsed = parseCsv("Type,Product,Started Date,Completed Date,Description,Amount,Currency,Fiat amount,Fiat amount (inc. fees),Fee,Base currency,State,Balance\n" +
    "EXCHANGE,Current,2026-10-04 06:23:24,2026-10-04 06:23:24,Exchanged to BTC,0.0100,BTC,612.40,621.58,9.18,USD,COMPLETED,0.0100\n");
  assert.equal(importer("bank_revolut").detect(parsed), 0);
  assert.ok(importer("bank_generic").detect(parsed) < 0.3);
  const r = importer("bank_generic").parse(parsed, { config: CONFIG, accountId: "perso_usd" });
  assert.deepEqual(r.drafts, []);
  assert.match(r.warnings[0], /compte crypto/);
});

// ---------------------------------------------------------------------------------------------
// Colonnes choisies à la main

test("guessMapping : rôles des colonnes d'un relevé", () => {
  const m = guessMapping(load("bank_generic_caisse_epargne.csv"));
  assert.deepEqual(
    { date: m.date, valueDate: m.valueDate, label: m.label, counterparty: m.counterparty, amount: m.amount, debit: m.debit, credit: m.credit, currency: m.currency, fee: m.fee, balance: m.balance, reference: m.reference, dateOrder: m.dateOrder, decimal: m.decimal },
    { date: 10, valueDate: 11, label: 2, counterparty: 1, amount: -1, debit: 8, credit: 9, currency: -1, fee: -1, balance: -1, reference: 3, dateOrder: "DMY", decimal: "," },
  );
  const revolut = guessMapping(load("bank_revolut_fr.csv"));
  assert.deepEqual([revolut.date, revolut.valueDate, revolut.label, revolut.amount, revolut.fee, revolut.currency, revolut.balance, revolut.status, revolut.dateOrder, revolut.decimal],
    [2, 3, 4, 5, 6, 7, 9, 8, "YMD", "."]);
  // les colonnes d'un préréglage, à la demande
  const slash = guessMapping(load("bank_slash.csv"), "bank_slash");
  assert.deepEqual([slash.id, slash.date, slash.counterparty, slash.amount, slash.status, slash.card], [0, 1, 2, 3, 4, 5]);
  // rien d'exploitable : tout à -1, jamais d'exception
  const none = guessMapping(null);
  assert.deepEqual([none.date, none.amount, none.label], [-1, -1, -1]);
  for (const key of ["date", "label", "counterparty", "amount", "debit", "credit", "currency", "fee", "balance", "reference", "dateOrder", "decimal"]) assert.ok(key in none, key);
});

test("parseBankRows : fichier sans en-tête, colonnes indiquées par l'utilisateur", () => {
  // Forme des exports BNP Paribas : pas de ligne de titres.
  const text = [
    "15/10/2026;Paiement par carte;Carte;FACTURE CARTE DU 141026 KLAVIYO CARTE 4974XXXXXXXX1234;-94,77",
    "16/10/2026;Virement reçu;Virement;VIR SEPA SHOPIFY PAYMENTS;1 240,56",
    "17/10/2026;Paiement par carte;Carte;FACTURE CARTE DU 161026 BOUCHERIE DU COIN CARTE 4974XXXXXXXX1234;-27,50",
  ].join("\n");
  const parsed = parseCsv(text, { noHeader: true });
  assert.ok(importer("bank_generic").detect(parsed) < 0.3);
  const guess = guessMapping(parsed);
  assert.equal(guess.date, -1);
  const blind = parseBankRows(parsed, guess, { config: CONFIG, accountId: "pro_eur" });
  assert.deepEqual(blind.drafts, []);
  assert.match(blind.warnings[0], /colonne de la date ou celle du montant/);

  const r = parseBankRows(parsed, { ...guess, date: 0, label: 3, amount: 4 }, { config: CONFIG, accountId: "pro_eur" });
  assert.deepEqual(r.drafts.map(brief), [
    ["2026-10-15", -9477, "EUR", "email_sms", true],
    ["2026-10-16", 124056, "EUR", "sales_shopify", true],
    ["2026-10-17", -2750, "EUR", null, true],
  ]);
  assert.deepEqual(r.drafts.map((d) => d.card), ["1234", undefined, "1234"]);
  assert.equal(r.drafts[2].party, "BOUCHERIE DU COIN");
  assert.deepEqual(r.warnings, []);
  // une colonne hors du fichier est ignorée
  assert.deepEqual(parseBankRows(parsed, { date: 0, label: 3, amount: 4, currency: 42 }, { config: CONFIG, accountId: "pro_eur" }).drafts.map(brief), r.drafts.map(brief));
});

test("parseBankRows : ordre des dates et séparateur décimal imposés, règles d'une banque gardées", () => {
  const parsed = parseCsv("When,What,How much\n03/04/2026,KLAVIYO,\"1,234\"\n05/04/2026,CANVA,\"12,5\"\n");
  const base = { date: 0, label: 1, amount: 2 };
  const fr = parseBankRows(parsed, { ...base, dateOrder: "DMY", decimal: "," }, { config: CONFIG, accountId: "pro_eur" });
  assert.deepEqual(fr.drafts.map((d) => [d.date, d.amountCents]), [["2026-04-03", 123], ["2026-04-05", 1250]]);
  const us = parseBankRows(parsed, { ...base, dateOrder: "MDY", decimal: "." }, { config: CONFIG, accountId: "pro_usd" });
  assert.deepEqual(us.drafts.map((d) => [d.date, d.amountCents]), [["2026-03-04", 123400], ["2026-05-04", 12500]]);
  assert.ok(!hasLine(us.warnings, /deux sens/), "l'ordre a été choisi : plus d'avertissement");

  // Colonnes corrigées en gardant les règles Revolut (lignes en attente, changes) et la source.
  const revolut = load("bank_revolut_en.csv");
  const mapping = guessMapping(revolut, "bank_revolut");
  const kept = parseBankRows(revolut, mapping, { config: CONFIG, accountId: "perso_usd", options: { preset: "bank_revolut" } });
  assert.deepEqual(kept.drafts, importFile("bank_revolut_en.csv").drafts);
  // la date de fin à la place de la date de début
  const byCompletion = parseBankRows(revolut, { ...mapping, date: mapping.valueDate, valueDate: -1 }, { config: CONFIG, accountId: "perso_usd", options: { preset: "bank_revolut" } });
  assert.equal(byCompletion.drafts[1].date, "2026-09-30");
  // même correction passée à l'importeur
  const viaOptions = importer("bank_revolut").parse(revolut, { config: CONFIG, accountId: "perso_usd", options: { mapping: { date: mapping.valueDate } } });
  assert.equal(viaOptions.drafts[1].date, "2026-09-30");
});

test("lignes déjà écartées par l'utilisateur : elles restent décochées", () => {
  const first = importFile("bank_slash.csv");
  const deposit = first.drafts[1];
  const key = ignoreKey(deposit);
  assert.match(key, /^[0-9a-f]{16}$/);
  for (const ignored of [{ [key]: "2026-11-21" }, new Set([key]), [key]]) {
    const again = importFile("bank_slash.csv", "pro_usd", { options: { ignored } });
    assert.deepEqual(again.drafts.map((d) => d._selected), [true, false, true, true, true, true, true, true]);
    assert.match(again.drafts[1]._note, /écartée lors d'un import précédent/);
  }
});

// ---------------------------------------------------------------------------------------------
// Tous les fichiers d'exemple

test("tous les brouillons sont des opérations valides, en centimes entiers, sans tiret long dans les messages", () => {
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const name of Object.keys(EXPECTED_TYPE)) {
    const r = importFile(name);
    assert.ok(r.drafts.length > 0, name);
    const ids = new Set();
    for (const d of r.drafts) {
      assert.equal(d.kind, "pl", name);
      assert.ok(Number.isSafeInteger(d.amountCents) && d.amountCents !== 0, name + " " + d.label);
      assert.match(d.date, /^2026-(09|10|11)-\d\d$/, name + " " + d.label);
      assert.match(d.currency, /^[A-Z]{3}$/);
      assert.ok(d.label && d.label === d.label.trim() && !/\s\s/.test(d.label), name + " [" + d.label + "]");
      assert.ok(["bank", "revolut", "slash"].includes(d.source));
      assert.equal(typeof d._selected, "boolean");
      assert.equal(d.accountId, ACCOUNT_OF[name]);
      assert.ok(d.extId.startsWith("bank:" + ACCOUNT_OF[name] + ":"), d.extId);
      assert.ok(!ids.has(d.extId), "identifiant en double : " + d.extId);
      ids.add(d.extId);
      if (d.card !== undefined) assert.match(d.card, /^\d{4}$/);
      if (d.settledCents !== undefined) {
        assert.ok(Number.isSafeInteger(d.settledCents) && Math.sign(d.settledCents) === Math.sign(d.amountCents));
        assert.notEqual(d.currency, CONFIG.accounts[d.accountId].currency);
      }
      assert.deepEqual(d.bank && Object.keys(d.bank), ["date", "label"]);
      assert.deepEqual(validateOp(d, CONFIG), [], name + " " + d.label);
      // l'opération enregistrée garde tout, sauf les champs de l'aperçu
      const stored = normalizeOp({ id: "op_x", ...d });
      assert.ok(stored, name);
      for (const key of Object.keys(d)) {
        if (key[0] === "_") assert.ok(!(key in stored));
        else assert.deepEqual(stored[key], d[key], name + " " + key);
      }
    }
    for (const s of [...r.warnings, ...r.info]) {
      assert.equal(typeof s, "string");
      assert.ok(!dash.test(s), s);
      assert.match(s, /[.?]$/, s);
    }
    // un livre construit avec ces opérations est cohérent
    const book = buildBook(CONFIG, toOps(r.drafts));
    assert.equal(book.checks.skippedOps, 0, name);
    assert.equal(book.checks.identityDiffCents, 0, name);
    assert.equal(book.ops.length, r.drafts.length, name);
  }
});

test("fichier importé dans un compte d'une autre devise ou avec la carte d'un autre compte : avertissement", () => {
  // Relevé Revolut en dollars importé par erreur dans le compte en euros.
  const wrong = importFile("bank_revolut_en.csv", "perso_eur");
  // 13 lignes du relevé (les frais d'une ligne ne sont pas comptés à part)
  assert.ok(hasLine(wrong.warnings, /^13 lignes sont en USD alors que le compte « Revolut de Camille \(EUR\) » est en EUR/), wrong.warnings.join("\n"));
  assert.ok(wrong.drafts.every((d) => d.currency === "USD"));
  // Les cartes 0562 et 2487 sont rattachées au compte pro en dollars dans les réglages.
  const otherAccount = importFile("bank_slash.csv", "perso_usd");
  assert.ok(hasLine(otherAccount.warnings, /^La carte 0562 est rattachée au compte « Compte pro USD » dans tes réglages/), otherAccount.warnings.join("\n"));
  assert.equal(importFile("bank_slash.csv", "pro_usd").warnings.length, 0);
});
