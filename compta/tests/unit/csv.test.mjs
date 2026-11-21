import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBytes, parseCsv, detectDelimiter, normHeader, findColumn, rowsToObjects } from "../../src/core/importers/csv.js";

/* ------------------------------------------------------------------ fabrication d'octets */

const encoder = new TextEncoder();
const utf8 = (text) => encoder.encode(text);
const BOM_UTF8 = [0xef, 0xbb, 0xbf];

function utf16(text, littleEndian, withBom) {
  const out = [];
  if (withBom) out.push(...(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]));
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (littleEndian) out.push(unit & 0xff, unit >> 8);
    else out.push(unit >> 8, unit & 0xff);
  }
  return Uint8Array.from(out);
}

const CP1252_SPECIAL = { "€": 0x80, "…": 0x85, "’": 0x92, "\u0153": 0x9c, "Œ": 0x8c };
function cp1252(text) {
  return Uint8Array.from([...text].map((ch) => (ch in CP1252_SPECIAL ? CP1252_SPECIAL[ch] : ch.charCodeAt(0))));
}

function concat(...parts) {
  const out = [];
  for (const part of parts) out.push(...part);
  return Uint8Array.from(out);
}

const SAMPLE = "Date;Libellé;Montant\r\n21/11/2026;Café crème à emporter;12,50 €\r\n";

/* ------------------------------------------------------------------ decodeBytes */

test("decodeBytes : UTF-8 avec et sans BOM", () => {
  assert.equal(decodeBytes(utf8(SAMPLE)), SAMPLE);
  assert.equal(decodeBytes(concat(BOM_UTF8, utf8(SAMPLE))), SAMPLE);
  assert.equal(decodeBytes(utf8("ascii only, 1.50")), "ascii only, 1.50");
  assert.equal(decodeBytes(utf8("film 🎬 pour Léa")), "film 🎬 pour Léa");
  assert.equal(decodeBytes(Uint8Array.from(BOM_UTF8)), "");
});

test("decodeBytes : UTF-16 avec BOM, petit et gros boutiste", () => {
  assert.equal(decodeBytes(utf16(SAMPLE, true, true)), SAMPLE);
  assert.equal(decodeBytes(utf16(SAMPLE, false, true)), SAMPLE);
  assert.equal(decodeBytes(utf16("film 🎬 pour Léa", true, true)), "film 🎬 pour Léa");
  assert.equal(decodeBytes(utf16("film 🎬 pour Léa", false, true)), "film 🎬 pour Léa");
  assert.equal(decodeBytes(Uint8Array.from([0xff, 0xfe])), "");
  assert.equal(decodeBytes(Uint8Array.from([0xfe, 0xff])), "");
});

test("decodeBytes : UTF-16 sans BOM, deviné aux octets nuls", () => {
  assert.equal(decodeBytes(utf16(SAMPLE, true, false)), SAMPLE);
  assert.equal(decodeBytes(utf16(SAMPLE, false, false)), SAMPLE);
  assert.equal(decodeBytes(utf16("a;b", true, false)), "a;b");
  assert.equal(decodeBytes(utf16("a;b", false, false)), "a;b");
  const long = "Campaign\tDay\tCost\r\n" + "Film de Léa\tNov 1, 2026\t1,234.50 €\r\n".repeat(500);
  assert.equal(decodeBytes(utf16(long, true, false)), long);
  assert.equal(decodeBytes(utf16(long, false, false)), long);
});

test("decodeBytes : UTF-16 de longueur impaire (fichier coupé), le dernier octet est ignoré", () => {
  assert.equal(decodeBytes(concat(utf16("a;b\n1;2", true, true), [0x41])), "a;b\n1;2");
  assert.equal(decodeBytes(concat(utf16("a;b\n1;2", false, true), [0x00])), "a;b\n1;2");
});

test("decodeBytes : windows-1252 quand ce n'est pas de l'UTF-8 valide", () => {
  const text = "Libellé;Débit;Crédit\r\nCafé;12,50 €;\u0153uf à la coque… l’été\r\n";
  assert.equal(decodeBytes(cp1252(text)), text);
  assert.equal(decodeBytes(cp1252("Café")), "Café");
  assert.equal(decodeBytes(Uint8Array.from([0x80])), "€");
  assert.equal(decodeBytes(Uint8Array.from([0x41, 0xe9, 0x42])), "AéB");
  assert.equal(decodeBytes(Uint8Array.from([0x41, 0xa0, 0x42])), "A\u00a0B");
});

test("decodeBytes : table windows-1252 complète pour les octets 0x80 à 0xFF", () => {
  const bytes = new Uint8Array(129);
  bytes[0] = 0x41;
  for (let b = 0x80; b <= 0xff; b++) bytes[b - 0x7f] = b;
  const text = decodeBytes(bytes);
  assert.equal(text.length, 129);
  assert.equal(text[0], "A");
  const expected = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030,
    0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178,
  };
  for (let b = 0x80; b <= 0xff; b++) {
    const want = b in expected ? expected[b] : b;
    assert.equal(text.charCodeAt(b - 0x7f), want, "octet 0x" + b.toString(16));
  }
  let reference = null;
  try { reference = new TextDecoder("windows-1252").decode(bytes); } catch { reference = null; }
  if (reference !== null) assert.equal(text, reference);
});

test("decodeBytes : UTF-8 à peine abîmé reste lu en UTF-8", () => {
  const good = utf8("Libellé;Crédit;Débit;Référence;Écriture;Opération;Août;Noël\n");
  const cut = good.indexOf(0x3b);
  const damaged = concat(good.subarray(0, cut), [0xe9], good.subarray(cut));
  const text = decodeBytes(damaged);
  assert.ok(text.includes("Libellé\ufffd;Crédit"), text);
  assert.ok(text.includes("Noël"));
  assert.ok(!text.includes("Ã"));
  // fichier coupé au milieu d'un caractère
  const truncated = concat(utf8("été ".repeat(10)), [0xc3]);
  const tail = decodeBytes(truncated);
  assert.ok(tail.startsWith("été été "));
  assert.ok(tail.endsWith("\ufffd"));
});

