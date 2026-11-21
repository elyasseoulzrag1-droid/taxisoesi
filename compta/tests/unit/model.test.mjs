import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION, GROUPS, AD_PLATFORMS, ACCOUNT_KINDS, PARTNER_ROLES, DEFAULT_CATEGORIES, SOURCES,
  BUSINESS, UNKNOWN, UNCATEGORIZED,
  defaultConfig, normalizeConfig, normalizeOp, validateOp, isTransfer, accountOwner,
  listPartners, listAccounts, listCategories, accountForCard,
  categoryLabel, accountLabel, partnerLabel, groupLabel, sourceLabel, isMonthClosed,
  listShareRules, shareTimeline, sharesOn,
} from "../../src/core/model.js";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Constantes

test("groupes, plateformes et catégories par défaut suivent le cahier des charges", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(GROUPS.map((g) => g.id), ["sales", "ads", "production", "platform", "tools", "people", "finance", "admin", "other"]);
  assert.deepEqual(GROUPS.filter((g) => g.kind === "income").map((g) => g.id), ["sales"]);
  assert.deepEqual(AD_PLATFORMS.map((p) => [p.id, p.categoryId]), [
    ["meta", "ads_meta"], ["tiktok", "ads_tiktok"], ["applovin", "ads_applovin"], ["google", "ads_google"], ["other", "ads_other"],
  ]);
  const expected = {
    sales_shopify: ["income", "sales"], sales_other: ["income", "sales"], refunds: ["income", "sales"], other_income: ["income", "sales"],
    ads_meta: ["expense", "ads"], ads_tiktok: ["expense", "ads"], ads_applovin: ["expense", "ads"], ads_google: ["expense", "ads"], ads_other: ["expense", "ads"],
    production_ai: ["expense", "production"], production_other: ["expense", "production"],
    shopify_sub: ["expense", "platform"], shopify_apps: ["expense", "platform"], fees_payment: ["expense", "platform"], chargebacks: ["expense", "platform"],
    email_sms: ["expense", "tools"], software: ["expense", "tools"], domain_hosting: ["expense", "tools"],
    creators: ["expense", "people"], freelancers: ["expense", "people"],
    bank_fees: ["expense", "finance"],
    legal_admin: ["expense", "admin"], taxes: ["expense", "admin"],
    shipping: ["expense", "other"], other_expense: ["expense", "other"],
  };
  assert.deepEqual(Object.keys(DEFAULT_CATEGORIES).sort(), Object.keys(expected).sort());
  for (const [id, [kind, group]] of Object.entries(expected)) {
    const c = DEFAULT_CATEGORIES[id];
    assert.equal(c.id, id);
    assert.equal(c.kind, kind, id);
    assert.equal(c.group, group, id);
    assert.equal(c.system, true);
    assert.equal(c.archived, false);
    assert.ok(c.name.length > 2);
    assert.equal(GROUPS.find((g) => g.id === group).kind, kind);
  }
  assert.equal(DEFAULT_CATEGORIES.sales_shopify.name, "Ventes Shopify");
  assert.equal(DEFAULT_CATEGORIES.email_sms.name, "Email et SMS (Klaviyo)");
  // l'ordre d'affichage suit l'ordre du cahier des charges
  const orders = Object.values(DEFAULT_CATEGORIES).map((c) => c.order);
  assert.deepEqual(orders, orders.slice().sort((a, b) => a - b));
  assert.equal(new Set(orders).size, orders.length);
  for (const p of AD_PLATFORMS) assert.equal(DEFAULT_CATEGORIES[p.categoryId].group, "ads");
  assert.deepEqual(ACCOUNT_KINDS.map((k) => k.id), ["bank", "card", "paypal", "wallet", "cash", "other"]);
  assert.deepEqual(PARTNER_ROLES.map((r) => r.id), ["founder", "investor", "partner"]);
});

test("les origines d'opération ont un libellé, et aucune ne parle de mail", () => {
  for (const id of ["manual", "shopify", "meta", "tiktok", "applovin", "bank", "scan", "recurring", "claude", "demo"]) {
    assert.ok(typeof SOURCES[id] === "string" && SOURCES[id].length > 2, id);
  }
  assert.equal(SOURCES.scan, "Reçu scanné");
  assert.equal(SOURCES.gmail, undefined);
  assert.equal(SOURCES.mail, undefined);
  assert.equal(sourceLabel("shopify"), "Shopify");
  assert.equal(sourceLabel("inconnue"), "Autre origine");
  assert.equal(sourceLabel("constructor"), "Autre origine");
  assert.equal(sourceLabel(undefined), "Autre origine");
});

// ---------------------------------------------------------------------------------------------
// Configuration

test("defaultConfig : catégories par défaut, aucun associé, aucun compte, aucune règle de partage", () => {
  const c = defaultConfig();
  assert.equal(c.v, 1);
  assert.equal(c.onboarded, false);
  assert.equal(c.demo, false);
  assert.deepEqual(c.business, {
    name: "StarringYou", baseCurrency: "USD", startDate: null, pivotDate: null, pivotLabel: "Arrivée de l'investisseur", vat: false,
  });
  assert.deepEqual(c.partners, {});
  assert.deepEqual(c.accounts, {});
  assert.deepEqual(c.shareRules, {});
  assert.deepEqual(c.rules, {});
  assert.deepEqual(c.recurring, {});
  assert.deepEqual(c.fx, {});
  assert.deepEqual(c.closed, {});
  assert.deepEqual(Object.keys(c.categories).sort(), Object.keys(DEFAULT_CATEGORIES).sort());
  // chaque appel donne un objet neuf, modifiable sans toucher aux valeurs par défaut
  c.categories.ads_meta.name = "Modifié";
  c.partners.x = { id: "x" };
  const again = defaultConfig();
  assert.equal(again.categories.ads_meta.name, "Pub Meta (Facebook, Instagram)");
  assert.deepEqual(again.partners, {});
  assert.equal(DEFAULT_CATEGORIES.ads_meta.name, "Pub Meta (Facebook, Instagram)");
});

