import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCIES, CURRENCY_CODES, detectCurrency, parseAmountToCents, centsToInput, formatMoney, sumCents, pct,
} from "../../src/core/money.js";

const NBSP = "\u00a0";
const NNBSP = "\u202f";
const THIN = "\u2009";

// Compare en distinguant 0 et -0 (un montant ne doit jamais valoir -0).
function checkTable(table, opts) {
  for (const [input, expected] of table) {
    const actual = parseAmountToCents(input, opts);
    assert.ok(Object.is(actual, expected), `parseAmountToCents(${JSON.stringify(input)}) = ${Object.is(actual, -0) ? "-0" : actual}, attendu ${expected}`);
  }
}

test("devises : table et codes", () => {
  assert.deepEqual(CURRENCY_CODES, Object.keys(CURRENCIES));
  for (const code of ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "MAD", "AED"]) {
    assert.equal(CURRENCIES[code].code, code);
    assert.ok(CURRENCIES[code].symbol.length > 0);
    assert.ok(CURRENCIES[code].name.length > 0);
  }
  assert.equal(CURRENCY_CODES.length, 8);
});

test("detectCurrency : symboles et codes", () => {
  const table = [
    ["$94.77", "USD"], ["94.77 USD", "USD"], ["usd", "USD"], ["US$ 12", "USD"], ["12 $", "USD"],
    ["12,50 €", "EUR"], ["EUR", "EUR"], ["eur 12", "EUR"], ["€", "EUR"],
    ["£5", "GBP"], ["5 GBP", "GBP"], ["gbp", "GBP"],
    ["CA$ 5", "CAD"], ["5 $ CA", "CAD"], ["5 $CA", "CAD"], ["CAD 5", "CAD"], ["cad", "CAD"],
    ["A$5", "AUD"], ["AU$ 5", "AUD"], ["5 AUD", "AUD"],
    ["CHF 12", "CHF"], ["12 chf", "CHF"],
    ["12 DH", "MAD"], ["100 dhs", "MAD"], ["MAD 12", "MAD"],
    ["AED 5", "AED"], ["5 aed", "AED"],
    ["12,50", null], ["", null], ["fleur", null], ["made", null], [null, null], [undefined, null], [42, null],
  ];
  for (const [input, expected] of table) assert.equal(detectCurrency(input), expected, `detectCurrency(${JSON.stringify(input)})`);
});

test("parseAmountToCents : formats français", () => {
  checkTable([
    ["1 234,56", 123456],
    ["1234,56", 123456],
    ["12,5", 1250],
    ["12,50", 1250],
    ["0,99", 99],
    ["0,5", 50],
    [",5", 50],
    ["1.234,56", 123456],
    ["1.234.567,89", 123456789],
    ["12 345 678,90", 1234567890],
    ["1" + NBSP + "234,56", 123456],
    ["1" + NNBSP + "234,56", 123456],
    ["1" + THIN + "234,56", 123456],
    ["12" + NBSP + "345" + NBSP + "678,90", 1234567890],
    ["1 234,56 €", 123456],
    ["1" + NNBSP + "234,56" + NBSP + "€", 123456],
    ["94,77 €", 9477],
    ["94,77€", 9477],
    ["€ 94,77", 9477],
    ["€94,77", 9477],
    ["1 234 €", 123400],
    ["12 EUR", 1200],
    ["EUR 12,50", 1250],
    ["12,50 DH", 1250],
    ["1 000", 100000],
    ["  12,50  ", 1250],
  ]);
});