test("decodeBytes : types d'entrée", () => {
  const bytes = utf8(SAMPLE);
  assert.equal(decodeBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SAMPLE);
  assert.equal(decodeBytes(Buffer.from(SAMPLE, "utf8")), SAMPLE);
  assert.equal(decodeBytes(Array.from(bytes)), SAMPLE);
  // vue partielle sur un tampon plus grand
  const padded = concat([1, 2, 3], bytes, [4, 5]);
  assert.equal(decodeBytes(new Uint8Array(padded.buffer, 3, bytes.length)), SAMPLE);
  assert.equal(decodeBytes(new DataView(padded.buffer, 3, bytes.length)), SAMPLE);
  assert.equal(decodeBytes("\ufeffdéjà du texte"), "déjà du texte");
  assert.equal(decodeBytes("déjà du texte"), "déjà du texte");
  for (const empty of [null, undefined, new Uint8Array(0), new ArrayBuffer(0), [], {}, 42]) assert.equal(decodeBytes(empty), "");
});

/* ------------------------------------------------------------------ séparateur */

test("parseCsv : devine virgule, point-virgule, tabulation et barre verticale", () => {
  let parsed = parseCsv("Date,Description,Amount\n2026-11-21,Klaviyo,-94.77\n");
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["Date", "Description", "Amount"]);
  assert.deepEqual(parsed.rows, [["2026-11-21", "Klaviyo", "-94.77"]]);

  parsed = parseCsv("Date;Libellé;Montant\n21/11/2026;CB KLAVIYO;-94,77\n22/11/2026;VIR SHOPIFY;1 234,56\n");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Montant"]);
  assert.deepEqual(parsed.rows, [["21/11/2026", "CB KLAVIYO", "-94,77"], ["22/11/2026", "VIR SHOPIFY", "1 234,56"]]);

  parsed = parseCsv("Campaign\tDay\tCost\nA\tNov 1, 2026\t1,234.50\nB\tNov 2, 2026\t2.00\n");
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.headers, ["Campaign", "Day", "Cost"]);
  assert.deepEqual(parsed.rows, [["A", "Nov 1, 2026", "1,234.50"], ["B", "Nov 2, 2026", "2.00"]]);

  parsed = parseCsv("a|b|c\n1|2|3\n");
  assert.equal(parsed.delimiter, "|");
  assert.deepEqual(parsed.rows, [["1", "2", "3"]]);
});

test("parseCsv : la détection ignore ce qui est entre guillemets", () => {
  const parsed = parseCsv('name,note\n"a;b;c;d","x|y|z"\n"e;f;g;h","1\t2"\n');
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.rows, [["a;b;c;d", "x|y|z"], ["e;f;g;h", "1\t2"]]);
});

test("parseCsv : virgules décimales ou virgules de date sur chaque ligne ne trompent pas la détection", () => {
  // une virgule par ligne de données, aucune dans l'en-tête
  const fr = ["Date;Libellé;Montant"];
  for (let i = 1; i <= 30; i++) fr.push(`${String(i).padStart(2, "0")}/11/2026;CB COMMERCE ${i};-${i},50`);
  assert.equal(parseCsv(fr.join("\n")).delimiter, ";");
  // deux virgules par ligne de données dans un fichier à tabulations
  const tsv = ["Day\tCampaign\tCost"];
  for (let i = 1; i <= 30; i++) tsv.push(`Nov ${i}, 2026\tFilm ${i}\t1,${String(i).padStart(3, "0")}.00`);
  assert.equal(parseCsv(tsv.join("\n")).delimiter, "\t");
  // égalité parfaite : le point-virgule l'emporte sur la virgule
  const tie = parseCsv("Nom, prénom;Montant\nDupont, Jean;12\nMartin, Léa;15\n");
  assert.equal(tie.delimiter, ";");
  assert.deepEqual(tie.headers, ["Nom, prénom", "Montant"]);
});

test("parseCsv : une seule colonne, une seule ligne, séparateur imposé", () => {
  let parsed = parseCsv("Libellé\nun\ndeux\n");
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["Libellé"]);
  assert.deepEqual(parsed.rows, [["un"], ["deux"]]);

  parsed = parseCsv("a;b;c");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["a", "b", "c"]);
  assert.deepEqual(parsed.rows, []);

  parsed = parseCsv("a;b,c\n1;2,3\n", { delimiter: "," });
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["a;b", "c"]);
  assert.deepEqual(parsed.rows, [["1;2", "3"]]);

  // une option invalide est ignorée
  for (const bad of [";;", "", 5, null]) {
    parsed = parseCsv("a;b,c\n1;2,3\n", { delimiter: bad });
    assert.equal(parsed.delimiter, ";");
    assert.deepEqual(parsed.headers, ["a", "b,c"]);
  }
});

