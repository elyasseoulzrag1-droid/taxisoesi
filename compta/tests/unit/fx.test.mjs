import { test } from "node:test";
import assert from "node:assert/strict";
import { PIVOT, DEFAULT_RATES, rateToPivot, convert, createFx } from "../../src/core/fx.js";

// Table de secours factice : les tests ne dépendent pas des vrais taux, qui sont mis à jour par ailleurs.
const BUILTIN = {
  EUR: { default: 1.5, months: { "2026-03": 1.3, "2026-06": 1.4 } },
  GBP: { default: 2, months: {} },
};

test("la devise pivot est le dollar et vaut toujours 1", () => {
  assert.equal(PIVOT, "USD");
  assert.equal(rateToPivot({ fx: { USD: { default: 3, months: { "2026-10": 4 } } } }, "USD", "2026-10", BUILTIN), 1);
  assert.equal(rateToPivot(null, "usd", "2026-10"), 1);
});

test("ordre de repli des taux saisis : mois, mois précédent le plus proche, mois suivant le plus proche, défaut", () => {
  const config = { fx: { EUR: { default: 1.01, months: { "2026-02": 1.02, "2026-05": 1.05, "2026-09": 1.09 } } } };
  // 1. le mois demandé
  assert.equal(rateToPivot(config, "EUR", "2026-05", BUILTIN), 1.05);
  // 2. sinon le mois saisi le plus proche avant
  assert.equal(rateToPivot(config, "EUR", "2026-08", BUILTIN), 1.05);
  assert.equal(rateToPivot(config, "EUR", "2027-01", BUILTIN), 1.09);
  assert.equal(rateToPivot(config, "EUR", "2026-03", BUILTIN), 1.02);
  // 3. sinon le mois saisi le plus proche après (aucun mois avant janvier 2026)
  assert.equal(rateToPivot(config, "EUR", "2026-01", BUILTIN), 1.02);
  assert.equal(rateToPivot(config, "EUR", "2020-07", BUILTIN), 1.02);
  // 4. sinon le taux par défaut saisi
  assert.equal(rateToPivot({ fx: { EUR: { default: 1.01, months: {} } } }, "EUR", "2026-05", BUILTIN), 1.01);
  assert.equal(rateToPivot({ fx: { EUR: { default: 1.01 } } }, "EUR", "2026-05", BUILTIN), 1.01);
});

test("un mois saisi passe avant le taux par défaut saisi, même s'il est lointain", () => {
  const config = { fx: { EUR: { default: 1.01, months: { "2030-12": 1.3 } } } };
  assert.equal(rateToPivot(config, "EUR", "2026-05", BUILTIN), 1.3);
});

test("sans taux saisi, on retombe sur les taux intégrés, dans le même ordre", () => {
  // 5. taux intégrés : mois exact, précédent, suivant, puis défaut
  assert.equal(rateToPivot({ fx: {} }, "EUR", "2026-06", BUILTIN), 1.4);
  assert.equal(rateToPivot({}, "EUR", "2026-04", BUILTIN), 1.3);
  assert.equal(rateToPivot(null, "EUR", "2026-12", BUILTIN), 1.4);
  assert.equal(rateToPivot(undefined, "EUR", "2025-01", BUILTIN), 1.3);
  assert.equal(rateToPivot({}, "GBP", "2026-06", BUILTIN), 2);
  // une entrée saisie mais vide ne masque pas les taux intégrés
  assert.equal(rateToPivot({ fx: { EUR: { default: null, months: {} } } }, "EUR", "2026-06", BUILTIN), 1.4);
  // les taux saisis d'une autre devise ne comptent pas
  assert.equal(rateToPivot({ fx: { GBP: { default: 9, months: {} } } }, "EUR", "2026-06", BUILTIN), 1.4);
});

test("une devise inconnue partout vaut 1, sans erreur", () => {
  assert.equal(rateToPivot({}, "XYZ", "2026-06", BUILTIN), 1);
  assert.equal(rateToPivot({}, "", "2026-06", BUILTIN), 1);
  assert.equal(rateToPivot({}, null, "2026-06", BUILTIN), 1);
  assert.equal(rateToPivot({}, "EUR", "2026-06", null), 1);
});