test("parseAmountToCents : formats américains et suisses", () => {
  checkTable([
    ["1,234.56", 123456],
    ["1234.56", 123456],
    ["12.5", 1250],
    ["12.50", 1250],
    ["$94.77", 9477],
    ["$ 0.99", 99],
    ["$1,234.56", 123456],
    ["US$ 12.00", 1200],
    ["USD 12.00", 1200],
    ["12.00 USD", 1200],
    ["CA$ 12.00", 1200],
    ["£1,000.00", 100000],
    ["1,234,567.89", 123456789],
    ["1,234.5", 123450],
    [".5", 50],
    ["$.50", 50],
    ["5.", 500],
    ["100", 10000],
    ["0", 0],
    ["007", 700],
    ["1'234.50", 123450],
    ["1’234.50", 123450],
    ["CHF 1'234.50", 123450],
    ["12.-", 1200],
    ["CHF 12.-", 1200],
    ["12,- €", 1200],
  ]);
});

test("parseAmountToCents : négatifs dans toutes les notations", () => {
  checkTable([
    ["-12.50", -1250],
    ["- 12.50", -1250],
    ["-12,50", -1250],
    ["-$12.50", -1250],
    ["$-12.50", -1250],
    ["$ -12.50", -1250],
    ["USD -12.50", -1250],
    ["-12.50 USD", -1250],
    ["-12,50 €", -1250],
    ["€ -12,50", -1250],
    ["€ -1 234,56", -123456],
    ["-1" + NBSP + "234,56" + NBSP + "€", -123456],
    ["12,50-", -1250],
    ["12,50 -", -1250],
    ["12,50- €", -1250],
    ["12,50 €-", -1250],
    ["(12.50)", -1250],
    ["($12.50)", -1250],
    ["$(12.50)", -1250],
    ["(12,50 €)", -1250],
    ["( 12.50 )", -1250],
    ["(12.50) USD", -1250],
    ["(1 234,56 €)", -123456],
    ["\u221212,50", -1250],
    ["\u22121" + NNBSP + "234,56" + NBSP + "€", -123456],
    ["\u201012", -1200],
    ["\u201112", -1200],
    ["\u201212", -1200],
    ["\u201312", -1200],
    ["\u201412", -1200],
    ["\ufe6312", -1200],
    ["\uff0d12", -1200],
    // deux marques de négatif ne s'annulent pas
    ["(-12.50)", -1250],
    ["-(12.50)", -1250],
    ["-12,50-", -1250],
  ]);
});

test("parseAmountToCents : positifs explicites, parenthèses qui n'entourent pas le nombre", () => {
  checkTable([
    ["+12.50", 1250],
    ["+ 12", 1200],
    ["$+12.50", 1250],
    ["12.50 (USD)", 1250],
    ["(USD) 12.50", 1250],
    ["12,50 € (TTC)", 1250],
  ]);
});

test("parseAmountToCents : zéro ne devient jamais -0", () => {
  checkTable([
    ["-0", 0],
    ["-0,00", 0],
    ["(0.00)", 0],
    ["-0.004", 0],
    ["0,00-", 0],
    [-0, 0],
    [-0.004, 0],
    [0, 0],
  ]);
});

test("parseAmountToCents : cas ambigus (un seul séparateur)", () => {
  checkTable([
    // suivi de 3 chiffres et précédé de 1 à 3 chiffres : milliers
    ["1,234", 123400],
    ["1.234", 123400],
    ["12,345", 1234500],
    ["12.345", 1234500],
    ["123.456", 12345600],
    ["999,999", 99999900],
    ["1.005", 100500],
    // sinon : décimales
    ["1,5", 150],
    ["1,50", 150],
    ["1,2345", 123],
    ["0,125", 13],
    ["0.125", 13],
    ["0.500", 50],
    ["0,999", 100],
    [".125", 13],
    ["1234,567", 123457],
    ["1234.567", 123457],
    ["12345,678", 1234568],
    ["1000,5", 100050],
    // plusieurs fois le même séparateur : milliers
    ["1,234,567", 123456700],
    ["1.234.567", 123456700],
    ["1 234 567", 123456700],
    // les deux séparateurs : le dernier est le séparateur décimal
    ["12,345.678", 1234568],
    ["12.345,678", 1234568],
  ]);
});