test("detectDelimiter", () => {
  assert.equal(detectDelimiter("a,b\n1,2"), ",");
  assert.equal(detectDelimiter("a;b\n1;2"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter("a|b\n1|2"), "|");
  assert.equal(detectDelimiter("sep=|\na,b\n1,2"), "|");
  assert.equal(detectDelimiter("\ufeffa;b\n1;2"), ";");
  assert.equal(detectDelimiter("pas de séparateur"), ",");
  assert.equal(detectDelimiter(""), ",");
  assert.equal(detectDelimiter(null), ",");
});

test("parseCsv : première ligne sep=", () => {
  let parsed = parseCsv("sep=;\nA;B\n1;2\n");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["A", "B"]);
  assert.deepEqual(parsed.rows, [["1", "2"]]);
  assert.equal(parsed.headerLine, 2);
  assert.deepEqual(parsed.lineNumbers, [3]);
  assert.equal(parsed.headerRow, 0);

  // le séparateur annoncé l'emporte sur ce que la détection aurait choisi
  parsed = parseCsv("sep=,\r\nA,B;C\r\n1,2;3\r\n");
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["A", "B;C"]);
  assert.deepEqual(parsed.rows, [["1", "2;3"]]);

  parsed = parseCsv("sep=\t\nA\tB\n1\t2\n");
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.rows, [["1", "2"]]);

  parsed = parseCsv("sep=\\t\nA\tB\n1\t2\n");
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.headers, ["A", "B"]);

  parsed = parseCsv('"sep=;"\nA;B\n1;2\n');
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["A", "B"]);

  parsed = parseCsv("SEP=;\nA;B\n1;2\n");
  assert.deepEqual(parsed.headers, ["A", "B"]);

  parsed = parseCsv("sep=|\na|b\n1|2\n");
  assert.equal(parsed.delimiter, "|");
  assert.deepEqual(parsed.rows, [["1", "2"]]);

  // opts.delimiter garde le dernier mot, mais la ligne sep= ne devient pas une donnée
  parsed = parseCsv("sep=;\nA,B;C\n1,2;3\n", { delimiter: "," });
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["A", "B;C"]);
  assert.deepEqual(parsed.rows, [["1", "2;3"]]);

  // ailleurs qu'en première ligne, c'est une donnée comme une autre
  parsed = parseCsv("A;B\nsep=;\n1;2\n");
  assert.deepEqual(parsed.rows, [["sep=", ""], ["1", "2"]]);

  parsed = parseCsv("sep=;");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, []);
  assert.deepEqual(parsed.rows, []);
});

/* ------------------------------------------------------------------ guillemets */

test("parseCsv : guillemets RFC 4180", () => {
  let parsed = parseCsv('a,b,c\n1,"x ""y"" z","line1\nline2"\n');
  assert.deepEqual(parsed.rows, [["1", 'x "y" z', "line1\nline2"]]);

  parsed = parseCsv('"Date","Montant, TTC"\n"2026-11-21","1,234.56"\n');
  assert.deepEqual(parsed.headers, ["Date", "Montant, TTC"]);
  assert.deepEqual(parsed.rows, [["2026-11-21", "1,234.56"]]);

  parsed = parseCsv('a,b,c\n"",x,""\n');
  assert.deepEqual(parsed.rows, [["", "x", ""]]);

  parsed = parseCsv('a,b\n"""",""""""\n');
  assert.deepEqual(parsed.rows, [['"', '""']]);

  parsed = parseCsv('a;b\n"x;y";"z"\n');
  assert.deepEqual(parsed.rows, [["x;y", "z"]]);
});

test("parseCsv : retours à la ligne dans une cellule, numéros de ligne du fichier", () => {
  let parsed = parseCsv('a,b\r\n1,"l1\r\nl2\rl3"\r\n2,x\r\n');
  assert.deepEqual(parsed.rows, [["1", "l1\nl2\nl3"], ["2", "x"]]);
  assert.equal(parsed.headerLine, 1);
  assert.deepEqual(parsed.lineNumbers, [2, 5]);

  parsed = parseCsv('a,b\n1,"x\ny"\n2,z\n');
  assert.deepEqual(parsed.lineNumbers, [2, 4]);

  // cellule d'en-tête sur deux lignes
  parsed = parseCsv('"Montant\n(USD)",Date\n12,2026-11-21\n');
  assert.deepEqual(parsed.headers, ["Montant\n(USD)", "Date"]);
  assert.deepEqual(parsed.lineNumbers, [3]);
});

test("parseCsv : espaces autour des guillemets, cellule entre guillemets nettoyée", () => {
  let parsed = parseCsv('a,b\n  "x, y"  ,  "z"  \n');
  assert.deepEqual(parsed.rows, [["x, y", "z"]]);
  parsed = parseCsv('a\n"  x  "\n');
  assert.deepEqual(parsed.rows, [["x"]]);
  parsed = parseCsv('"a","b"\n"1","\n"\n');
  assert.deepEqual(parsed.rows, [["1", ""]]);
});

test("parseCsv : guillemets mal formés, sans perdre les lignes suivantes", () => {
  // guillemet au milieu d'une valeur sans guillemets : caractère normal
  let parsed = parseCsv('a,b\n12" pizza,5\' 3"\n');
  assert.deepEqual(parsed.rows, [['12" pizza', "5' 3\""]]);

  // guillemets non doublés à l'intérieur d'une cellule entre guillemets
  parsed = parseCsv('a,b\n1,"CAFE "LE PARIS" SARL"\n2,x\n');
  assert.deepEqual(parsed.rows, [["1", 'CAFE "LE PARIS" SARL'], ["2", "x"]]);

  // guillemet jamais refermé sur la dernière ligne
  parsed = parseCsv('a,b\n1,"abc');
  assert.deepEqual(parsed.rows, [["1", "abc"]]);

  // guillemet jamais refermé en plein fichier : il ne doit pas avaler la suite
  parsed = parseCsv('a,b\n1,"unterminated\n2,x\n3,y\n');
  assert.deepEqual(parsed.rows, [["1", '"unterminated'], ["2", "x"], ["3", "y"]]);
  assert.deepEqual(parsed.lineNumbers, [2, 3, 4]);

  parsed = parseCsv('a,b\n"x"y,2\n3,4\n');
  assert.deepEqual(parsed.rows, [['"x"y', "2"], ["3", "4"]]);
});

test("parseCsv : des dizaines de libellés qui commencent par un guillemet jamais refermé", () => {
  const lines = ["Date;Libellé;Montant", '01/11/2026;"CAFE DU COIN;-5,00'];
  for (let i = 2; i <= 200; i++) lines.push(`${String((i % 28) + 1).padStart(2, "0")}/11/2026;${i % 3 ? "" : '"'}CB COMMERCE ${i};-${i},00`);
  const parsed = parseCsv(lines.join("\n"));
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Montant"]);
  assert.equal(parsed.rows.length, 200);
  assert.deepEqual(parsed.rows[0], ["01/11/2026", '"CAFE DU COIN', "-5,00"]);
  assert.deepEqual(parsed.rows[1], ["03/11/2026", "CB COMMERCE 2", "-2,00"]);
  assert.deepEqual(parsed.rows[2], ["04/11/2026", '"CB COMMERCE 3', "-3,00"]);
  assert.deepEqual(parsed.rows[199], ["05/11/2026", "CB COMMERCE 200", "-200,00"]);
  assert.equal(parsed.lineNumbers[199], 201);
});