test("les taux invalides sont ignorés (zéro, négatif, texte, NaN, clé de mois mal formée)", () => {
  const config = {
    fx: { EUR: { default: -1, months: { "2026-05": 0, "2026-04": "1.2", "2026-03": NaN, "mars": 7, "2026-02": 1.02 } } },
  };
  assert.equal(rateToPivot(config, "EUR", "2026-05", BUILTIN), 1.02);
  // rien de valable dans les taux saisis : taux intégrés, mois le plus proche avant mai = mars
  assert.equal(rateToPivot({ fx: { EUR: { default: 0, months: { "2026-05": -3 } } } }, "EUR", "2026-05", BUILTIN), 1.3);
  assert.equal(rateToPivot({ fx: { EUR: "n'importe quoi" } }, "EUR", "2026-06", BUILTIN), 1.4);
  assert.equal(rateToPivot({ fx: null }, "EUR", "2026-06", BUILTIN), 1.4);
});

test("le mois accepte une date complète ; sans mois on prend le taux le plus récent connu", () => {
  const config = { fx: { EUR: { default: 1.01, months: { "2026-02": 1.02, "2026-09": 1.09 } } } };
  assert.equal(rateToPivot(config, "EUR", "2026-02-17", BUILTIN), 1.02);
  assert.equal(rateToPivot(config, "EUR", undefined, BUILTIN), 1.09);
  assert.equal(rateToPivot(config, "EUR", "", BUILTIN), 1.09);
  assert.equal(rateToPivot(config, "EUR", "pas une date", BUILTIN), 1.09);
  assert.equal(rateToPivot(config, " eur ", "2026-02", BUILTIN), 1.02);
});

test("les taux intégrés ont la forme attendue et servent par défaut", () => {
  for (const cur of ["EUR", "GBP", "CAD", "AUD", "CHF", "MAD", "AED"]) {
    const entry = DEFAULT_RATES[cur];
    assert.ok(entry, cur);
    assert.ok(typeof entry.default === "number" && entry.default > 0, cur + " default");
    assert.equal(typeof entry.months, "object");
    for (const [month, rate] of Object.entries(entry.months)) {
      assert.match(month, /^\d{4}-(0[1-9]|1[0-2])$/);
      assert.ok(typeof rate === "number" && rate > 0, cur + " " + month);
    }
    const months = Object.keys(entry.months).sort();
    const expected = months.length ? entry.months[months[0]] : entry.default;
    assert.equal(rateToPivot(null, cur, months.length ? months[0] : "2026-01"), expected);
    assert.ok(rateToPivot({}, cur, "2026-11") > 0);
  }
  assert.equal(DEFAULT_RATES.USD, undefined);
});

test("convert : même devise = montant exact, non estimé", () => {
  assert.deepEqual(convert(-9477, "USD", "USD", "2026-11-21", null), { cents: -9477, estimated: false });
  assert.deepEqual(convert(1234, "EUR", "EUR", "2026-11-21", { fx: { EUR: { default: 2, months: {} } } }), { cents: 1234, estimated: false });
  assert.deepEqual(convert(0, "EUR", "eur", "2026-11-21", null), { cents: 0, estimated: false });
});

test("convert : passe par le dollar avec le taux du mois, arrondi au centime", () => {
  const config = { fx: { EUR: { default: 1.2, months: { "2026-10": 1.1, "2026-11": 1.25 } }, GBP: { default: 1.5, months: {} } } };
  // 12,00 EUR en octobre : 1200 x 1,10 = 1320
  assert.deepEqual(convert(1200, "EUR", "USD", "2026-10-15", config), { cents: 1320, estimated: true });
  // 50,00 USD en octobre : 5000 / 1,10 = 4545,45
  assert.deepEqual(convert(5000, "USD", "EUR", "2026-10-10", config), { cents: 4545, estimated: true });
  // 94,77 USD en novembre : 9477 / 1,25 = 7581,6
  assert.deepEqual(convert(9477, "USD", "EUR", "2026-11-12", config), { cents: 7582, estimated: true });
  // 100,00 EUR en GBP en novembre : 10000 x 1,25 / 1,5 = 8333,33
  assert.deepEqual(convert(10000, "EUR", "GBP", "2026-11-01", config), { cents: 8333, estimated: true });
  // 100,00 GBP en EUR en octobre : 10000 x 1,5 / 1,1 = 13636,36
  assert.deepEqual(convert(10000, "GBP", "EUR", "2026-10-01", config), { cents: 13636, estimated: true });
  // mois non saisi (décembre) : le mois saisi le plus proche avant (novembre)
  assert.deepEqual(convert(1000, "EUR", "USD", "2026-12-24", config), { cents: 1250, estimated: true });
  // pas de date : taux le plus récent connu
  assert.deepEqual(convert(1000, "EUR", "USD", undefined, config), { cents: 1250, estimated: true });
});