test("parseAmountToCents : séparateur décimal imposé", () => {
  checkTable([["1.234", 123400], ["1,234", 123], ["1 234,5", 123450], ["12", 1200], ["1.234,56", 123456], ["0,5", 50]], { decimal: "," });
  checkTable([["1,234", 123400], ["1.234", 123], ["1,234.5", 123450], ["12", 1200], ["1,234.56", 123456], ["0.5", 50]], { decimal: "." });
  // une valeur d'option inconnue est ignorée
  checkTable([["12,5", 1250], ["1,234.56", 123456]], { decimal: ";" });
  checkTable([["12,5", 1250]], undefined);
});

test("parseAmountToCents : arrondi au centime (demi-centime vers le haut en valeur absolue)", () => {
  checkTable([
    ["0.004", 0],
    ["0.005", 1],
    ["0.994", 99],
    ["0.995", 100],
    ["2.6749", 267],
    ["2.6750", 268],
    ["-2.6750", -268],
    ["1099.995", 110000],
    ["1234,565", 123457],
    ["12.3449", 1234],
    ["12.3456", 1235],
    ["0,015", 2],
    ["-0,015", -2],
  ]);
});

test("parseAmountToCents : nombres", () => {
  checkTable([
    [94.77, 9477],
    [19.99, 1999],
    [12, 1200],
    [-12.5, -1250],
    [0.1 + 0.2, 30],
    [1.005, 101],
    [0.145, 15],
    [-12.345, -1235],
    [12.345, 1235],
    [1e6, 100000000],
    [NaN, null],
    [Infinity, null],
    [-Infinity, null],
  ]);
});

test("parseAmountToCents : texte autour du montant", () => {
  checkTable([
    ["Total: 12.50", 1250],
    ["Fr. 12.50", 1250],
    ["12,50 € T.T.C.", 1250],
    ["12.5 %", 1250],
    ["Amount paid $94.77", 9477],
    ["12,50\t", 1250],
  ]);
});

test("parseAmountToCents : valeurs illisibles", () => {
  checkTable([
    [null, null], [undefined, null], ["", null], [" ", null], ["abc", null], ["-", null], [".", null], [",", null],
    ["€", null], ["N/A", null], ["--", null], ["()", null], [{}, null], [[], null], [true, null],
  ]);
});

test("parseAmountToCents : toujours un entier ou null", () => {
  const samples = ["1,234.567", "0,0049", "12.999999", "3,14159", "1e3", "12 345,678", "7", "-0,5", "(3.333)"];
  for (const s of samples) {
    const cents = parseAmountToCents(s);
    assert.ok(cents === null || Number.isInteger(cents), `${s} -> ${cents}`);
  }
});

test("centsToInput", () => {
  const table = [
    [123456, "1234,56"], [5, "0,05"], [-5, "-0,05"], [0, "0,00"], [100, "1,00"], [-123456, "-1234,56"], [99, "0,99"],
    [1234.4, "12,34"], [null, ""], [undefined, ""], [NaN, ""], [Infinity, ""],
  ];
  for (const [cents, expected] of table) assert.equal(centsToInput(cents), expected, `centsToInput(${cents})`);
});