/* ------------------------------------------------------------------ fins de ligne, lignes vides */

test("parseCsv : CRLF, LF, CR, mélangés, avec ou sans retour final", () => {
  const expected = [["1", "2"], ["3", "4"], ["5", "6"]];
  for (const eol of ["\r\n", "\n", "\r"]) {
    for (const last of ["", eol]) {
      const parsed = parseCsv(["a,b", "1,2", "3,4", "5,6"].join(eol) + last);
      assert.deepEqual(parsed.headers, ["a", "b"], JSON.stringify(eol));
      assert.deepEqual(parsed.rows, expected, JSON.stringify(eol));
      assert.deepEqual(parsed.lineNumbers, [2, 3, 4]);
    }
  }
  const mixed = parseCsv("a,b\r\n1,2\n3,4\r5,6");
  assert.deepEqual(mixed.rows, expected);
  assert.deepEqual(mixed.lineNumbers, [2, 3, 4]);
});

test("parseCsv : séparateur en fin de ligne", () => {
  let parsed = parseCsv("a,b,\n1,2,\n");
  assert.deepEqual(parsed.headers, ["a", "b"]);
  assert.deepEqual(parsed.rows, [["1", "2"]]);
  parsed = parseCsv("a,b\n1,");
  assert.deepEqual(parsed.rows, [["1", ""]]);
  parsed = parseCsv("Date;Valeur;Libellé;Débit;Crédit;\n31/12/2026;01/01/2027;INTERETS 2026;;38,67;\n");
  assert.deepEqual(parsed.headers, ["Date", "Valeur", "Libellé", "Débit", "Crédit"]);
  assert.deepEqual(parsed.rows, [["31/12/2026", "01/01/2027", "INTERETS 2026", "", "38,67"]]);
  assert.deepEqual(parsed.overflowLines, []);
});

test("parseCsv : lignes vides au début, au milieu et à la fin", () => {
  let parsed = parseCsv("\n\n  \na,b\n\n1,2\n   \n\n3,4\n\n\n");
  assert.deepEqual(parsed.headers, ["a", "b"]);
  assert.deepEqual(parsed.rows, [["1", "2"], ["3", "4"]]);
  assert.equal(parsed.headerLine, 4);
  assert.deepEqual(parsed.lineNumbers, [6, 9]);

  // lignes faites uniquement de séparateurs (fin de feuille de tableur)
  parsed = parseCsv("a;b;c\n;;\n1;2;3\n;;\n;;\n");
  assert.deepEqual(parsed.rows, [["1", "2", "3"]]);
  assert.deepEqual(parsed.lineNumbers, [3]);

  parsed = parseCsv("a,b\n1,2\n,\n,\n\"\",\"\"\n");
  assert.deepEqual(parsed.rows, [["1", "2"]]);
});

test("parseCsv : entrée vide", () => {
  for (const input of ["", null, undefined, "\n\n \n", "   ", "\r\n\r\n", ";;;\n;;;\n"]) {
    const parsed = parseCsv(input);
    assert.deepEqual(parsed.headers, []);
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.lineNumbers, []);
    assert.deepEqual(parsed.preamble, []);
    assert.deepEqual(parsed.overflowLines, []);
    assert.equal(typeof parsed.delimiter, "string");
    assert.deepEqual(rowsToObjects(parsed), []);
  }
  assert.equal(parseCsv("").delimiter, ",");
});

/* ------------------------------------------------------------------ ligne d'en-tête */

test("parseCsv : lignes de titre avant l'en-tête", () => {
  let parsed = parseCsv("Relevé de compte\nPériode du 01/11/2026 au 21/11/2026\n\nDate;Libellé;Débit;Crédit\n02/11/2026;CB KLAVIYO;94,77;\n03/11/2026;VIR SHOPIFY;;1 234,56\n");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Débit", "Crédit"]);
  assert.deepEqual(parsed.rows, [["02/11/2026", "CB KLAVIYO", "94,77", ""], ["03/11/2026", "VIR SHOPIFY", "", "1 234,56"]]);
  assert.equal(parsed.headerRow, 2);
  assert.equal(parsed.headerLine, 4);
  assert.deepEqual(parsed.lineNumbers, [5, 6]);
  assert.deepEqual(parsed.preamble, [["Relevé de compte"], ["Période du 01/11/2026 au 21/11/2026"]]);

  // titres complétés par des séparateurs (fichier repassé par un tableur), dont une ligne aussi large que le tableau
  parsed = parseCsv("Relevé de compte;;;;\nCompte;FR76 1234;Solde;1 234,56;\n;;;;\nDate;Libellé;Débit;Crédit;\n27/01/2026;CARTE X;-12,96;;\n28/01/2026;VIR Y;;100,00;\n");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Débit", "Crédit"]);
  assert.deepEqual(parsed.rows, [["27/01/2026", "CARTE X", "-12,96", ""], ["28/01/2026", "VIR Y", "", "100,00"]]);
  assert.equal(parsed.headerLine, 4);
  assert.deepEqual(parsed.preamble, [["Relevé de compte", "", "", "", ""], ["Compte", "FR76 1234", "Solde", "1 234,56", ""]]);

  // bloc "clé, valeur" avant le tableau (export de régie pub)
  parsed = parseCsv("Account name,My account\nAccount ID,123456\nReporting starts,2026-11-01\nReporting ends,2026-11-21\n\nCampaign name,Day,Amount spent (USD),Impressions\nFilm A,2026-11-01,12.50,1000\nFilm B,2026-11-01,7.25,800\n");
  assert.deepEqual(parsed.headers, ["Campaign name", "Day", "Amount spent (USD)", "Impressions"]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.headerRow, 4);
  assert.equal(parsed.headerLine, 6);
  assert.deepEqual(parsed.preamble[0], ["Account name", "My account"]);

  // ligne de titre aussi large que le tableau, juste avant les vrais titres : la ligne la plus remplie est l'en-tête
  parsed = parseCsv("Compte;Courant;EUR;;\nDate;Libellé;Débit;Crédit;Solde\n01/11/2026;CB X;-5,00;;95,00\n02/11/2026;VIR Y;;10,00;105,00\n");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Débit", "Crédit", "Solde"]);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.preamble, [["Compte", "Courant", "EUR", "", ""]]);

  // bloc "clé, valeur" de deux cellules devant un tableau de trois colonnes
  parsed = parseCsv("Account,ACME\nPeriod,November\nDate,Label,Amount\n2026-11-01,x,1\n2026-11-02,y,2\n");
  assert.deepEqual(parsed.headers, ["Date", "Label", "Amount"]);
  assert.equal(parsed.rows.length, 2);

  // titre contenant le séparateur
  parsed = parseCsv("Report, generated today\nA,B,C\n1,2,3\n2,3,4\n");
  assert.deepEqual(parsed.headers, ["A", "B", "C"]);
  assert.equal(parsed.rows.length, 2);

  // titre puis en-tête seul, sans données
  parsed = parseCsv("Export\nDate;Libellé;Montant\n");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Montant"]);
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.preamble, [["Export"]]);
});

