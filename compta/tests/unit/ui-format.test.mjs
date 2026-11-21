// Mise en forme pour l'affichage (src/ui/format.js).
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY,
  MINUS,
  NBSP,
  fmtDate,
  fmtFileSize,
  fmtMoney,
  fmtMoneyAxis,
  fmtMoneyCompact,
  fmtMonth,
  fmtNumber,
  fmtPct,
  fmtRatio,
  fmtShare,
  initials,
  moneyAxis,
  plural,
  pluralWord,
} from "../../src/ui/format.js";

// Écrit un texte attendu avec des espaces ordinaires : "1 234,56 $" -> espaces insécables.
const nb = (text) => text.replace(/ /g, NBSP);

test("fmtMoney : format français, espace insécable, moins typographique", () => {
  assert.equal(fmtMoney(123456, "USD"), nb("1 234,56 $"));
  assert.equal(fmtMoney(123456, "EUR"), nb("1 234,56 €"));
  assert.equal(fmtMoney(-9477, "USD"), MINUS + nb("94,77 $"));
  assert.equal(fmtMoney(0, "USD"), nb("0,00 $"));
  assert.equal(fmtMoney(-0, "USD"), nb("0,00 $"));
  assert.equal(fmtMoney(123456), nb("1 234,56 $"), "USD par défaut");
});

test("fmtMoney : options sign, round, code, approx", () => {
  assert.equal(fmtMoney(184250, "USD", { sign: true }), "+" + nb("1 842,50 $"));
  assert.equal(fmtMoney(-184250, "USD", { sign: true }), MINUS + nb("1 842,50 $"));
  assert.equal(fmtMoney(184250, "USD", { round: true }), nb("1 843 $"));
  assert.equal(fmtMoney(9477, "USD", { code: true }), nb("94,77 $ USD"));
  assert.equal(fmtMoney(-10692, "USD", { approx: true }), "≈" + NBSP + MINUS + nb("106,92 $"));
});

test("fmtMoney : montant absent ou invalide donne une chaîne vide", () => {
  assert.equal(fmtMoney(null), "");
  assert.equal(fmtMoney(undefined), "");
  assert.equal(fmtMoney(NaN), "");
  assert.equal(fmtMoney(Infinity), "");
});

test("les montants ne contiennent jamais de tiret cadratin ou demi-cadratin", () => {
  for (const cents of [-1, -100, -123456789, 5, 0]) {
    assert.doesNotMatch(fmtMoney(cents, "USD"), /[\u2013\u2014]/);
    assert.doesNotMatch(fmtMoneyCompact(cents, "EUR"), /[\u2013\u2014]/);
    assert.doesNotMatch(fmtMoneyAxis(cents, "USD", 5000000), /[\u2013\u2014]/);
  }
});

test("fmtMoneyCompact : entier sous 10 000, puis k et M", () => {
  assert.equal(fmtMoneyCompact(95000, "USD"), nb("950 $"));
  assert.equal(fmtMoneyCompact(999900, "USD"), nb("9 999 $"));
  assert.equal(fmtMoneyCompact(1250000, "USD"), nb("12,5 k$"));
  assert.equal(fmtMoneyCompact(-1250000, "USD"), MINUS + nb("12,5 k$"));
  assert.equal(fmtMoneyCompact(12000000, "EUR"), nb("120 k€"));
  assert.equal(fmtMoneyCompact(123400000, "USD"), nb("1,2 M$"));
  assert.equal(fmtMoney(1250000, "USD", { compact: true }), nb("12,5 k$"));
  assert.equal(fmtMoney(1250000, "USD", { compact: true, sign: true }), "+" + nb("12,5 k$"));
  assert.equal(fmtMoneyCompact(null), "");
});

test("fmtMoneyAxis : une seule unité par axe, choisie d'après la plus grande graduation", () => {
  const small = [0, 200000, 400000, 600000].map((t) => fmtMoneyAxis(t, "USD", 600000));
  assert.deepEqual(small, ["0 $", "2 000 $", "4 000 $", "6 000 $"].map(nb));
  const big = [0, 500000, 1000000, 1500000, 2000000].map((t) => fmtMoneyAxis(t, "USD", 2000000));
  assert.deepEqual(big, ["0 $", "5 k$", "10 k$", "15 k$", "20 k$"].map(nb));
  assert.equal(fmtMoneyAxis(250000, "USD", 1000000), nb("2,5 k$"));
  assert.equal(fmtMoneyAxis(-500000, "USD", 1500000), MINUS + nb("5 k$"));
  assert.equal(fmtMoneyAxis(150000000, "EUR", 200000000), nb("1,5 M€"));
  assert.equal(fmtMoneyAxis(null), "");
  const axis = moneyAxis("USD");
  assert.equal(axis(500000, { max: 2000000 }), nb("5 k$"));
  assert.equal(axis(500000), nb("5 000 $"), "sans contexte, la valeur décide");
});

