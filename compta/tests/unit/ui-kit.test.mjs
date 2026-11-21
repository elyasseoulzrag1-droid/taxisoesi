// Logique pure du kit d'interface : champ de montant, filtre de fichiers, tons et couleurs, tableau empilé, hôtes.
import test from "node:test";
import assert from "node:assert/strict";
import { centsToText, currencyInText, currencySymbol, shownCents, textToCents } from "../../src/ui/money-input.js";
import { matchesAccept, splitByAccept } from "../../src/ui/accept.js";
import { TONE_ICON, markColor, normTone, seriesColor, seriesInk } from "../../src/ui/tone.js";
import { phoneSlots } from "../../src/ui/table-slots.js";
import { createHostStore } from "../../src/ui/host.js";
import { clamp, cx } from "../../src/ui/util.js";

test("champ de montant : une dépense se tape en positif et se stocke en négatif", () => {
  assert.equal(textToCents("12,50", "out"), -1250);
  assert.equal(textToCents("12.5", "out"), -1250);
  assert.equal(textToCents("1 234,56", "out"), -123456);
  assert.equal(textToCents("$94.77", "out"), -9477);
  assert.equal(textToCents("-12,50", "out"), 1250, "une dépense négative est un remboursement");
  assert.equal(centsToText(-1250, "out"), "12,50");
  assert.equal(centsToText(1250, "out"), "-12,50");
  assert.equal(shownCents(-1250, "out"), 1250);
});

test("champ de montant : un encaissement et un montant libre gardent le signe saisi", () => {
  assert.equal(textToCents("12,50", "in"), 1250);
  assert.equal(textToCents("-12,50", "in"), -1250);
  assert.equal(textToCents("12,50", null), 1250);
  assert.equal(textToCents("(12,50)", null), -1250);
  assert.equal(centsToText(1250, "in"), "12,50");
  assert.equal(centsToText(-1250, null), "-12,50");
  assert.equal(shownCents(1250, "in"), 1250);
});

test("champ de montant : toujours des centimes entiers, jamais de zéro négatif, null si illisible", () => {
  for (const sign of ["out", "in", null]) {
    assert.equal(textToCents("", sign), null);
    assert.equal(textToCents("abc", sign), null);
    assert.equal(textToCents("   ", sign), null);
    assert.ok(Object.is(textToCents("0", sign), 0), "zéro positif en mode " + sign);
    assert.ok(Object.is(textToCents("0,00", sign), 0));
    assert.ok(Object.is(shownCents(0, sign), 0));
    assert.ok(Object.is(shownCents(-0, sign), 0));
    for (const text of ["0,1", "0,29", "19,99", "1234567,89", "0,005", "12,", ",5"]) {
      const cents = textToCents(text, sign);
      assert.ok(Number.isInteger(cents), `${text} en mode ${sign} donne un entier`);
    }
  }
  assert.equal(centsToText(null, "out"), "");
  assert.equal(centsToText(undefined, null), "");
  assert.equal(centsToText(NaN, "in"), "");
  assert.equal(shownCents(null, "out"), null);
});

test("champ de montant : aller-retour texte, centimes, texte", () => {
  for (const sign of ["out", "in", null]) {
    for (const cents of [0, 1, -1, 99, -9477, 123456, -150000000]) {
      assert.equal(textToCents(centsToText(cents, sign), sign), cents, `${cents} en mode ${sign}`);
    }
  }
});

test("champ de montant : devise repérée dans la saisie", () => {
  assert.equal(currencyInText("12 €"), "EUR");
  assert.equal(currencyInText("$12"), "USD");
  assert.equal(currencyInText("12 usd"), "USD");
  assert.equal(currencyInText("12,50"), null);
  assert.equal(currencyInText(""), null);
  assert.equal(currencySymbol("USD"), "$");
  assert.equal(currencySymbol("EUR"), "€");
  assert.equal(currencySymbol("XYZ"), "XYZ");
  assert.equal(currencySymbol(undefined), "");
});

test("matchesAccept : extensions, types exacts et familles de types", () => {
  const pdf = { name: "Recu AppLovin.PDF", type: "application/pdf" };
  const photo = { name: "IMG_0042.jpeg", type: "image/jpeg" };
  const csv = { name: "revolut-2026-11.csv", type: "" };
  const heic = { name: "IMG_0043.HEIC", type: "image/heic" };
  assert.ok(matchesAccept(pdf, "image/*,application/pdf"));
  assert.ok(matchesAccept(photo, "image/*,application/pdf"));
  assert.ok(!matchesAccept(csv, "image/*,application/pdf"));
  assert.ok(matchesAccept(csv, ".csv,.tsv,.txt"));
  assert.ok(matchesAccept(pdf, ".pdf"), "extension insensible à la casse");
  assert.ok(!matchesAccept(photo, ".csv, .txt"));
  assert.ok(matchesAccept(heic, "image/*"));
  assert.ok(!matchesAccept(heic, "image/png,image/jpeg,application/pdf"));
  assert.ok(matchesAccept(csv, ""), "sans filtre tout passe");
  assert.ok(matchesAccept(csv, undefined));
  assert.ok(matchesAccept(csv, " , "));
  assert.ok(!matchesAccept({}, ".csv"));
  assert.ok(!matchesAccept(null, "image/*"));
  const split = splitByAccept([pdf, photo, csv], "image/*,application/pdf");
  assert.deepEqual(split.accepted, [pdf, photo]);
  assert.deepEqual(split.rejected, [csv]);
  assert.deepEqual(splitByAccept(null, ".csv"), { accepted: [], rejected: [] });
});