test("parseCsv : fichier à tabulations avec titre, plage de dates et ligne de total", () => {
  const parsed = parseCsv("Report\nNov 1, 2026 - Nov 21, 2026\n\nCampaign\tDay\tCost\nA\tNov 1, 2026\t1,234.50\nB\tNov 2, 2026\t2.00\nTotal\t\t1,236.50\n");
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.headers, ["Campaign", "Day", "Cost"]);
  assert.deepEqual(parsed.rows, [["A", "Nov 1, 2026", "1,234.50"], ["B", "Nov 2, 2026", "2.00"], ["Total", "", "1,236.50"]]);
  assert.equal(parsed.headerLine, 4);
  assert.deepEqual(parsed.preamble, [["Report"], ["Nov 1, 2026 - Nov 21, 2026"]]);
});

test("parseCsv : en-tête dès la première ligne quand rien ne la précède", () => {
  let parsed = parseCsv("Titre;x;y\nA;B;C\n1;2;3\n4;5;6\n");
  assert.deepEqual(parsed.headers, ["Titre", "x", "y"]);
  assert.equal(parsed.headerRow, 0);
  assert.equal(parsed.rows.length, 3);
  // en-tête faite de nombres : on la garde quand même
  parsed = parseCsv("2024;2025;2026\n1;2;3\n4;5;6\n");
  assert.deepEqual(parsed.headers, ["2024", "2025", "2026"]);
  assert.equal(parsed.rows.length, 2);
});

test("parseCsv : opts.headerRow impose la ligne d'en-tête", () => {
  const text = "Titre;x;y\n\nA;B;C\n1;2;3\n4;5;6\n";
  let parsed = parseCsv(text, { headerRow: 1 });
  assert.deepEqual(parsed.headers, ["A", "B", "C"]);
  assert.deepEqual(parsed.rows, [["1", "2", "3"], ["4", "5", "6"]]);
  assert.equal(parsed.headerRow, 1);
  assert.equal(parsed.headerLine, 3);
  assert.deepEqual(parsed.preamble, [["Titre", "x", "y"]]);
  assert.deepEqual(parsed.lineNumbers, [4, 5]);

  parsed = parseCsv(text, { headerRow: 2 });
  assert.deepEqual(parsed.headers, ["1", "2", "3"]);
  assert.deepEqual(parsed.rows, [["4", "5", "6"]]);

  // valeur hors limites ou invalide : détection automatique
  for (const bad of [99, -1, 1.5, "1", null, NaN]) {
    parsed = parseCsv(text, { headerRow: bad });
    assert.equal(parsed.headerRow, 0, String(bad));
    assert.deepEqual(parsed.headers, ["Titre", "x", "y"]);
  }
  // la ligne sep= ne compte pas
  parsed = parseCsv("sep=;\n" + text, { headerRow: 1 });
  assert.deepEqual(parsed.headers, ["A", "B", "C"]);
  assert.equal(parsed.headerLine, 4);
});

test("parseCsv : opts.noHeader pour un fichier sans titres de colonnes", () => {
  let parsed = parseCsv("2026-11-21;Klaviyo;-94,77\n2026-11-22;Shopify;120,00\n", { noHeader: true });
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Colonne 1", "Colonne 2", "Colonne 3"]);
  assert.deepEqual(parsed.rows, [["2026-11-21", "Klaviyo", "-94,77"], ["2026-11-22", "Shopify", "120,00"]]);

  // lignes de longueurs différentes : la plus longue donne le nombre de colonnes
  parsed = parseCsv("2026-11-21;Klaviyo;-94,77\n2026-11-22;Shopify;120,00;extra\n", { noHeader: true, delimiter: ";" });
  assert.deepEqual(parsed.headers, ["Colonne 1", "Colonne 2", "Colonne 3", "Colonne 4"]);
  assert.deepEqual(parsed.rows, [["2026-11-21", "Klaviyo", "-94,77", ""], ["2026-11-22", "Shopify", "120,00", "extra"]]);
  assert.equal(parsed.headerRow, -1);
  assert.equal(parsed.headerLine, 0);
  assert.deepEqual(parsed.lineNumbers, [1, 2]);
  assert.deepEqual(parsed.preamble, []);
});

/* ------------------------------------------------------------------ largeur des lignes */