test("convert : arrondi symétrique, un débit et un crédit du même montant restent opposés, jamais de -0", () => {
  const config = { fx: { EUR: { default: 2, months: {} } } };
  // 1 centime de dollar = 0,5 centime d'euro : arrondi à 1 dans les deux sens
  assert.deepEqual(convert(1, "USD", "EUR", "2026-01-01", config), { cents: 1, estimated: true });
  assert.deepEqual(convert(-1, "USD", "EUR", "2026-01-01", config), { cents: -1, estimated: true });
  assert.deepEqual(convert(3, "USD", "EUR", "2026-01-01", config), { cents: 2, estimated: true });
  assert.deepEqual(convert(-3, "USD", "EUR", "2026-01-01", config), { cents: -2, estimated: true });
  const zero = convert(0, "USD", "EUR", "2026-01-01", config);
  assert.ok(Object.is(zero.cents, 0));
  const tiny = convert(-1, "USD", "EUR", "2026-01-01", { fx: { EUR: { default: 100, months: {} } } });
  assert.ok(Object.is(tiny.cents, 0));
  const rates = { fx: { EUR: { default: 1.0837, months: {} } } };
  for (const cents of [1, 7, 99, 1234, 94777, 500001, 123456789]) {
    assert.equal(convert(-cents, "EUR", "USD", "2026-01-01", rates).cents, -convert(cents, "EUR", "USD", "2026-01-01", rates).cents);
    assert.equal(convert(-cents, "USD", "EUR", "2026-01-01", rates).cents, -convert(cents, "USD", "EUR", "2026-01-01", rates).cents);
  }
});

test("convert : montant illisible = 0, devise inconnue = taux 1 mais montant signalé comme estimé", () => {
  assert.deepEqual(convert(NaN, "EUR", "USD", "2026-01-01", null), { cents: 0, estimated: true });
  assert.deepEqual(convert(undefined, "USD", "USD", "2026-01-01", null), { cents: 0, estimated: false });
  assert.deepEqual(convert(500, "XYZ", "USD", "2026-01-01", {}), { cents: 500, estimated: true });
});

test("createFx donne exactement les mêmes résultats que convert et rateToPivot", () => {
  const config = { fx: { EUR: { default: 1.2, months: { "2026-10": 1.1, "2026-11": 1.25 } }, GBP: { default: 1.5, months: { "2026-09": 1.31 } } } };
  const fx = createFx(config);
  const currencies = ["USD", "EUR", "GBP", "CAD", "XYZ"];
  const dates = ["2026-08-31", "2026-09-15", "2026-10-01", "2026-11-30", "2027-02-01", undefined];
  for (const from of currencies) {
    for (const to of currencies) {
      for (const date of dates) {
        for (const cents of [-250001, -1, 0, 1, 9477, 1000000]) {
          assert.deepEqual(fx.convert(cents, from, to, date), convert(cents, from, to, date, config), `${cents} ${from} ${to} ${date}`);
          // deuxième appel : la mémoire ne change rien
          assert.deepEqual(fx.convert(cents, from, to, date), convert(cents, from, to, date, config));
        }
      }
    }
    assert.equal(fx.rate(from, "2026-10"), rateToPivot(config, from, "2026-10"));
    assert.equal(fx.rate(from, "2026-10-17"), rateToPivot(config, from, "2026-10"));
  }
});