test("normalizeConfig ne lève jamais d'exception, quoi qu'on lui donne", () => {
  const hostile = {
    get business() { throw new Error("piège"); },
  };
  const proxy = new Proxy({}, { get() { throw new Error("piège"); }, ownKeys() { throw new Error("piège"); } });
  const inputs = [
    undefined, null, 0, 42, "texte", true, [], [1, 2], () => {}, Symbol("s"), NaN, new Date(), new Map(),
    { business: null, partners: null, accounts: 7, categories: "x", rules: [], recurring: [null], fx: [], closed: 3, shareRules: "y" },
    { partners: { a: null, b: 5, c: "x", d: [] }, accounts: { a: null, b: [] } },
    { business: { baseCurrency: 12, name: {}, pivotDate: "hier", startDate: 20260929, vat: "oui" } },
    { fx: { EUR: null, GBP: { months: null, default: "abc" }, "??": { default: 2 } } },
    { shareRules: { r: { shares: null }, s: { shares: { a: "x", b: -3, c: null } }, t: null } },
    hostile, proxy,
  ];
  for (const input of inputs) {
    let out;
    assert.doesNotThrow(() => { out = normalizeConfig(input); });
    assert.equal(out.v, 1);
    assert.equal(typeof out.business.name, "string");
    assert.ok(["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "MAD", "AED"].includes(out.business.baseCurrency));
    for (const key of ["partners", "accounts", "categories", "rules", "recurring", "fx", "closed", "shareRules"]) {
      assert.equal(typeof out[key], "object", key);
      assert.ok(out[key] !== null && !Array.isArray(out[key]), key);
    }
    assert.ok(out.categories.sales_shopify);
  }
  assert.deepEqual(normalizeConfig(hostile), defaultConfig());
  assert.deepEqual(normalizeConfig(undefined), defaultConfig());
});

test("normalizeConfig : valeurs par défaut, types corrigés, entrées effacées retirées", () => {
  const raw = deepFreeze({
    v: 7,
    onboarded: "oui",
    demo: true,
    business: { name: "  Ma boîte ", baseCurrency: "eur", pivotDate: "2026-11-14", pivotLabel: " ", startDate: "2026-09-29", vat: 1, logo: "x" },
    partners: {
      rock: { id: "autre", name: " Rock ", role: "founder", sharePct: "40", userId: "u1", order: "2", joinedOn: "2026-09-29" },
      sam: { name: "", role: "boss", sharePct: -5, archived: true, joinedOn: "bientôt", order: null },
      gone: null,
      business: { name: "interdit" },
      unknown: { name: "interdit" },
    },
    accounts: {
      slash: { name: "Slash", kind: "bank", owner: "business", currency: "usd", cards: ["0562", 2487, "carte 99", "0562"], openingCents: "1500", order: 1 },
      perso: { name: "", kind: "satellite", owner: "rock", currency: "EURO", cards: "1111, 2222", openingCents: 12.6 },
      fantome: { name: "Fantôme", owner: "parti" },
      rien: { owner: null },
      efface: null,
    },
    categories: {
      ads_meta: { name: "Pub Facebook", kind: "income", group: "sales", archived: true, order: 3, system: false },
      sales_shopify: null,
      perso_cat: { name: "Cadeaux clients", kind: "expense", group: "people" },
      revenu_cat: { name: "Affiliation", kind: "income", group: "ads" },
      bizarre: { name: "", kind: "x", group: "sales" },
      uncategorized: { name: "interdit" },
    },
    rules: {
      r1: { contains: " Klaviyo ", categoryId: "email_sms" },
      r2: { contains: "", categoryId: "software" },
      r3: { contains: "canva", categoryId: "", accountId: 5, enabled: false, order: "3" },
      r4: null,
    },
    recurring: {
      k: { label: "Klaviyo", amountCents: "-4500", currency: "usd", categoryId: "email_sms", accountId: "slash", day: 45, start: "2026-10", end: "2026-13", active: false },
      vide: {},
    },
    fx: { eur: { default: "1.1", months: { "2026-10": 1.12, "2026-13": 2, "2026-11": 0, octobre: 1.5, "2026-09": "1,09" } }, USD: { default: 3 }, GBP: null, zz: { default: 2 }, chf: { default: 2 } },
    closed: { "2026-09": { at: "2026-10-02T08:00:00Z", by: "u1" }, "2026-10": null, "2026-08": true, "pas un mois": { at: "x" }, "2026-07": false },
    shareRules: {
      r1: { from: null, shares: { rock: 50, sam: "50" } },
      r2: { id: "zzz", from: "2026-11-14", shares: { rock: 40, sam: 40, inv: 20, neg: -1, nul: null, texte: "abc" } },
      r3: { from: "n'importe quand", shares: null },
      r4: null,
    },
    futur: { a: 1 },
    efface: null,
  });
  const c = normalizeConfig(raw);

  assert.equal(c.v, 1);
  assert.equal(c.onboarded, false); // seul le booléen true compte
  assert.equal(c.demo, true);
  assert.deepEqual(c.business, {
    name: "Ma boîte", baseCurrency: "EUR", pivotDate: "2026-11-14", pivotLabel: "Arrivée de l'investisseur",
    startDate: "2026-09-29", vat: false, logo: "x",
  });
  // champs inconnus conservés, valeurs effacées retirées
  assert.deepEqual(c.futur, { a: 1 });
  assert.ok(!("efface" in c));

  assert.deepEqual(Object.keys(c.partners).sort(), ["rock", "sam"]);
  assert.deepEqual(c.partners.rock, {
    id: "rock", name: "Rock", role: "founder", sharePct: 40, userId: "u1", order: 2, joinedOn: "2026-09-29", archived: false,
  });
  assert.deepEqual(c.partners.sam, {
    id: "sam", name: "Associé", role: "partner", sharePct: null, userId: null, order: 0, joinedOn: null, archived: true,
  });

  assert.deepEqual(Object.keys(c.accounts).sort(), ["fantome", "perso", "rien", "slash"]);
  assert.deepEqual(c.accounts.slash, {
    id: "slash", name: "Slash", kind: "bank", owner: "business", currency: "USD", cards: ["0562", "2487", "0099"],
    openingCents: 1500, order: 1, archived: false,
  });
  assert.deepEqual(c.accounts.perso, {
    id: "perso", name: "Compte", kind: "bank", owner: "rock", currency: "USD", cards: ["1111", "2222"],
    openingCents: 13, order: 0, archived: false,
  });
  // propriétaire inexistant ou absent : à attribuer
  assert.equal(c.accounts.fantome.owner, "unknown");
  assert.equal(c.accounts.rien.owner, "unknown");

  // catégorie d'origine : renommée, réordonnée, archivée, mais nature et groupe intacts
  assert.deepEqual(c.categories.ads_meta, {
    id: "ads_meta", name: "Pub Facebook", kind: "expense", group: "ads", system: true, order: 3, archived: true,
  });
  // une catégorie d'origine effacée dans le stockage revient
  assert.deepEqual(c.categories.sales_shopify, { ...DEFAULT_CATEGORIES.sales_shopify });
  assert.deepEqual(c.categories.perso_cat, {
    id: "perso_cat", name: "Cadeaux clients", kind: "expense", group: "people", system: false, order: 1000, archived: false,
  });
  // une catégorie d'encaissement va toujours dans le groupe Ventes, une dépense jamais
  assert.equal(c.categories.revenu_cat.kind, "income");
  assert.equal(c.categories.revenu_cat.group, "sales");
  assert.deepEqual([c.categories.bizarre.name, c.categories.bizarre.kind, c.categories.bizarre.group], ["Catégorie", "expense", "other"]);
  assert.ok(!("uncategorized" in c.categories));

  assert.deepEqual(Object.keys(c.rules).sort(), ["r1", "r3"]);
  assert.deepEqual(c.rules.r1, { id: "r1", contains: "Klaviyo", categoryId: "email_sms", accountId: null, order: 0, enabled: true });
  assert.deepEqual(c.rules.r3, { id: "r3", contains: "canva", categoryId: null, accountId: null, order: 3, enabled: false });

  assert.deepEqual(c.recurring.k, {
    id: "k", label: "Klaviyo", amountCents: -4500, currency: "USD", categoryId: "email_sms", accountId: "slash",
    day: 31, start: "2026-10", end: null, active: false,
  });
  assert.deepEqual(c.recurring.vide, {
    id: "vide", label: "Abonnement", amountCents: 0, currency: "USD", categoryId: null, accountId: null, day: 1, start: null, end: null, active: true,
  });

  // le dollar (devise pivot) et les codes mal formés sont écartés
  assert.deepEqual(c.fx, { EUR: { default: 1.1, months: { "2026-10": 1.12, "2026-09": 1.09 } }, CHF: { default: 2, months: {} } });
  assert.deepEqual(c.closed, { "2026-09": { at: "2026-10-02T08:00:00Z", by: "u1" }, "2026-08": { at: null, by: null } });

  assert.deepEqual(c.shareRules, {
    r1: { id: "r1", from: null, shares: { rock: 50, sam: 50 } },
    r2: { id: "r2", from: "2026-11-14", shares: { rock: 40, sam: 40, inv: 20 } },
    r3: { id: "r3", from: null, shares: {} },
  });
});

test("normalizeConfig : appliquée deux fois, elle donne le même résultat, et ne modifie pas son argument", () => {
  const raw = deepFreeze({
    business: { baseCurrency: "EUR", pivotDate: "2026-11-14" },
    partners: { a: { name: "A", sharePct: 33.333333 }, b: { name: "B" } },
    accounts: { x: { name: "X", owner: "a", cards: ["12"] }, y: { owner: "zzz" } },
    categories: { ads_meta: { name: "Meta" }, c1: { name: "Perso", kind: "income" } },
    fx: { EUR: { default: 1.1, months: { "2026-10": 1.12 } } },
    closed: { "2026-09": { at: "x", by: null } },
    shareRules: { r: { from: "2026-11-14", shares: { a: 60, b: 40 } } },
    rules: { r: { contains: "x", categoryId: "software" } },
    recurring: { r: { label: "x", amountCents: -100, day: 3 } },
  });
  const once = normalizeConfig(raw);
  const twice = normalizeConfig(once);
  assert.deepEqual(twice, once);
  assert.notEqual(twice, once);
  assert.equal(once.partners.a.sharePct, 33.3333);
  // la sortie est indépendante de l'entrée
  once.accounts.x.cards.push("9999");
  assert.deepEqual(raw.accounts.x.cards, ["12"]);
});

test("normalizeConfig accepte aussi des listes sous forme de tableau et protège les clés réservées", () => {
  const c = normalizeConfig({
    partners: [{ id: "p1", name: "Un" }, { name: "sans id" }, null],
    accounts: [{ id: "a1", name: "Compte un", owner: "p1" }],
  });
  assert.deepEqual(Object.keys(c.partners), ["p1"]);
  assert.equal(c.accounts.a1.owner, "p1");
  const parsed = JSON.parse('{"partners":{"__proto__":{"name":"x"},"ok":{"name":"Ok"}},"accounts":{"__proto__":{"owner":"ok"}}}');
  const safe = normalizeConfig(parsed);
  assert.deepEqual(Object.keys(safe.partners), ["ok"]);
  assert.deepEqual(Object.keys(safe.accounts), []);
  assert.equal(Object.getPrototypeOf(safe.partners), Object.prototype);
});

// ---------------------------------------------------------------------------------------------
// Opérations

test("normalizeOp : une dépense complète garde tous ses champs", () => {
  const raw = deepFreeze({
    id: "op_1", kind: "pl", date: "2026-11-21", label: " AppLovin, pub ", accountId: "slash", amountCents: -9477, currency: "usd",
    settledCents: -8791, categoryId: "ads_applovin", party: "Applovin Corporation", ref: "1182-9784", card: "0562", note: "ok",
    attachments: [{ id: "as_1", name: "recu.pdf", type: "application/pdf", size: 12345 }],
    source: "scan", extId: "stripe:1182-9784", needsReview: true, estimated: true, reconciled: true,
    bank: { date: "2026-11-22", label: "APPLOVIN" }, meta: { a: 1 }, demo: true,
    createdAt: "2026-11-21T10:00:00Z", createdBy: "u1", updatedAt: "2026-11-21T11:00:00Z", updatedBy: "u2",
  });
  assert.deepEqual(normalizeOp(raw), {
    id: "op_1", kind: "pl", date: "2026-11-21", label: "AppLovin, pub", accountId: "slash", amountCents: -9477, currency: "USD",
    settledCents: -8791, categoryId: "ads_applovin", party: "Applovin Corporation", ref: "1182-9784", card: "0562", note: "ok",
    attachments: [{ id: "as_1", name: "recu.pdf", type: "application/pdf", size: 12345 }],
    source: "scan", extId: "stripe:1182-9784", needsReview: true, estimated: true, reconciled: true,
    bank: { date: "2026-11-22", label: "APPLOVIN" }, meta: { a: 1 }, demo: true,
    createdAt: "2026-11-21T10:00:00Z", createdBy: "u1", updatedAt: "2026-11-21T11:00:00Z", updatedBy: "u2",
  });
});

test("normalizeOp : champs vides retirés, types corrigés, champs calculés jamais conservés, type deviné quand il manque", () => {
  const pl = normalizeOp({
    id: 42, date: "2026-10-05T08:30:00Z", amountCents: "-5000", currency: " eur ", label: null,
    accountId: "perso", categoryId: "", settledCents: 12.5, splits: [], party: "  ", ref: null, card: 562, note: undefined,
    attachments: [null, { name: "sans id" }, { id: "a1" }], needsReview: "true", estimated: false, reconciled: 1, demo: null,
    bank: "x", meta: [], createdBy: null, updatedAt: "", toAmountCents: 5,
    baseCents: 1, fxEstimated: true, month: "1999-01", lines: [1], effects: [2], accountEffects: [3], ownerId: "z", nature: "n", sharePeriod: 4,
    _selected: true, _dupOf: "op_9", futur: "gardé",
  });
  assert.deepEqual(pl, {
    id: "42", kind: "pl", date: "2026-10-05", label: "", amountCents: -5000, currency: "EUR",
    accountId: "perso", categoryId: null, card: "0562", attachments: [{ id: "a1", name: "", type: "", size: 0 }], futur: "gardé",
  });

  const transfer = normalizeOp({
    id: "t1", date: "2026-11-14", amountCents: 500000, currency: "EUR", fromAccountId: "a", toAccountId: "b", toAmountCents: 540000,
    accountId: "zzz", categoryId: "ads_meta", settledCents: -3, splits: [{ categoryId: "x", amountCents: 1 }],
  });
  assert.deepEqual(transfer, {
    id: "t1", kind: "transfer", date: "2026-11-14", label: "", amountCents: 500000, currency: "EUR",
    fromAccountId: "a", toAccountId: "b", toAmountCents: 540000,
  });
  assert.equal(isTransfer(transfer), true);
  assert.equal(isTransfer(pl), false);
  assert.equal(isTransfer(null), false);

  // montant reçu invalide : retiré ; comptes absents : l'opération reste lisible
  const loose = normalizeOp({ id: "t2", kind: "transfer", date: "2026-11-14", amountCents: 0, currency: "USD", toAmountCents: -4 });
  assert.deepEqual(loose, { id: "t2", kind: "transfer", date: "2026-11-14", label: "", amountCents: 0, currency: "USD" });
});

test("normalizeOp : la répartition est gardée entière ou pas du tout", () => {
  const base = { id: "o", kind: "pl", date: "2026-10-20", amountCents: 62000, currency: "USD", accountId: "a" };
  const ok = normalizeOp({
    ...base, categoryId: "sales_shopify",
    splits: [{ categoryId: "sales_shopify", amountCents: 70000 }, { categoryId: null, amountCents: "-5000" }, { amountCents: -3000, extra: 1 }],
  });
  assert.deepEqual(ok.splits, [
    { categoryId: "sales_shopify", amountCents: 70000 }, { categoryId: null, amountCents: -5000 }, { categoryId: null, amountCents: -3000 },
  ]);
  assert.equal(ok.categoryId, "sales_shopify");
  for (const bad of [[{ categoryId: "x", amountCents: 1.5 }], [null], "x", [{ categoryId: "x" }], [{ categoryId: "x", amountCents: 1 }, 7]]) {
    const op = normalizeOp({ ...base, splits: bad });
    assert.ok(op, "l'opération reste utilisable");
    assert.ok(!("splits" in op));
  }
});

test("normalizeOp : renvoie null pour ce qui est inutilisable, sans jamais lever d'exception", () => {
  const good = { id: "o", kind: "pl", date: "2026-10-20", amountCents: -100, currency: "USD" };
  assert.ok(normalizeOp(good));
  const bad = [
    undefined, null, 0, "x", [], [good], () => {},
    { ...good, id: "" }, { ...good, id: null }, { ...good, id: {} }, { ...good, id: "   " },
    { ...good, date: "2026-02-30" }, { ...good, date: "20/10/2026" }, { ...good, date: null }, { ...good, date: 20261020 },
    { ...good, amountCents: 12.5 }, { ...good, amountCents: "12,50" }, { ...good, amountCents: null }, { ...good, amountCents: NaN },
    { ...good, amountCents: Infinity }, { ...good, amountCents: 2 ** 60 }, { ...good, amountCents: "" },
    { ...good, currency: "" }, { ...good, currency: "DOLLAR" }, { ...good, currency: null }, { ...good, currency: 840 },
    { ...good, kind: "autre" }, { ...good, kind: 3 },
    { ...good, kind: "transfer", amountCents: -100 },
    new Proxy({}, { get() { throw new Error("piège"); } }),
    { get id() { throw new Error("piège"); } },
  ];
  for (const input of bad) {
    let out = "pas appelé";
    assert.doesNotThrow(() => { out = normalizeOp(input); });
    assert.equal(out, null);
  }
});

test("normalizeOp ne modifie pas son argument et renvoie un objet neuf", () => {
  const raw = deepFreeze({ id: "o", kind: "pl", date: "2026-10-20", amountCents: -100, currency: "usd", attachments: [{ id: "a" }], splits: [{ categoryId: "x", amountCents: -100 }] });
  const op = normalizeOp(raw);
  assert.notEqual(op, raw);
  assert.notEqual(op.attachments, raw.attachments);
  assert.notEqual(op.splits[0], raw.splits[0]);
  assert.equal(raw.currency, "usd");
  // une opération déjà normalisée ressort identique
  assert.deepEqual(normalizeOp(op), op);
});

// ---------------------------------------------------------------------------------------------
// Validation

const config = normalizeConfig({
  partners: { rock: { name: "Rock", order: 1 }, sam: { name: "Sam", order: 2 } },
  accounts: {
    slash: { name: "Slash", owner: "business", currency: "USD", cards: ["0562"], order: 1 },
    revolut: { name: "Revolut perso", owner: "rock", currency: "EUR", cards: ["2487"], order: 2 },
    vieux: { name: "Ancien compte", owner: "rock", currency: "EUR", cards: ["0562", "7777"], archived: true, order: 3 },
    mystere: { name: "Carte 9999", owner: "unknown", cards: ["9999"], order: 4 },
  },
  categories: { cadeaux: { name: "Cadeaux", kind: "expense", group: "other", order: 5 }, vieille: { name: "Vieille", archived: true } },
  closed: { "2026-09": { at: "2026-10-02T08:00:00Z", by: null }, "2026-10": { at: "2026-11-02T08:00:00Z", by: null } },
});

const expense = { kind: "pl", date: "2026-11-21", label: "Klaviyo", accountId: "slash", amountCents: -4500, currency: "USD", categoryId: "email_sms" };
const transfer = { kind: "transfer", date: "2026-11-14", label: "Apport", fromAccountId: "revolut", toAccountId: "slash", amountCents: 500000, currency: "EUR", toAmountCents: 540000 };

test("validateOp : une opération correcte ne pose aucun problème", () => {
  assert.deepEqual(validateOp(expense, config), []);
  assert.deepEqual(validateOp({ ...expense, id: "op_1", categoryId: null }, config), []);
  assert.deepEqual(validateOp({ ...expense, amountCents: 62000, categoryId: "sales_shopify" }, config), []);
  assert.deepEqual(validateOp(transfer, config), []);
  assert.deepEqual(validateOp({ ...transfer, toAmountCents: undefined }, config), []);
  // un compte ou une catégorie archivés restent utilisables
  assert.deepEqual(validateOp({ ...expense, accountId: "vieux", categoryId: "vieille" }, config), []);
  // un remboursement sur une catégorie de dépense est permis
  assert.deepEqual(validateOp({ ...expense, amountCents: 1200 }, config), []);
  const withSplits = {
    ...expense, amountCents: 62000, categoryId: "une catégorie ignorée",
    splits: [{ categoryId: "sales_shopify", amountCents: 70000 }, { categoryId: "refunds", amountCents: -5000 }, { categoryId: null, amountCents: -3000 }],
  };
  assert.deepEqual(validateOp(withSplits, config), []);
  assert.deepEqual(validateOp({ ...expense, currency: "EUR", settledCents: -4900 }, config), []);
});

test("validateOp : mois clôturé, à la création comme à la modification", () => {
  const closed = validateOp({ ...expense, date: "2026-10-31" }, config);
  assert.deepEqual(closed, ["Le mois d'octobre 2026 est clôturé : rouvre-le pour ajouter ou modifier une opération à cette date."]);
  const september = validateOp({ ...transfer, date: "2026-09-29" }, config);
  assert.deepEqual(september, ["Le mois de septembre 2026 est clôturé : rouvre-le pour ajouter ou modifier une opération à cette date."]);
  assert.deepEqual(validateOp({ ...expense, date: "2026-11-01" }, config), []);
  assert.deepEqual(validateOp({ ...expense, date: "2026-08-31" }, config), []);
  // déplacer une opération hors d'un mois clôturé est refusé aussi
  const moved = validateOp({ ...expense, date: "2026-11-02" }, config, { ...expense, date: "2026-10-28" });
  assert.deepEqual(moved, ["Cette opération appartient au mois d'octobre 2026, qui est clôturé : rouvre-le pour la modifier."]);
  // même mois clôturé avant et après : un seul message
  assert.equal(validateOp({ ...expense, date: "2026-10-02" }, config, { ...expense, date: "2026-10-28" }).length, 1);
  assert.deepEqual(validateOp({ ...expense, date: "2026-11-02" }, config, { ...expense, date: "2026-11-20" }), []);
  // un mois rouvert (null dans le stockage) n'est plus clôturé
  const reopened = normalizeConfig({ ...config, closed: { ...config.closed, "2026-10": null } });
  assert.deepEqual(validateOp({ ...expense, date: "2026-10-31" }, reopened), []);
});

test("validateOp : date, montant, devise", () => {
  assert.deepEqual(validateOp({ ...expense, date: "2026-13-01" }, config), ["La date est manquante ou invalide."]);
  assert.deepEqual(validateOp({ ...expense, date: undefined }, config), ["La date est manquante ou invalide."]);
  assert.deepEqual(validateOp({ ...expense, amountCents: 0 }, config), ["Le montant ne peut pas être zéro."]);
  assert.deepEqual(validateOp({ ...expense, amountCents: 45.5 }, config), ["Le montant est manquant ou invalide."]);
  assert.deepEqual(validateOp({ ...expense, amountCents: undefined }, config), ["Le montant est manquant ou invalide."]);
  assert.deepEqual(validateOp({ ...expense, currency: "" }, config), ["La devise est manquante ou invalide."]);
  assert.deepEqual(validateOp({ ...expense, kind: "autre" }, config).slice(0, 1), ["Le type d'opération est inconnu."]);
  assert.deepEqual(validateOp(null, config), ["Cette opération est illisible."]);
  assert.deepEqual(validateOp("x", config), ["Cette opération est illisible."]);
  // plusieurs problèmes à la fois
  const many = validateOp({ kind: "pl" }, config);
  assert.deepEqual(many, [
    "La date est manquante ou invalide.", "La devise est manquante ou invalide.", "Le montant est manquant ou invalide.", "Choisis le compte utilisé.",
  ]);
});

test("validateOp : compte et catégorie", () => {
  assert.deepEqual(validateOp({ ...expense, accountId: undefined }, config), ["Choisis le compte utilisé."]);
  assert.deepEqual(validateOp({ ...expense, accountId: "supprime" }, config), ["Le compte choisi n'existe plus."]);
  assert.deepEqual(validateOp({ ...expense, accountId: "constructor" }, config), ["Le compte choisi n'existe plus."]);
  assert.deepEqual(validateOp({ ...expense, categoryId: "supprimee" }, config), ["La catégorie choisie n'existe plus."]);
  assert.deepEqual(validateOp({ ...expense, categoryId: "toString" }, config), ["La catégorie choisie n'existe plus."]);
  assert.deepEqual(validateOp({ ...expense, settledCents: 4500 }, config), [
    "Le montant débité sur le compte doit être dans le même sens que le montant de l'opération.",
  ]);
  assert.deepEqual(validateOp({ ...expense, settledCents: 1.5 }, config), ["Le montant débité sur le compte est invalide."]);
});

test("validateOp : la répartition doit faire exactement le montant de l'opération", () => {
  const op = {
    ...expense, amountCents: 62000,
    splits: [{ categoryId: "sales_shopify", amountCents: 70000 }, { categoryId: "refunds", amountCents: -5000 }, { categoryId: "fees_payment", amountCents: -2000 }],
  };
  const problems = validateOp(op, config);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^La répartition par catégorie \(630,00\s\$\) ne correspond pas au montant de l'opération \(620,00\s\$\)\.$/);
  assert.deepEqual(validateOp({ ...op, splits: [] }, config), ["La répartition par catégorie est vide."]);
  assert.deepEqual(validateOp({ ...op, splits: "x" }, config), ["La répartition par catégorie est vide."]);
  assert.deepEqual(validateOp({ ...op, splits: [{ categoryId: "sales_shopify", amountCents: 62000.5 }] }, config), [
    "Une ligne de la répartition a un montant manquant ou invalide.",
  ]);
  assert.deepEqual(validateOp({ ...op, splits: [{ categoryId: "disparue", amountCents: 62000 }] }, config), [
    "Une catégorie de la répartition n'existe plus.",
  ]);
});

test("validateOp : mouvement entre comptes", () => {
  assert.deepEqual(validateOp({ ...transfer, toAccountId: "revolut" }, config), ["Le compte de départ et le compte d'arrivée doivent être différents."]);
  assert.deepEqual(validateOp({ ...transfer, fromAccountId: undefined }, config), ["Choisis le compte de départ."]);
  assert.deepEqual(validateOp({ ...transfer, toAccountId: "" }, config), ["Choisis le compte d'arrivée."]);
  assert.deepEqual(validateOp({ ...transfer, fromAccountId: "nulle part" }, config), ["Le compte de départ n'existe plus."]);
  assert.deepEqual(validateOp({ ...transfer, toAccountId: "nulle part" }, config), ["Le compte d'arrivée n'existe plus."]);
  assert.deepEqual(validateOp({ ...transfer, amountCents: -500000 }, config), ["Le montant d'un mouvement entre comptes doit être positif."]);
  assert.deepEqual(validateOp({ ...transfer, amountCents: 0 }, config), ["Le montant d'un mouvement entre comptes doit être positif."]);
  assert.deepEqual(validateOp({ ...transfer, toAmountCents: 0 }, config), ["Le montant reçu sur le compte d'arrivée doit être positif."]);
  assert.deepEqual(validateOp({ ...transfer, toAmountCents: -1 }, config), ["Le montant reçu sur le compte d'arrivée doit être positif."]);
});

test("validateOp tolère une configuration absente", () => {
  assert.deepEqual(validateOp(expense, null), ["Le compte choisi n'existe plus.", "La catégorie choisie n'existe plus."]);
  assert.deepEqual(validateOp(expense, undefined).length, 2);
});

// ---------------------------------------------------------------------------------------------
// Lectures simples

test("accountOwner : entreprise, associé, ou à attribuer", () => {
  assert.equal(accountOwner(config, "slash"), "business");
  assert.equal(accountOwner(config, "revolut"), "rock");
  assert.equal(accountOwner(config, "mystere"), "unknown");
  assert.equal(accountOwner(config, "absent"), "unknown");
  assert.equal(accountOwner(config, undefined), "unknown");
  assert.equal(accountOwner(config, "constructor"), "unknown");
  assert.equal(accountOwner(null, "slash"), "unknown");
  // configuration non normalisée dont le propriétaire a disparu
  assert.equal(accountOwner({ partners: {}, accounts: { x: { owner: "parti" } } }, "x"), "unknown");
  assert.equal(BUSINESS, "business");
  assert.equal(UNKNOWN, "unknown");
  assert.equal(UNCATEGORIZED, "uncategorized");
});

test("listes triées par ordre puis par nom, archivés masqués par défaut", () => {
  assert.deepEqual(listPartners(config).map((p) => p.id), ["rock", "sam"]);
  assert.deepEqual(listAccounts(config).map((a) => a.id), ["slash", "revolut", "mystere"]);
  assert.deepEqual(listAccounts(config, { includeArchived: true }).map((a) => a.id), ["slash", "revolut", "vieux", "mystere"]);
  assert.deepEqual(listAccounts(config, { owner: "rock" }).map((a) => a.id), ["revolut"]);
  assert.deepEqual(listAccounts(config, { owner: "rock", includeArchived: true }).map((a) => a.id), ["revolut", "vieux"]);
  assert.deepEqual(listAccounts(config, { owner: "business" }).map((a) => a.id), ["slash"]);
  assert.deepEqual(listAccounts(config, { owner: "unknown" }).map((a) => a.id), ["mystere"]);

  const cats = listCategories(config).map((c) => c.id);
  assert.equal(cats[0], "cadeaux"); // ordre 5, avant les catégories d'origine (10, 20...)
  assert.equal(cats[1], "sales_shopify");
  assert.ok(!cats.includes("vieille"));
  assert.ok(listCategories(config, { includeArchived: true }).map((c) => c.id).includes("vieille"));
  assert.deepEqual(listCategories(config, { kind: "income" }).map((c) => c.id), ["sales_shopify", "sales_other", "refunds", "other_income"]);
  assert.deepEqual(listCategories(config, { group: "ads" }).map((c) => c.id), ["ads_meta", "ads_tiktok", "ads_applovin", "ads_google", "ads_other"]);

  // même ordre : tri par nom (accents compris), puis par identifiant
  const same = normalizeConfig({ partners: { z: { name: "Zoé" }, e: { name: "Élise" }, a2: { name: "Alex" }, a1: { name: "Alex" } } });
  assert.deepEqual(listPartners(same).map((p) => p.id), ["a1", "a2", "e", "z"]);
  const archived = normalizeConfig({ partners: { a: { name: "A", archived: true }, b: { name: "B" } } });
  assert.deepEqual(listPartners(archived).map((p) => p.id), ["b"]);
  assert.deepEqual(listPartners(archived, { includeArchived: true }).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(listPartners(null), []);
  assert.deepEqual(listAccounts(undefined), []);
  assert.deepEqual(listCategories({}), []);
});

test("accountForCard : retrouve le compte par les 4 derniers chiffres, les comptes actifs d'abord", () => {
  assert.equal(accountForCard(config, "0562"), "slash"); // aussi sur un compte archivé : l'actif gagne
  assert.equal(accountForCard(config, "2487"), "revolut");
  assert.equal(accountForCard(config, "7777"), "vieux");
  assert.equal(accountForCard(config, "9999"), "mystere");
  assert.equal(accountForCard(config, "- 0562"), "slash");
  assert.equal(accountForCard(config, "**** **** **** 2487"), "revolut");
  assert.equal(accountForCard(config, 562), "slash");
  assert.equal(accountForCard(config, "0000"), null);
  assert.equal(accountForCard(config, ""), null);
  assert.equal(accountForCard(config, null), null);
  assert.equal(accountForCard(null, "0562"), null);
});

test("libellés sûrs, même quand l'entrée manque", () => {
  assert.equal(categoryLabel(config, "email_sms"), "Email et SMS (Klaviyo)");
  assert.equal(categoryLabel(config, "cadeaux"), "Cadeaux");
  assert.equal(categoryLabel(config, null), "Non classée");
  assert.equal(categoryLabel(config, undefined), "Non classée");
  assert.equal(categoryLabel(config, "uncategorized"), "Non classée");
  assert.equal(categoryLabel(config, "disparue"), "Catégorie supprimée");
  assert.equal(categoryLabel(config, "constructor"), "Catégorie supprimée");
  assert.equal(categoryLabel(null, "email_sms"), "Catégorie supprimée");

  assert.equal(accountLabel(config, "slash"), "Slash");
  assert.equal(accountLabel(config, "disparu"), "Compte supprimé");
  assert.equal(accountLabel(config, "toString"), "Compte supprimé");
  assert.equal(accountLabel(config, null), "Aucun compte");
  assert.equal(accountLabel(null, "slash"), "Compte supprimé");

  assert.equal(partnerLabel(config, "rock"), "Rock");
  assert.equal(partnerLabel(config, "business"), "L'entreprise");
  assert.equal(partnerLabel(config, "unknown"), "À attribuer");
  assert.equal(partnerLabel(config, null), "À attribuer");
  assert.equal(partnerLabel(config, "parti"), "Associé supprimé");
  assert.equal(partnerLabel(config, "hasOwnProperty"), "Associé supprimé");

  assert.equal(groupLabel("ads"), "Publicité");
  assert.equal(groupLabel("sales"), "Ventes");
  assert.equal(groupLabel("uncategorized"), "Non classé");
});

test("isMonthClosed", () => {
  assert.equal(isMonthClosed(config, "2026-09"), true);
  assert.equal(isMonthClosed(config, "2026-10"), true);
  assert.equal(isMonthClosed(config, "2026-11"), false);
  assert.equal(isMonthClosed(config, "constructor"), false);
  assert.equal(isMonthClosed(config, undefined), false);
  assert.equal(isMonthClosed(null, "2026-09"), false);
  assert.equal(isMonthClosed({}, "2026-09"), false);
  assert.equal(isMonthClosed({ closed: { "2026-09": null } }, "2026-09"), false);
});

// ---------------------------------------------------------------------------------------------
// Partage du bénéfice dans le temps

test("shareTimeline : le cas réel, deux associés à 50/50 puis trois à 40/40/20 à partir du 14 novembre 2026", () => {
  const c = normalizeConfig({
    business: { startDate: "2026-09-29" },
    partners: { f: { name: "Fondateur", order: 0 }, a: { name: "Associée", order: 1 }, i: { name: "Investisseur", order: 2, joinedOn: "2026-11-14" } },
    shareRules: {
      r2: { from: "2026-11-14", shares: { f: 40, a: 40, i: 20 } },
      r1: { from: null, shares: { f: 50, a: 50 } },
    },
  });
  assert.equal(c.partners.i.joinedOn, "2026-11-14");
  assert.deepEqual(listShareRules(c), [
    { id: "r1", from: null, shares: { f: 50, a: 50 } },
    { id: "r2", from: "2026-11-14", shares: { f: 40, a: 40, i: 20 } },
  ]);
  assert.deepEqual(shareTimeline(c), [
    { index: 0, ruleId: "r1", from: null, to: "2026-11-13", startsOn: "2026-09-29", shares: { f: 50, a: 50 }, sharesTotal: 100, equal: false, partnerCount: 2 },
    { index: 1, ruleId: "r2", from: "2026-11-14", to: null, startsOn: "2026-11-14", shares: { f: 40, a: 40, i: 20 }, sharesTotal: 100, equal: false, partnerCount: 3 },
  ]);
  // la règle en vigueur : la plus récente dont la date de début n'est pas après l'opération
  assert.equal(sharesOn(c, "2026-09-29").ruleId, "r1");
  assert.equal(sharesOn(c, "2026-11-13").ruleId, "r1");
  assert.equal(sharesOn(c, "2026-11-14").ruleId, "r2");
  assert.equal(sharesOn(c, "2027-03-01").ruleId, "r2");
  // avant le lancement : la première règle s'applique quand même
  assert.equal(sharesOn(c, "2026-08-01").ruleId, "r1");
  assert.equal(sharesOn(c, undefined).ruleId, "r1");
});

test("shareTimeline : la première règle couvre aussi ce qui la précède, même si elle a une date", () => {
  const c = normalizeConfig({
    partners: { f: { name: "F" }, a: { name: "A" } },
    shareRules: { r1: { from: "2026-09-29", shares: { f: 50, a: 50 } }, r2: { from: "2026-11-14", shares: { f: 70, a: 30 } }, r3: { from: "2027-01-01", shares: { f: 100 } } },
  });
  const t = shareTimeline(c);
  assert.deepEqual(t.map((p) => [p.ruleId, p.from, p.to, p.startsOn, p.partnerCount]), [
    ["r1", null, "2026-11-13", "2026-09-29", 2],
    ["r2", "2026-11-14", "2026-12-31", "2026-11-14", 2],
    ["r3", "2027-01-01", null, "2027-01-01", 1],
  ]);
  assert.equal(sharesOn(c, "2026-01-01").ruleId, "r1");
  assert.equal(sharesOn(c, "2026-12-31").ruleId, "r2");
  assert.equal(sharesOn(c, "2027-01-01").ruleId, "r3");
});

test("shareTimeline : deux règles à la même date, la plus récente (identifiant le plus grand) remplace l'autre", () => {
  const c = normalizeConfig({
    shareRules: {
      sr_b: { from: "2026-11-14", shares: { f: 60, a: 40 } },
      sr_a: { from: "2026-11-14", shares: { f: 10, a: 90 } },
      sr_0: { from: null, shares: { f: 50, a: 50 } },
      sr_1: { from: null, shares: { f: 55, a: 45 } },
    },
  });
  const t = shareTimeline(c);
  assert.deepEqual(t.map((p) => [p.ruleId, p.from, p.to]), [["sr_1", null, "2026-11-13"], ["sr_b", "2026-11-14", null]]);
});

test("shareTimeline sans règle : parts sharePct des associés actifs, sinon parts égales", () => {
  // 1. sharePct renseigné
  const withPct = normalizeConfig({
    business: { startDate: "2026-09-29" },
    partners: { f: { name: "F", sharePct: 60, order: 0 }, a: { name: "A", sharePct: 30, order: 1 }, x: { name: "X", order: 2 }, old: { name: "Ancien", sharePct: 10, archived: true } },
  });
  assert.deepEqual(shareTimeline(withPct), [
    { index: 0, ruleId: null, from: null, to: null, startsOn: "2026-09-29", shares: { f: 60, a: 30, x: 0 }, sharesTotal: 90, equal: false, partnerCount: 2 },
  ]);
  // 2. aucune part renseignée : parts égales entre associés actifs
  const equal = normalizeConfig({ partners: { f: { name: "F", order: 0 }, a: { name: "A", order: 1 }, i: { name: "I", order: 2 }, old: { name: "Ancien", archived: true } } });
  const t = shareTimeline(equal);
  assert.equal(t.length, 1);
  assert.deepEqual(Object.keys(t[0].shares), ["f", "a", "i"]);
  for (const id of ["f", "a", "i"]) assert.ok(Math.abs(t[0].shares[id] - 100 / 3) < 1e-9);
  assert.equal(t[0].sharesTotal, 100);
  assert.equal(t[0].equal, true);
  assert.equal(t[0].partnerCount, 3);
  assert.equal(t[0].startsOn, null);
  // 3. des parts toutes à zéro comptent comme non renseignées
  const zeros = normalizeConfig({ partners: { f: { name: "F", sharePct: 0 }, a: { name: "A", sharePct: 0 } } });
  assert.deepEqual(shareTimeline(zeros)[0].shares, { a: 50, f: 50 });
  assert.equal(shareTimeline(zeros)[0].equal, true);
  // 4. aucun associé
  assert.deepEqual(shareTimeline(defaultConfig()), [
    { index: 0, ruleId: null, from: null, to: null, startsOn: null, shares: {}, sharesTotal: 0, equal: false, partnerCount: 0 },
  ]);
  assert.deepEqual(shareTimeline(null).length, 1);
  assert.equal(sharesOn(defaultConfig(), "2026-11-21").ruleId, null);
});

test("shareTimeline : parts décimales lues au dix-millième, total arrondi", () => {
  const c = normalizeConfig({ shareRules: { r: { from: null, shares: { a: 33.33, b: 33.33, c: 33.34 } } } });
  assert.equal(shareTimeline(c)[0].sharesTotal, 100);
  const off = normalizeConfig({ shareRules: { r: { from: null, shares: { a: 33.333333, b: 33.333333, c: 33.333333 } } } });
  assert.deepEqual(shareTimeline(off)[0].shares, { a: 33.3333, b: 33.3333, c: 33.3333 });
  assert.equal(shareTimeline(off)[0].sharesTotal, 99.9999);
});