test("parseCsv : lignes complétées ou coupées à la largeur de l'en-tête", () => {
  const parsed = parseCsv("a,b,c\n1\n1,2\n1,2,3\n1,2,3,4\n1,2,3,,\n");
  assert.deepEqual(parsed.headers, ["a", "b", "c"]);
  assert.deepEqual(parsed.rows, [["1", "", ""], ["1", "2", ""], ["1", "2", "3"], ["1", "2", "3"], ["1", "2", "3"]]);
  assert.deepEqual(parsed.lineNumbers, [2, 3, 4, 5, 6]);
  // seule la ligne qui avait une vraie valeur en trop est signalée
  assert.deepEqual(parsed.overflowLines, [5]);
  for (const row of parsed.rows) assert.equal(row.length, 3);
});

test("parseCsv : colonnes sans titre", () => {
  // dernière colonne sans titre mais avec des données : gardée
  let parsed = parseCsv("a;b;\n1;2;x\n3;4;\n");
  assert.deepEqual(parsed.headers, ["a", "b", ""]);
  assert.deepEqual(parsed.rows, [["1", "2", "x"], ["3", "4", ""]]);
  assert.deepEqual(parsed.overflowLines, []);
  // dernière colonne sans titre et sans données : retirée
  parsed = parseCsv("a;b;\n1;2;\n3;4;\n");
  assert.deepEqual(parsed.headers, ["a", "b"]);
  assert.deepEqual(parsed.rows, [["1", "2"], ["3", "4"]]);
  // colonne sans titre au milieu : gardée
  parsed = parseCsv("a;;c\n1;2;3\n");
  assert.deepEqual(parsed.headers, ["a", "", "c"]);
  assert.deepEqual(parsed.rows, [["1", "2", "3"]]);
});

test("parseCsv : overflowLines plafonné à 100 lignes", () => {
  const lines = ["a,b"];
  for (let i = 0; i < 150; i++) lines.push("1,2,3");
  const parsed = parseCsv(lines.join("\n"), { headerRow: 0 });
  assert.equal(parsed.rows.length, 150);
  assert.equal(parsed.overflowLines.length, 100);
  assert.equal(parsed.overflowLines[0], 2);
});

/* ------------------------------------------------------------------ nettoyage des cellules */

test("parseCsv : espaces, écriture =\"...\" et apostrophe de protection des tableurs", () => {
  let parsed = parseCsv("a,b\n \u00a0 x \u00a0,\ty\t\n");
  assert.deepEqual(parsed.rows, [["x", "y"]]);

  parsed = parseCsv('id,ref,vide,texte\n="00123","=""007""",="",="a ""b"" c"\n');
  assert.deepEqual(parsed.rows, [["00123", "007", "", 'a "b" c']]);

  parsed = parseCsv("carte;montant;tel;formule;mention\n'0562;'-12,50;'+33612345678;'=1+1;'@x\n");
  assert.deepEqual(parsed.rows, [["0562", "-12,50", "+33612345678", "=1+1", "@x"]]);

  // une apostrophe devant une lettre fait partie du texte
  parsed = parseCsv("a;b;c;d\n'Allo Pizza;';'';l'été\n");
  assert.deepEqual(parsed.rows, [["'Allo Pizza", "'", "''", "l'été"]]);

  // un signe égal sans guillemets reste tel quel
  parsed = parseCsv("a;b\n=1+1;a=b\n");
  assert.deepEqual(parsed.rows, [["=1+1", "a=b"]]);
});

test("parseCsv : BOM en tête de texte", () => {
  const parsed = parseCsv("\ufeffDate,Montant\n2026-11-21,5\n");
  assert.deepEqual(parsed.headers, ["Date", "Montant"]);
  assert.equal(findColumn(parsed.headers, ["date"]), 0);
});

test("parseCsv : accepte directement des octets", () => {
  const text = "Date\tLibellé\tMontant\r\n2026-11-21\tCafé\t12,50\r\n";
  for (const bytes of [utf8(text), utf16(text, true, true), utf16(text, false, false), cp1252(text)]) {
    const parsed = parseCsv(bytes);
    assert.equal(parsed.delimiter, "\t");
    assert.deepEqual(parsed.headers, ["Date", "Libellé", "Montant"]);
    assert.deepEqual(parsed.rows, [["2026-11-21", "Café", "12,50"]]);
  }
});

/* ------------------------------------------------------------------ exports réalistes */

test("parseCsv : relevé Revolut Business", () => {
  const text = [
    "Date started (UTC),Date completed (UTC),ID,Type,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance,Account",
    "2026-11-20,2026-11-21,trx_1,CARD_PAYMENT,Facebk *X7Y8Z9,,Sam,5555 **** **** 0562,USD,-50.00,USD,-50.00,0.00,950.00,Main",
    '2026-11-21,2026-11-21,trx_2,TOPUP,"Payment from Dupont, Jean",Apport,,,EUR,"1,000.00",EUR,"1,000.00",0.00,"1,950.00",Main',
    "",
  ].join("\r\n");
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.headers.length, 15);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.headerRow, 0);
  const amount = findColumn(parsed.headers, ["amount"]);
  assert.equal(amount, 11);
  assert.equal(findColumn(parsed.headers, ["date completed utc", "completed date"]), 1);
  assert.equal(findColumn(parsed.headers, [/^card/]), 7);
  assert.equal(parsed.rows[1][4], "Payment from Dupont, Jean");
  assert.equal(parsed.rows[1][amount], "1,000.00");
  assert.equal(parsed.rows[0][7], "5555 **** **** 0562");
  const objects = rowsToObjects(parsed);
  assert.equal(objects[0].Description, "Facebk *X7Y8Z9");
  assert.equal(objects[1]["Orig amount"], "1,000.00");
});