test("fmtNumber, fmtPct, fmtRatio, fmtShare", () => {
  assert.equal(fmtNumber(1234.5, 1), nb("1 234,5"));
  assert.equal(fmtNumber(1234.56), nb("1 235"));
  assert.equal(fmtNumber(-3), MINUS + "3");
  assert.equal(fmtNumber(-0.001, 1), "0", "pas de zéro négatif");
  assert.equal(fmtNumber(2, 2, 2), "2,00");
  assert.equal(fmtNumber(NaN), "");
  assert.equal(fmtPct(12.34), nb("12 %"));
  assert.equal(fmtPct(12.34, 1), nb("12,3 %"));
  assert.equal(fmtPct(64, 0, { sign: true }), "+" + nb("64 %"));
  assert.equal(fmtPct(-8.2, 1, { sign: true }), MINUS + nb("8,2 %"));
  assert.equal(fmtPct(0, 0, { sign: true }), nb("0 %"));
  assert.equal(fmtPct(null), "");
  assert.equal(fmtRatio(2.345), "2,35");
  assert.equal(fmtRatio(1.87, { times: true }), "×1,87");
  assert.equal(fmtRatio(2, { digits: 1 }), "2");
  assert.equal(fmtRatio(null), "");
  assert.equal(fmtRatio(Infinity), "");
  assert.equal(fmtShare(25, 200), nb("13 %"));
  assert.equal(fmtShare(1, 3, 1), nb("33,3 %"));
  assert.equal(fmtShare(5, 0), "");
});

test("fmtDate et fmtMonth", () => {
  assert.equal(fmtDate("2026-11-21"), "21 nov. 2026");
  assert.equal(fmtDate("2026-11-01", "long"), "1er novembre 2026");
  assert.equal(fmtDate("2026-11-21", "court"), "21/11/2026");
  assert.equal(fmtDate("2026-11-21", "jour"), "21 nov.");
  assert.equal(fmtDate("2026-11-21", "auto", "2026-12-02"), "21 nov.");
  assert.equal(fmtDate("2025-11-21", "auto", "2026-12-02"), "21 nov. 2025");
  assert.equal(fmtDate("2026-02-30"), "");
  assert.equal(fmtDate(null), "");
  assert.equal(fmtMonth("2026-11"), "novembre 2026");
  assert.equal(fmtMonth("2026-11", true), "nov. 2026");
  assert.equal(fmtMonth("novembre"), "");
  assert.equal(fmtMonth(null), "");
});

test("plural : en français 0 et 1 sont au singulier", () => {
  assert.equal(plural(0, "opération", "opérations"), nb("0 opération"));
  assert.equal(plural(1, "opération", "opérations"), nb("1 opération"));
  assert.equal(plural(2, "opération", "opérations"), nb("2 opérations"));
  assert.equal(plural(1234, "opération", "opérations"), nb("1 234 opérations"));
  assert.equal(plural(null, "fichier", "fichiers"), nb("0 fichier"));
  assert.equal(pluralWord(1.5, "jour", "jours"), "jour");
  assert.equal(pluralWord(-3, "jour", "jours"), "jours");
  assert.equal(pluralWord(null, "jour", "jours"), "jour");
});

test("initials, fmtFileSize, EMPTY", () => {
  assert.equal(initials("Rock Martin"), "RM");
  assert.equal(initials("sam"), "S");
  assert.equal(initials("Slash Business"), "SB");
  assert.equal(initials("Jean-Paul de la Tour"), "JT");
  assert.equal(initials("  "), "?");
  assert.equal(initials(null), "?");
  assert.equal(initials("élodie"), "É");
  assert.equal(fmtFileSize(512), nb("512 o"));
  assert.equal(fmtFileSize(12345), nb("12 Ko"));
  assert.equal(fmtFileSize(1500), nb("1,5 Ko"));
  assert.equal(fmtFileSize(2400000), nb("2,4 Mo"));
  assert.equal(fmtFileSize(-1), "");
  assert.equal(EMPTY.length, 1);
});
