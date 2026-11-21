import { test } from "node:test";
import assert from "node:assert/strict";
import { PERIOD_PRESETS, DEFAULT_PERIOD, SHARE_PERIOD_PREFIX, listPeriods, resolvePeriod, previousPeriod } from "../../src/core/periods.js";
import { normalizeConfig, defaultConfig } from "../../src/core/model.js";
import { todayISO, monthOf, monthStart, monthEnd } from "../../src/core/dates.js";

const TODAY = "2026-11-21";
const plain = defaultConfig();

// Le cas réel : lancement le 29 septembre 2026, deux associés à 50/50, un troisième arrive le 14 novembre (40/40/20).
const owner = normalizeConfig({
  business: { startDate: "2026-09-29", pivotDate: "2026-11-14", pivotLabel: "Arrivée de l'investisseur" },
  partners: { f: { name: "Fondateur", order: 0 }, a: { name: "Associée", order: 1 }, i: { name: "Investisseur", order: 2 } },
  shareRules: { r1: { from: null, shares: { f: 50, a: 50 } }, r2: { from: "2026-11-14", shares: { f: 40, a: 40, i: 20 } } },
});

test("préréglages fixes : identifiants et libellés", () => {
  assert.deepEqual(PERIOD_PRESETS.map((p) => p.id), ["this_month", "last_month", "last_30", "last_90", "this_year", "all", "custom"]);
  for (const p of PERIOD_PRESETS) assert.ok(p.label.length > 3);
  assert.equal(DEFAULT_PERIOD, "all");
  assert.equal(SHARE_PERIOD_PREFIX, "share:");
});