test("parseCsv : relevé de banque française passé par Excel (windows-1252, point-virgule, titres)", () => {
  const text = "Relevé de compte;;;\r\nTitulaire;M. DUPONT;;\r\n;;;\r\nDate;Libellé;Débit;Crédit\r\n27/01/2026;CARTE X1234 CAFÉ DE L’ÉTÉ;-12,96;\r\n28/01/2026;VIR RECU SHOPIFY;;1 234,56 €\r\n";
  const parsed = parseCsv(decodeBytes(cp1252(text)));
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Débit", "Crédit"]);
  assert.deepEqual(parsed.rows, [["27/01/2026", "CARTE X1234 CAFÉ DE L’ÉTÉ", "-12,96", ""], ["28/01/2026", "VIR RECU SHOPIFY", "", "1 234,56 €"]]);
  assert.equal(parsed.headerLine, 4);
});

test("parseCsv : export Google Ads « Excel .csv » (UTF-16, tabulations, titre, total)", () => {
  const text = "Campaign report\r\nNovember 1, 2026 - November 21, 2026\r\nCampaign\tDay\tCurrency code\tCost\tImpr.\tClicks\r\nFilm Léa\t2026-11-01\tUSD\t1,234.50\t10,000\t321\r\nFilm Tom\t2026-11-01\tUSD\t2.00\t50\t1\r\nTotal: Account\t\tUSD\t1,236.50\t10,050\t322\r\n";
  const parsed = parseCsv(decodeBytes(utf16(text, true, true)));
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.headers, ["Campaign", "Day", "Currency code", "Cost", "Impr.", "Clicks"]);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[0], ["Film Léa", "2026-11-01", "USD", "1,234.50", "10,000", "321"]);
  assert.equal(parsed.rows[2][0], "Total: Account");
  assert.equal(parsed.headerLine, 3);
  assert.equal(findColumn(parsed.headers, ["impr", "impressions"]), 4);
});

test("parseCsv : export de commandes Shopify avec notes sur plusieurs lignes", () => {
  const text = 'Name,Email,Total,Note Attributes,Created at\n#1001,lea@example.com,39.00,"prenom: Léa\nage: 6\nfilm: ""La licorne""",2026-11-20 10:00:00 -0800\n#1002,tom@example.com,49.00,,2026-11-21 09:30:00 -0800\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][3], 'prenom: Léa\nage: 6\nfilm: "La licorne"');
  assert.deepEqual(parsed.rows[1], ["#1002", "tom@example.com", "49.00", "", "2026-11-21 09:30:00 -0800"]);
  assert.deepEqual(parsed.lineNumbers, [2, 5]);
});

/* ------------------------------------------------------------------ normHeader, findColumn, rowsToObjects */

test("normHeader", () => {
  const table = [
    ["Date de début", "date de debut"],
    ["  Amount (USD) ", "amount usd"],
    ["Impr.", "impr"],
    ["Coût/résultat", "cout resultat"],
    ["N° de facture", "n de facture"],
    ["Montant_TTC", "montant ttc"],
    ["Date d'opération", "date d operation"],
    ["DATE  COMPLETED\t(UTC)", "date completed utc"],
    ["Libellé", "libelle"],
    ["Œuvre", "oeuvre"],
    ["Stra\u00dfe", "strasse"],
    ["CTR (%)", "ctr"],
    ["Conv. value / cost", "conv value cost"],
    ["Montant (€)", "montant"],
    ["\ufeffDate", "date"],
    ["Été", "ete"],
    ["ÇA", "ca"],
    ["dateOp", "dateop"],
    ["Montant\n(USD)", "montant usd"],
    ["---", ""],
    ["", ""],
    [null, ""],
    [undefined, ""],
    [42, "42"],
  ];
  for (const [input, expected] of table) assert.equal(normHeader(input), expected, JSON.stringify(input));
  // déjà normalisé : inchangé
  for (const [, expected] of table) assert.equal(normHeader(expected), expected);
});

test("findColumn", () => {
  const headers = ["Date de début", "Libellé", "Montant (EUR)", "Montant", "Frais", ""];
  assert.equal(findColumn(headers, ["montant"]), 3);
  assert.equal(findColumn(headers, ["amount", "montant eur"]), 2);
  assert.equal(findColumn(headers, ["Libellé"]), 1);
  assert.equal(findColumn(headers, ["LIBELLE"]), 1);
  assert.equal(findColumn(headers, [/^montant/]), 2);
  assert.equal(findColumn(headers, [/^montant$/]), 3);
  // l'ordre des candidats prime sur l'ordre des colonnes
  assert.equal(findColumn(headers, ["frais", "montant"]), 4);
  assert.equal(findColumn(headers, [/^frais/, /^date/]), 4);
  assert.equal(findColumn(headers, ["nope", /^date/]), 0);
  // un seul candidat sans tableau
  assert.equal(findColumn(headers, "frais"), 4);
  assert.equal(findColumn(headers, /lib/), 1);
  // introuvable
  assert.equal(findColumn(headers, ["nope", /zzz/]), -1);
  assert.equal(findColumn(headers, []), -1);
  assert.equal(findColumn(headers, [null, undefined, ""]), -1);
  assert.equal(findColumn(headers, null), -1);
  assert.equal(findColumn(null, ["date"]), -1);
  assert.equal(findColumn([], ["date"]), -1);
  // une colonne sans titre n'est jamais trouvée, même par un motif qui accepte tout
  assert.equal(findColumn(["", "A"], [/.*/]), 1);
  // un motif global garde son résultat d'un appel à l'autre
  const sticky = /montant/g;
  assert.equal(findColumn(headers, [sticky]), 2);
  assert.equal(findColumn(headers, [sticky]), 2);
});

test("rowsToObjects", () => {
  const parsed = parseCsv("Date;Libellé;Montant\n\n21/11/2026;Klaviyo;-94,77\n22/11/2026;Shopify\n");
  const objects = rowsToObjects(parsed);
  assert.deepEqual(objects, [
    { Date: "21/11/2026", "Libellé": "Klaviyo", Montant: "-94,77" },
    { Date: "22/11/2026", "Libellé": "Shopify", Montant: "" },
  ]);
  // numéro de ligne du fichier, sans polluer les clés
  assert.equal(objects[0].__line, 3);
  assert.equal(objects[1].__line, 4);
  assert.deepEqual(Object.keys(objects[0]), ["Date", "Libellé", "Montant"]);
  assert.equal(JSON.stringify(objects[0]), '{"Date":"21/11/2026","Libellé":"Klaviyo","Montant":"-94,77"}');
});