test("normTone : six tons, des alias, un repli", () => {
  for (const tone of ["neutral", "accent", "in", "out", "warn", "info"]) {
    assert.equal(normTone(tone), tone);
    assert.equal(typeof TONE_ICON[tone], "string");
  }
  assert.equal(normTone("success"), "in");
  assert.equal(normTone("error"), "out");
  assert.equal(normTone("danger"), "out");
  assert.equal(normTone("warning"), "warn");
  assert.equal(normTone("primary"), "accent");
  assert.equal(normTone("rose"), "neutral");
  assert.equal(normTone(undefined), "neutral");
  assert.equal(normTone("rose", "info"), "info");
});

test("seriesColor : ordre fixe, jamais recyclé au-delà de 8", () => {
  assert.equal(seriesColor(0), "var(--chart-1)");
  assert.equal(seriesColor(7), "var(--chart-8)");
  assert.equal(seriesColor(8), "var(--chart-muted)");
  assert.equal(seriesColor(-1), "var(--chart-muted)");
  assert.equal(seriesColor(undefined), "var(--chart-muted)");
  assert.equal(seriesColor("2"), "var(--chart-3)");
  assert.equal(seriesInk(3), "var(--chart-4-ink)");
  assert.equal(seriesInk(12), "var(--on-fill)");
  const all = new Set(Array.from({ length: 8 }, (_, i) => seriesColor(i)));
  assert.equal(all.size, 8);
});

test("markColor : couleur explicite, puis ton, puis rang de la série", () => {
  assert.deepEqual(markColor({ color: "var(--chart-5)" }, 2), { fill: "var(--chart-5)", ink: "var(--on-fill)" });
  assert.equal(markColor({ tone: "in" }, 2).fill, "var(--chart-in)");
  assert.equal(markColor({ tone: "out" }).fill, "var(--chart-out)");
  assert.equal(markColor({ tone: "error" }).fill, "var(--chart-out)", "les alias de ton passent aussi");
  assert.equal(markColor({ tone: "warn" }).ink, "var(--on-fill-dark)");
  assert.deepEqual(markColor({}, 1), { fill: "var(--chart-2)", ink: "var(--chart-2-ink)" });
  assert.deepEqual(markColor(undefined, 0), { fill: "var(--chart-1)", ink: "var(--chart-1-ink)" });
  assert.equal(markColor({}, 9).fill, "var(--chart-muted)");
});

test("phoneSlots : placement par défaut des colonnes sur téléphone", () => {
  const columns = [
    { key: "label" },
    { key: "date" },
    { key: "category" },
    { key: "base", align: "right" },
    { key: "amount", align: "right" },
  ];
  const slots = phoneSlots(columns);
  assert.equal(slots.title.key, "label");
  assert.equal(slots.amount.key, "amount", "la dernière colonne alignée à droite est le montant");
  assert.deepEqual(slots.sub.map((c) => c.key), ["date", "category", "base"]);
  assert.deepEqual(slots.aside, []);
});

test("phoneSlots : placement explicite, colonnes masquées, cas limites", () => {
  const columns = [
    { key: "date", phone: "sub" },
    { key: "label", phone: "title" },
    { key: "state", phone: "aside" },
    { key: "internal", phone: "hide" },
    { key: "cents", align: "right", phone: "amount" },
    { key: "note" },
  ];
  const slots = phoneSlots(columns);
  assert.equal(slots.title.key, "label");
  assert.equal(slots.amount.key, "cents");
  assert.deepEqual(slots.sub.map((c) => c.key), ["date", "note"]);
  assert.deepEqual(slots.aside.map((c) => c.key), ["state"]);
  const numbersOnly = phoneSlots([{ key: "a", align: "right" }, { key: "b", align: "right" }]);
  assert.equal(numbersOnly.title.key, "a");
  assert.equal(numbersOnly.amount.key, "b");
  const one = phoneSlots([{ key: "only" }]);
  assert.equal(one.title.key, "only");
  assert.equal(one.amount, null);
  assert.deepEqual(phoneSlots([]), { title: null, amount: null, sub: [], aside: [] });
  assert.deepEqual(phoneSlots(undefined), { title: null, amount: null, sub: [], aside: [] });
  const every = phoneSlots(columns);
  const placed = [every.title, every.amount, ...every.sub, ...every.aside].map((c) => c.key).sort();
  assert.deepEqual(placed, ["cents", "date", "label", "note", "state"], "chaque colonne visible est placée une seule fois");
});

test("createHostStore : un seul hôte affiche les éléments, les abonnés sont prévenus", () => {
  const store = createHostStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.set([{ id: 1 }]);
  assert.equal(calls, 1);
  assert.deepEqual(store.get(), [{ id: 1 }]);
  const leaveA = store.register("a");
  const leaveB = store.register("b");
  assert.ok(store.isPrimary("a"));
  assert.ok(!store.isPrimary("b"));
  leaveA();
  assert.ok(store.isPrimary("b"), "le suivant prend le relais");
  leaveB();
  assert.ok(!store.isPrimary("b"));
  const before = calls;
  off();
  store.set([]);
  assert.equal(calls, before, "plus de notification après désabonnement");
  assert.doesNotThrow(() => store.ensureHost(() => null), "sans document, ne fait rien");
});

test("cx et clamp", () => {
  assert.equal(cx("btn", false, null, undefined, "", "is-on"), "btn is-on");
  assert.equal(cx(), "");
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