test("formatMoney : format français, espaces insécables", () => {
  const table = [
    [[123456, "EUR"], `1${NBSP}234,56${NBSP}€`],
    [[100], `1,00${NBSP}€`],
    [[0, "EUR"], `0,00${NBSP}€`],
    [[-9477, "USD"], `-94,77${NBSP}$`],
    [[9477, "USD"], `94,77${NBSP}$`],
    [[9477, "USD", { code: true }], `94,77${NBSP}$${NBSP}USD`],
    [[-9477, "USD", { code: true }], `-94,77${NBSP}$${NBSP}USD`],
    [[1250, "EUR", { sign: true }], `+12,50${NBSP}€`],
    [[-1250, "EUR", { sign: true }], `-12,50${NBSP}€`],
    [[0, "EUR", { sign: true }], `0,00${NBSP}€`],
    [[123456, "USD", { round: true }], `1${NBSP}235${NBSP}$`],
    [[123449, "USD", { round: true }], `1${NBSP}234${NBSP}$`],
    [[-50, "USD", { round: true }], `-1${NBSP}$`],
    [[50, "USD", { round: true, sign: true }], `+1${NBSP}$`],
    // un montant affiché à zéro ne porte pas de signe
    [[-40, "USD", { round: true }], `0${NBSP}$`],
    [[40, "USD", { round: true, sign: true }], `0${NBSP}$`],
    [[100, "GBP"], `1,00${NBSP}£`],
    [[100, "CHF"], `1,00${NBSP}CHF`],
    [[100, "MAD"], `1,00${NBSP}MAD`],
    [[100, "AED"], `1,00${NBSP}AED`],
    [[1234567, "CAD"], `12${NBSP}345,67${NBSP}$`],
    [[123456789012, "EUR"], `1${NBSP}234${NBSP}567${NBSP}890,12${NBSP}€`],
  ];
  for (const [args, expected] of table) assert.equal(formatMoney(...args), expected, `formatMoney(${JSON.stringify(args)})`);
});

test("formatMoney : valeurs vides, devise inconnue, pas d'espace fine", () => {
  assert.equal(formatMoney(null, "EUR"), "");
  assert.equal(formatMoney(undefined, "EUR"), "");
  assert.equal(formatMoney(NaN, "EUR"), "");
  assert.equal(formatMoney(Infinity, "EUR"), "");
  assert.doesNotThrow(() => formatMoney(100, "pas une devise"));
  assert.ok(formatMoney(100, "pas une devise").startsWith("1,00"));
  for (const code of CURRENCY_CODES) {
    const out = formatMoney(-987654321, code);
    assert.ok(!out.includes(NNBSP), code);
    assert.ok(out.startsWith("-9" + NBSP + "876" + NBSP + "543,21"), `${code}: ${out}`);
  }
});

test("formatMoney puis parseAmountToCents redonne le montant", () => {
  let seed = 20261121;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const magnitude = Math.floor(rand() * 10 ** (1 + Math.floor(rand() * 9)));
    const cents = magnitude > 0 && rand() < 0.4 ? -magnitude : magnitude;
    for (const code of ["EUR", "USD", "GBP", "CHF", "CAD"]) {
      assert.equal(parseAmountToCents(formatMoney(cents, code)), cents, `${code} ${cents}: ${formatMoney(cents, code)}`);
      assert.equal(parseAmountToCents(formatMoney(cents, code, { sign: true, code: true })), cents);
    }
    assert.equal(parseAmountToCents(centsToInput(cents)), cents, `centsToInput ${cents}`);
    // écriture américaine avec séparateur de milliers
    const us = (cents < 0 ? "-" : "") + "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.equal(parseAmountToCents(us), cents, us);
    // écriture comptable
    const paren = cents < 0 ? "(" + centsToInput(-cents) + ")" : centsToInput(cents);
    assert.equal(parseAmountToCents(paren), cents, paren);
  }
});

test("sumCents ignore les valeurs vides", () => {
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents([100, 250, -50]), 300);
  assert.equal(sumCents([1, null, undefined, NaN, "3", Infinity, 2]), 3);
  assert.equal(sumCents(new Set([5, 7])), 12);
  assert.equal(sumCents([10, 20].values()), 30);
});

test("pct : une décimale, null si le total est nul", () => {
  const table = [[1, 3, 33.3], [2, 3, 66.7], [50, 200, 25], [0, 5, 0], [-1, 4, -25], [5, 5, 100], [1, 0, null], [1, null, null], [1, undefined, null], [1, 1000, 0.1]];
  for (const [part, total, expected] of table) assert.equal(pct(part, total), expected, `pct(${part}, ${total})`);
});