test("rowsToObjects : titres en double, vides ou dangereux", () => {
  let objects = rowsToObjects({ headers: ["Amount", "Amount", "", "Amount"], rows: [["1", "2", "3", "4"]] });
  assert.deepEqual(objects, [{ Amount: "1", "Amount (2)": "2", "Colonne 3": "3", "Amount (3)": "4" }]);
  assert.equal(objects[0].__line, null);

  objects = rowsToObjects({ headers: ["__proto__", "constructor", "a"], rows: [["x", "y", "z"]] });
  assert.equal(objects[0].a, "z");
  assert.equal(objects[0].constructor, "y");
  assert.equal(objects[0]["__proto__ (2)"], "x");
  assert.equal(Object.getPrototypeOf(objects[0]), Object.prototype);
  assert.equal({}.a, undefined);

  // ligne plus courte que l'en-tête : cellules manquantes vides
  objects = rowsToObjects({ headers: ["a", "b"], rows: [["1"]], lineNumbers: [7] });
  assert.deepEqual(objects, [{ a: "1", b: "" }]);
  assert.equal(objects[0].__line, 7);

  for (const bad of [null, undefined, {}, { headers: ["a"] }, { rows: "x" }]) assert.deepEqual(rowsToObjects(bad), []);
});

/* ------------------------------------------------------------------ gros fichiers et entrées hostiles */

test("parseCsv : 20 000 lignes lues vite", () => {
  const lines = ["Date,Description,Amount,Currency,Card,Reference,Status,Balance,Note,Category"];
  for (let i = 0; i < 20000; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    lines.push(`2026-11-${day},"MERCHANT ${i}, Inc ""quoted""",-${(i % 500) + 1}.${String(i % 100).padStart(2, "0")},USD,'0562,ref_${i},COMPLETED,"1,234.56",note ${i},cat`);
  }
  const text = lines.join("\r\n") + "\r\n";
  const started = performance.now();
  const parsed = parseCsv(text);
  const objects = rowsToObjects(parsed);
  const elapsed = performance.now() - started;
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.headers.length, 10);
  assert.equal(parsed.rows.length, 20000);
  assert.deepEqual(parsed.rows[0], ["2026-11-01", 'MERCHANT 0, Inc "quoted"', "-1.00", "USD", "0562", "ref_0", "COMPLETED", "1,234.56", "note 0", "cat"]);
  assert.deepEqual(parsed.rows[19999], ["2026-11-08", 'MERCHANT 19999, Inc "quoted"', "-500.99", "USD", "0562", "ref_19999", "COMPLETED", "1,234.56", "note 19999", "cat"]);
  assert.equal(parsed.lineNumbers[19999], 20001);
  assert.deepEqual(parsed.overflowLines, []);
  assert.equal(objects.length, 20000);
  assert.equal(objects[19999].Reference, "ref_19999");
  assert.ok(elapsed < 2000, `trop lent : ${Math.round(elapsed)} ms`);
});

test("parseCsv : 20 000 lignes d'un relevé français en point-virgule avec lignes de titre", () => {
  const lines = ["Relevé du compte 0001;;;", "", "Date;Libellé;Débit;Crédit"];
  for (let i = 0; i < 20000; i++) lines.push(`${String(1 + (i % 28)).padStart(2, "0")}/11/2026;CB COMMERCE ${i};${i % 2 ? "" : "-12,50"};${i % 2 ? "1 234,56" : ""}`);
  const started = performance.now();
  const parsed = parseCsv(lines.join("\n"));
  const elapsed = performance.now() - started;
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Date", "Libellé", "Débit", "Crédit"]);
  assert.equal(parsed.rows.length, 20000);
  assert.deepEqual(parsed.rows[1], ["02/11/2026", "CB COMMERCE 1", "", "1 234,56"]);
  assert.ok(elapsed < 2000, `trop lent : ${Math.round(elapsed)} ms`);
});

test("parseCsv : entrées hostiles traitées en temps linéaire", () => {
  const cases = [
    '"'.repeat(300001),
    "a,b,c\n" + "9".repeat(500000) + "x,1,2\n3,4,5\n",
    "a,b\n" + '"abc,1\n'.repeat(20000),
    "a,b\n" + 'x "y" z,"\n'.repeat(20000),
    "a;b\n" + ";".repeat(300000) + "\n1;2\n",
    " ".repeat(300000) + '"x"' + " ".repeat(300000) + ",1\n",
    ("a".repeat(50) + ",").repeat(20000),
    "=\"".repeat(100000),
    "'".repeat(200000) + ",1\n",
  ];
  // 20 000 guillemets ouvrants jamais refermés : chaque ligne reste une ligne
  assert.equal(parseCsv(cases[2]).rows.length, 20000);
  assert.deepEqual(parseCsv(cases[2]).rows[19999], ['"abc', "1"]);
  for (const text of cases) {
    const started = performance.now();
    const parsed = parseCsv(text);
    rowsToObjects(parsed);
    detectDelimiter(text);
    const elapsed = performance.now() - started;
    assert.ok(Array.isArray(parsed.headers) && Array.isArray(parsed.rows));
    assert.ok(elapsed < 3000, `trop lent : ${Math.round(elapsed)} ms pour ${JSON.stringify(text.slice(0, 20))}`);
  }
});

test("normHeader et findColumn : titres démesurés", () => {
  const huge = "é ".repeat(200000);
  const started = performance.now();
  assert.equal(normHeader(huge).length, 200000 * 2 - 1);
  assert.equal(findColumn([huge, "Montant"], [/^montant$/]), 1);
  assert.ok(performance.now() - started < 2000);
});