test("resolvePeriod : chaque préréglage fixe, bornes incluses", () => {
  assert.deepEqual(resolvePeriod("this_month", plain, TODAY), { id: "this_month", from: "2026-11-01", to: "2026-11-30", label: "Ce mois-ci" });
  assert.deepEqual(resolvePeriod("last_month", plain, TODAY), { id: "last_month", from: "2026-10-01", to: "2026-10-31", label: "Le mois dernier" });
  // 30 jours en comptant aujourd'hui : du 23 octobre au 21 novembre
  assert.deepEqual(resolvePeriod("last_30", plain, TODAY), { id: "last_30", from: "2026-10-23", to: "2026-11-21", label: "30 derniers jours" });
  // 90 jours en comptant aujourd'hui : 21 jours en novembre, 31 en octobre, 30 en septembre, 8 en août (du 24 au 31)
  assert.deepEqual(resolvePeriod("last_90", plain, TODAY), { id: "last_90", from: "2026-08-24", to: "2026-11-21", label: "90 derniers jours" });
  assert.deepEqual(resolvePeriod("this_year", plain, TODAY), { id: "this_year", from: "2026-01-01", to: "2026-12-31", label: "Cette année" });
  assert.deepEqual(resolvePeriod("all", plain, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
});

test("resolvePeriod : passages d'année et février", () => {
  assert.deepEqual(resolvePeriod("last_month", plain, "2027-01-15"), { id: "last_month", from: "2026-12-01", to: "2026-12-31", label: "Le mois dernier" });
  assert.deepEqual(resolvePeriod("this_month", plain, "2028-02-10"), { id: "this_month", from: "2028-02-01", to: "2028-02-29", label: "Ce mois-ci" });
  assert.deepEqual(resolvePeriod("this_month", plain, "2027-02-10"), { id: "this_month", from: "2027-02-01", to: "2027-02-28", label: "Ce mois-ci" });
  assert.deepEqual(resolvePeriod("last_30", plain, "2027-01-10"), { id: "last_30", from: "2026-12-12", to: "2027-01-10", label: "30 derniers jours" });
  assert.deepEqual(resolvePeriod("last_month", plain, "2026-03-31"), { id: "last_month", from: "2026-02-01", to: "2026-02-28", label: "Le mois dernier" });
});

test("resolvePeriod : période personnalisée", () => {
  assert.deepEqual(resolvePeriod("custom", plain, TODAY, { from: "2026-10-01", to: "2026-11-15" }), {
    id: "custom", from: "2026-10-01", to: "2026-11-15", label: "Du 1er oct. au 15 nov.",
  });
  // bornes inversées : remises dans l'ordre
  assert.deepEqual(resolvePeriod("custom", plain, TODAY, { from: "2026-11-15", to: "2026-10-02" }), {
    id: "custom", from: "2026-10-02", to: "2026-11-15", label: "Du 2 oct. au 15 nov.",
  });
  assert.deepEqual(resolvePeriod("custom", plain, TODAY, { from: "2026-10-01", to: null }), {
    id: "custom", from: "2026-10-01", to: null, label: "Depuis le 1er oct.",
  });
  assert.deepEqual(resolvePeriod("custom", plain, TODAY, { to: "2026-10-31" }), {
    id: "custom", from: null, to: "2026-10-31", label: "Jusqu'au 31 oct.",
  });
  // l'année apparaît dès qu'une date n'est pas dans l'année en cours
  assert.deepEqual(resolvePeriod("custom", plain, TODAY, { from: "2025-12-15", to: "2026-01-15" }), {
    id: "custom", from: "2025-12-15", to: "2026-01-15", label: "Du 15 déc. 2025 au 15 janv. 2026",
  });
  // bornes absentes ou invalides
  for (const custom of [undefined, null, {}, { from: "hier", to: 5 }, { from: "2026-02-30" }, "x"]) {
    assert.deepEqual(resolvePeriod("custom", plain, TODAY, custom), { id: "custom", from: null, to: null, label: "Période personnalisée" });
  }
});

test("resolvePeriod : avant et depuis la date pivot", () => {
  const config = normalizeConfig({ business: { pivotDate: "2026-11-14", pivotLabel: "Arrivée de l'investisseur" } });
  assert.deepEqual(resolvePeriod("before_pivot", config, TODAY), {
    id: "before_pivot", from: null, to: "2026-11-13", label: "Avant le 14 nov. (arrivée de l'investisseur)",
  });
  assert.deepEqual(resolvePeriod("since_pivot", config, TODAY), {
    id: "since_pivot", from: "2026-11-14", to: null, label: "Depuis le 14 nov. (arrivée de l'investisseur)",
  });
  // pivot au premier du mois, libellé personnalisé, autre année
  const other = normalizeConfig({ business: { pivotDate: "2027-03-01", pivotLabel: "LLC créée" } });
  assert.deepEqual(resolvePeriod("before_pivot", other, TODAY), { id: "before_pivot", from: null, to: "2027-02-28", label: "Avant le 1er mars 2027 (LLC créée)" });
  assert.deepEqual(resolvePeriod("since_pivot", other, TODAY), { id: "since_pivot", from: "2027-03-01", to: null, label: "Depuis le 1er mars 2027 (LLC créée)" });
  // sans date pivot, ces identifiants retombent sur "all"
  assert.deepEqual(resolvePeriod("before_pivot", plain, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
  assert.deepEqual(resolvePeriod("since_pivot", plain, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
});

test("resolvePeriod : une période par règle de partage du bénéfice (cas réel)", () => {
  assert.deepEqual(resolvePeriod("share:r1", owner, TODAY), {
    id: "share:r1", from: null, to: "2026-11-13", label: "À 2 associés (du 29 sept. au 13 nov.)",
  });
  assert.deepEqual(resolvePeriod("share:r2", owner, TODAY), {
    id: "share:r2", from: "2026-11-14", to: null, label: "À 3 associés (depuis le 14 nov.)",
  });
  // l'année suivante, les dates portent leur année
  assert.equal(resolvePeriod("share:r1", owner, "2027-02-01").label, "À 2 associés (du 29 sept. 2026 au 13 nov. 2026)");
  assert.equal(resolvePeriod("share:r2", owner, "2027-02-01").label, "À 3 associés (depuis le 14 nov. 2026)");
  // règle supprimée : on retombe sur "all"
  assert.deepEqual(resolvePeriod("share:disparue", owner, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
  assert.deepEqual(resolvePeriod("share:", owner, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
  assert.deepEqual(resolvePeriod("share:null", plain, TODAY), { id: "all", from: null, to: null, label: "Depuis le début" });
});

test("libellés des périodes de partage : sans date de lancement, un seul associé, parts absentes", () => {
  const config = normalizeConfig({
    shareRules: {
      a: { from: null, shares: { f: 100 } },
      b: { from: "2026-10-01", shares: { f: 50, a: 50, i: 0 } },
      c: { from: "2026-11-01", shares: {} },
    },
  });
  assert.equal(resolvePeriod("share:a", config, TODAY).label, "À 1 associé (jusqu'au 30 sept.)");
  assert.deepEqual(resolvePeriod("share:b", config, TODAY), { id: "share:b", from: "2026-10-01", to: "2026-10-31", label: "À 2 associés (du 1er oct. au 31 oct.)" });
  assert.equal(resolvePeriod("share:c", config, TODAY).label, "Sans partage défini (depuis le 1er nov.)");
  // une seule règle : elle couvre tout, l'identifiant reste valable mais n'est pas proposé dans la liste
  const single = normalizeConfig({ business: { startDate: "2026-09-29" }, shareRules: { only: { from: null, shares: { f: 50, a: 50 } } } });
  assert.deepEqual(resolvePeriod("share:only", single, TODAY), { id: "share:only", from: null, to: null, label: "À 2 associés (depuis le 29 sept.)" });
  assert.ok(!listPeriods(single, TODAY).some((p) => p.id.startsWith("share:")));
  const bare = normalizeConfig({ shareRules: { only: { from: null, shares: { f: 50, a: 50 } } } });
  assert.equal(resolvePeriod("share:only", bare, TODAY).label, "À 2 associés (depuis le début)");
});

test("listPeriods : fixes, puis périodes de partage, puis pivot, puis personnalisée", () => {
  assert.deepEqual(listPeriods(plain, TODAY).map((p) => p.id), ["this_month", "last_month", "last_30", "last_90", "this_year", "all", "custom"]);

  // cas réel : la date pivot est la même que la deuxième règle, les périodes "pivot" feraient doublon et sont retirées
  const list = listPeriods(owner, TODAY);
  assert.deepEqual(list.map((p) => p.id), ["this_month", "last_month", "last_30", "last_90", "this_year", "all", "share:r1", "share:r2", "custom"]);
  assert.deepEqual(list.filter((p) => p.kind === "share"), [
    { id: "share:r1", kind: "share", from: null, to: "2026-11-13", label: "À 2 associés (du 29 sept. au 13 nov.)" },
    { id: "share:r2", kind: "share", from: "2026-11-14", to: null, label: "À 3 associés (depuis le 14 nov.)" },
  ]);
  assert.deepEqual(list.map((p) => p.kind), ["preset", "preset", "preset", "preset", "preset", "preset", "share", "share", "custom"]);

  // pivot à une autre date que les règles : les deux familles sont proposées
  const both = normalizeConfig({ ...owner, business: { ...owner.business, pivotDate: "2026-10-15" } });
  assert.deepEqual(listPeriods(both, TODAY).map((p) => p.id), [
    "this_month", "last_month", "last_30", "last_90", "this_year", "all", "share:r1", "share:r2", "before_pivot", "since_pivot", "custom",
  ]);

  // pivot seul
  const pivotOnly = normalizeConfig({ business: { pivotDate: "2026-11-14" } });
  assert.deepEqual(listPeriods(pivotOnly, TODAY).slice(6).map((p) => [p.id, p.kind, p.from, p.to]), [
    ["before_pivot", "pivot", null, "2026-11-13"], ["since_pivot", "pivot", "2026-11-14", null], ["custom", "custom", null, null],
  ]);

  // la période personnalisée reprend les bornes données
  const custom = listPeriods(plain, TODAY, { from: "2026-10-01", to: "2026-10-15" }).find((p) => p.id === "custom");
  assert.deepEqual(custom, { id: "custom", kind: "custom", from: "2026-10-01", to: "2026-10-15", label: "Du 1er oct. au 15 oct." });
});

test("chaque période listée se résout à l'identique", () => {
  for (const config of [plain, owner]) {
    for (const p of listPeriods(config, TODAY, { from: "2026-10-01", to: "2026-10-15" })) {
      assert.deepEqual(resolvePeriod(p.id, config, TODAY, { from: "2026-10-01", to: "2026-10-15" }), { id: p.id, from: p.from, to: p.to, label: p.label });
    }
  }
});

test("resolvePeriod : identifiant inconnu ou absent, configuration absente, date du jour absente", () => {
  const all = { id: "all", from: null, to: null, label: "Depuis le début" };
  for (const id of [undefined, null, "", "n'existe pas", 42, {}, "constructor", "toString"]) {
    assert.deepEqual(resolvePeriod(id, plain, TODAY), all);
  }
  assert.deepEqual(resolvePeriod("all", null, TODAY), all);
  assert.deepEqual(resolvePeriod("since_pivot", undefined, TODAY), all);
  assert.deepEqual(resolvePeriod("share:x", null, TODAY), all);
  // sans date du jour (ou invalide) : la vraie date du jour
  const month = monthOf(todayISO());
  for (const today of [undefined, null, "", "21/11/2026", "2026-02-30"]) {
    assert.deepEqual(resolvePeriod("this_month", plain, today), { id: "this_month", from: monthStart(month), to: monthEnd(month), label: "Ce mois-ci" });
  }
});

test("previousPeriod : même durée juste avant, mois et année entiers reconnus", () => {
  // mois entier : le mois précédent en entier (même s'il n'a pas le même nombre de jours)
  assert.deepEqual(previousPeriod({ from: "2026-11-01", to: "2026-11-30" }), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(previousPeriod({ from: "2026-03-01", to: "2026-03-31" }), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(previousPeriod({ from: "2026-01-01", to: "2026-01-31" }), { from: "2025-12-01", to: "2025-12-31" });
  // année entière
  assert.deepEqual(previousPeriod({ from: "2026-01-01", to: "2026-12-31" }), { from: "2025-01-01", to: "2025-12-31" });
  // 30 derniers jours : les 30 jours d'avant (du 23 septembre au 22 octobre)
  assert.deepEqual(previousPeriod({ from: "2026-10-23", to: "2026-11-21" }), { from: "2026-09-23", to: "2026-10-22" });
  // un seul jour
  assert.deepEqual(previousPeriod({ from: "2026-11-21", to: "2026-11-21" }), { from: "2026-11-20", to: "2026-11-20" });
  // sans les deux bornes : pas de comparaison possible
  for (const p of [null, undefined, {}, { from: "2026-01-01", to: null }, { from: null, to: "2026-01-01" }, { from: "2026-02-01", to: "2026-01-01" }, { from: "x", to: "y" }]) {
    assert.equal(previousPeriod(p), null);
  }
  assert.deepEqual(previousPeriod(resolvePeriod("last_month", plain, TODAY)), { from: "2026-09-01", to: "2026-09-30" });
});
