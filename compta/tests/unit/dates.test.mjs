import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidISO, daysInMonth, toISO, todayISO, monthOf, currentMonth, addDays, daysBetween, addMonths, monthStart, monthEnd,
  monthRange, monthLabel, formatDate, parseDateLoose, detectDateOrder, compareISO, inRange,
} from "../../src/core/dates.js";

function checkDates(table, order) {
  for (const [input, expected] of table) {
    assert.equal(parseDateLoose(input, order), expected, `parseDateLoose(${JSON.stringify(input)}${order ? ", " + order : ""})`);
  }
}

test("isValidISO", () => {
  const valid = ["2026-11-21", "2026-01-01", "2026-12-31", "2028-02-29", "2000-02-29", "1999-06-30"];
  const invalid = [
    "2026-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-31", "2026-04-31", "2026-1-5", "26-11-21",
    "2026/11/21", "2026-11-21T10:00:00Z", " 2026-11-21", "", "abc", null, undefined, 20261121, new Date(),
  ];
  for (const iso of valid) assert.equal(isValidISO(iso), true, iso);
  for (const iso of invalid) assert.equal(isValidISO(iso), false, String(iso));
});

test("daysInMonth et toISO", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(toISO(2026, 11, 21), "2026-11-21");
  assert.equal(toISO(2026, 1, 5), "2026-01-05");
  assert.equal(toISO(2026, 2, 30), null);
  assert.equal(toISO(2026, 13, 1), null);
  assert.equal(toISO(2026, 0, 1), null);
  assert.equal(toISO(2026, 6, 0), null);
});

test("todayISO, currentMonth et monthOf", () => {
  assert.equal(todayISO(new Date(2026, 10, 21, 23, 59, 59)), "2026-11-21");
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0, 0)), "2026-01-01");
  assert.equal(todayISO(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");
  assert.equal(currentMonth(new Date(2026, 0, 31)), "2026-01");
  assert.equal(currentMonth(new Date(2026, 11, 1)), "2026-12");
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(monthOf(todayISO()), currentMonth());
  assert.equal(monthOf("2026-11-21"), "2026-11");
  assert.equal(monthOf(null), "");
  assert.equal(monthOf(undefined), "");
});

test("addDays : fins de mois, années, années bissextiles", () => {
  const table = [
    ["2026-11-21", 1, "2026-11-22"], ["2026-11-30", 1, "2026-12-01"], ["2026-12-31", 1, "2027-01-01"], ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"], ["2028-02-29", 1, "2028-03-01"], ["2026-02-28", 1, "2026-03-01"], ["2026-03-01", -1, "2026-02-28"],
    ["2026-11-21", 0, "2026-11-21"], ["2026-01-01", 365, "2027-01-01"], ["2028-01-01", 366, "2029-01-01"], ["2026-11-21", -30, "2026-10-22"],
    // changements d'heure : le calcul est fait en UTC, aucun jour ne saute
    ["2026-03-28", 1, "2026-03-29"], ["2026-03-29", 1, "2026-03-30"], ["2026-10-24", 1, "2026-10-25"], ["2026-10-25", 1, "2026-10-26"],
    ["2026-11-01", 1, "2026-11-02"], ["2026-03-08", 1, "2026-03-09"],
  ];
  for (const [iso, n, expected] of table) assert.equal(addDays(iso, n), expected, `addDays(${iso}, ${n})`);
});

test("daysBetween", () => {
  const table = [
    ["2026-11-21", "2026-11-21", 0], ["2026-11-21", "2026-11-22", 1], ["2026-11-22", "2026-11-21", -1], ["2026-01-01", "2027-01-01", 365],
    ["2028-01-01", "2029-01-01", 366], ["2026-12-31", "2027-01-01", 1], ["2026-09-29", "2026-11-14", 46], ["2026-03-28", "2026-03-30", 2],
    ["2026-10-24", "2026-10-26", 2],
  ];
  for (const [a, b, expected] of table) assert.equal(daysBetween(a, b), expected, `daysBetween(${a}, ${b})`);
  for (const [iso, n] of [["2026-11-21", 400], ["2028-02-29", -800], ["2026-01-31", 59]]) {
    assert.equal(daysBetween(iso, addDays(iso, n)), n);
  }
});

test("addMonths : passages d'année dans les deux sens", () => {
  const table = [
    ["2026-11", 0, "2026-11"], ["2026-11", 1, "2026-12"], ["2026-11", 2, "2027-01"], ["2026-12", 1, "2027-01"], ["2026-01", -1, "2025-12"],
    ["2026-01", 11, "2026-12"], ["2026-01", 12, "2027-01"], ["2026-01", -12, "2025-01"], ["2026-01", -13, "2024-12"], ["2026-03", -15, "2024-12"],
    ["2026-12", -11, "2026-01"], ["2026-12", -12, "2025-12"], ["2026-11", 14, "2028-01"], ["2026-06", 120, "2036-06"], ["2026-06", -120, "2016-06"],
    ["1999-12", 1, "2000-01"], ["2000-01", -1, "1999-12"],
  ];
  for (const [month, n, expected] of table) assert.equal(addMonths(month, n), expected, `addMonths(${month}, ${n})`);
  for (let n = -40; n <= 40; n++) assert.equal(addMonths(addMonths("2026-07", n), -n), "2026-07", `aller-retour ${n}`);
});

test("monthStart, monthEnd", () => {
  assert.equal(monthStart("2026-11"), "2026-11-01");
  const ends = [
    ["2026-01", "2026-01-31"], ["2026-02", "2026-02-28"], ["2028-02", "2028-02-29"], ["2026-04", "2026-04-30"], ["2026-11", "2026-11-30"],
    ["2026-12", "2026-12-31"], ["2100-02", "2100-02-28"], ["2000-02", "2000-02-29"],
  ];
  for (const [month, expected] of ends) {
    assert.equal(monthEnd(month), expected, month);
    assert.equal(isValidISO(monthEnd(month)), true);
    assert.equal(addDays(monthEnd(month), 1), monthStart(addMonths(month, 1)));
  }
});

test("monthRange : bornes incluses, à cheval sur plusieurs années", () => {
  assert.deepEqual(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthRange("2026-11", "2026-11"), ["2026-11"]);
  assert.deepEqual(monthRange("2026-09", "2026-11"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthRange("2027-01", "2026-12"), []);
  assert.deepEqual(monthRange("", "2026-12"), []);
  assert.deepEqual(monthRange("2026-12", null), []);
  const decade = monthRange("2020-01", "2029-12");
  assert.equal(decade.length, 120);
  assert.equal(decade[0], "2020-01");
  assert.equal(decade[12], "2021-01");
  assert.equal(decade[119], "2029-12");
  assert.equal(new Set(decade).size, 120);
  // garde-fou : jamais plus de 600 mois
  assert.equal(monthRange("1900-01", "2100-12").length, 600);
});

test("monthLabel et formatDate", () => {
  const long = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const short = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  for (let m = 1; m <= 12; m++) {
    const month = "2026-" + String(m).padStart(2, "0");
    assert.equal(monthLabel(month), long[m - 1] + " 2026");
    assert.equal(monthLabel(month, true), short[m - 1] + " 2026");
    assert.equal(formatDate(month + "-15"), "15 " + short[m - 1] + " 2026");
    assert.equal(formatDate(month + "-15", "long"), "15 " + long[m - 1] + " 2026");
  }
  assert.equal(monthLabel(""), "");
  assert.equal(monthLabel(null), "");
  assert.equal(formatDate("2026-11-21"), "21 nov. 2026");
  assert.equal(formatDate("2026-11-21", "moyen"), "21 nov. 2026");
  assert.equal(formatDate("2026-11-21", "long"), "21 novembre 2026");
  assert.equal(formatDate("2026-11-21", "court"), "21/11/2026");
  assert.equal(formatDate("2026-03-01"), "1er mars 2026");
  assert.equal(formatDate("2026-03-01", "long"), "1er mars 2026");
  assert.equal(formatDate("2026-03-01", "court"), "01/03/2026");
  assert.equal(formatDate("2026-03-02"), "2 mars 2026");
  for (const bad of ["2026-02-30", "", null, undefined, "21/11/2026"]) assert.equal(formatDate(bad), "");
});

test("parseDateLoose : tous les formats annoncés", () => {
  checkDates([
    ["2026-11-21", "2026-11-21"],
    ["2026-11-21T11:15:29Z", "2026-11-21"],
    ["2026/11/21", "2026-11-21"],
    ["21/11/2026", "2026-11-21"],
    ["21-11-26", "2026-11-21"],
    ["21.11.2026", "2026-11-21"],
    ["Nov 21, 2026", "2026-11-21"],
    ["November 21, 2026 at 3:14 AM PST", "2026-11-21"],
    ["21 nov. 2026", "2026-11-21"],
    ["21 novembre 2026", "2026-11-21"],
    ["1er mars 2026", "2026-03-01"],
  ]);
  checkDates([["11/21/2026", "2026-11-21"]], "MDY");
});

test("parseDateLoose : variantes numériques", () => {
  checkDates([
    ["2026-1-5", "2026-01-05"],
    ["2026-11-21 10:00:00", "2026-11-21"],
    ["2026-11-21T23:30:00-08:00", "2026-11-21"],
    ["2026-11-21T11:15:29.123Z", "2026-11-21"],
    ["2026/1/5", "2026-01-05"],
    ["2026.01.05", "2026-01-05"],
    ["2026/11/21 14:30", "2026-11-21"],
    ["20261121", "2026-11-21"],
    [20261121, "2026-11-21"],
    ["  2026-11-21  ", "2026-11-21"],
    ["1/2/2026", "2026-02-01"],
    ["01/02/2026", "2026-02-01"],
    ["5/6/26", "2026-06-05"],
    ["05.06.1999", "1999-06-05"],
    ["21-11-2026", "2026-11-21"],
    ["21.11.26", "2026-11-21"],
    ["21/11/2026 14:30", "2026-11-21"],
    ["21/11/2026, 14:30", "2026-11-21"],
    ["21/11/2026T14:30", "2026-11-21"],
    ["29/02/2028", "2028-02-29"],
    ["31/12/2026", "2026-12-31"],
  ]);
});

test("parseDateLoose : années sur deux chiffres", () => {
  checkDates([
    ["01/01/00", "2000-01-01"], ["01/01/26", "2026-01-01"], ["01/01/69", "2069-01-01"], ["01/01/70", "1970-01-01"], ["31/12/99", "1999-12-31"],
  ]);
});

test("parseDateLoose : mois en toutes lettres, français et anglais", () => {
  const fr = [
    ["janvier", "janv."], ["février", "févr."], ["mars", "mars"], ["avril", "avr."], ["mai", "mai"], ["juin", "juin"],
    ["juillet", "juil."], ["août", "août"], ["septembre", "sept."], ["octobre", "oct."], ["novembre", "nov."], ["décembre", "déc."],
  ];
  const en = [
    ["January", "Jan"], ["February", "Feb"], ["March", "Mar"], ["April", "Apr"], ["May", "May"], ["June", "Jun"],
    ["July", "Jul"], ["August", "Aug"], ["September", "Sep"], ["October", "Oct"], ["November", "Nov"], ["December", "Dec"],
  ];
  for (let m = 1; m <= 12; m++) {
    const expected = "2026-" + String(m).padStart(2, "0") + "-07";
    for (const name of fr[m - 1]) {
      assert.equal(parseDateLoose("7 " + name + " 2026"), expected, name);
      assert.equal(parseDateLoose("7 " + name.toUpperCase() + " 2026"), expected, name.toUpperCase());
    }
    for (const name of en[m - 1]) {
      assert.equal(parseDateLoose(name + " 7, 2026"), expected, name);
      assert.equal(parseDateLoose(name + " 7 2026"), expected, name);
      assert.equal(parseDateLoose("7 " + name + " 2026"), expected, name);
      assert.equal(parseDateLoose(name.toUpperCase() + " 07, 2026"), expected, name.toUpperCase());
    }
    // la date affichée par formatDate se relit
    assert.equal(parseDateLoose(formatDate(expected)), expected);
    assert.equal(parseDateLoose(formatDate(expected, "long")), expected);
    assert.equal(parseDateLoose(formatDate(expected, "court")), expected);
  }
  checkDates([
    ["Sept 30, 2026", "2026-09-30"],
    ["Sept. 30, 2026", "2026-09-30"],
    ["Paid September 30, 2026", "2026-09-30"],
    ["Sat, Nov 21, 2026", "2026-11-21"],
    ["Sat Nov 21 2026", "2026-11-21"],
    ["21st November 2026", "2026-11-21"],
    ["November 21st, 2026", "2026-11-21"],
    ["1st Jan 2026", "2026-01-01"],
    ["2nd Feb 2026", "2026-02-02"],
    ["3rd Mar 2026", "2026-03-03"],
    ["4th Apr 2026", "2026-04-04"],
    ["1er janvier 2026", "2026-01-01"],
    ["samedi 21 novembre 2026", "2026-11-21"],
    ["le 21 nov. 2026 à 14h30", "2026-11-21"],
    ["November 21, 2026 at 3:14:10 AM PST", "2026-11-21"],
    ["21 Nov 2026 10:00", "2026-11-21"],
    ["Nov 2026", "2026-11-01"],
    ["novembre 2026", "2026-11-01"],
    ["févr. 2028", "2028-02-01"],
  ]);
});

test("parseDateLoose : ordre jour/mois (DMY contre MDY)", () => {
  // ambigu : l'ordre demandé décide
  assert.equal(parseDateLoose("01/02/2026"), "2026-02-01");
  assert.equal(parseDateLoose("01/02/2026", "DMY"), "2026-02-01");
  assert.equal(parseDateLoose("01/02/2026", "MDY"), "2026-01-02");
  assert.equal(parseDateLoose("5/6/26", "MDY"), "2026-05-06");
  assert.equal(parseDateLoose("12/11/2026", "MDY"), "2026-12-11");
  assert.equal(parseDateLoose("12/11/2026", "DMY"), "2026-11-12");
  // non ambigu : un "mois" supérieur à 12 est forcément le jour, quel que soit l'ordre demandé
  assert.equal(parseDateLoose("11/21/2026"), "2026-11-21");
  assert.equal(parseDateLoose("11/21/2026", "DMY"), "2026-11-21");
  assert.equal(parseDateLoose("21/11/2026", "MDY"), "2026-11-21");
  assert.equal(parseDateLoose("12/31/99", "MDY"), "1999-12-31");
  assert.equal(parseDateLoose("12/31/99"), "1999-12-31");
  // l'ordre ne change rien aux formats qui commencent par l'année ni aux mois en lettres
  assert.equal(parseDateLoose("2026-02-01", "MDY"), "2026-02-01");
  assert.equal(parseDateLoose("2026/02/01", "MDY"), "2026-02-01");
  assert.equal(parseDateLoose("Feb 1, 2026", "DMY"), "2026-02-01");
  assert.equal(parseDateLoose("21/11/2026", "YMD"), "2026-11-21");
});

test("parseDateLoose : dates impossibles et textes illisibles", () => {
  checkDates([
    ["", null], ["   ", null], [null, null], [undefined, null], ["abc", null], ["n/a", null],
    ["31/02/2026", null], ["29/02/2026", null], ["2026-02-30", null], ["2026-13-01", null], ["2026-00-10", null], ["2026-04-31", null],
    ["00/01/2026", null], ["32/01/2026", null], ["13/13/2026", null], ["31/04/2026", null], ["0/0/0000", null],
    ["21/11", null], ["2026", null], ["21/11/202", null], ["21/11/20261", null], ["99999999", null], ["20261340", null],
    ["Foo 21, 2026", null], ["31 février 2026", null], ["February 30, 2026", null], ["21 2026", null], ["12:30", null],
  ]);
  checkDates([["02/30/2026", null], ["13/32/2026", null]], "MDY");
});

test("parseDateLoose : objets Date", () => {
  assert.equal(parseDateLoose(new Date(2026, 10, 21, 23, 59)), "2026-11-21");
  assert.equal(parseDateLoose(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
  assert.equal(parseDateLoose(new Date(NaN)), null);
});

test("detectDateOrder", () => {
  const table = [
    [["2026-11-21", "2026-11-22"], "YMD"],
    [["2026/11/21 10:00", "2026.11.22"], "YMD"],
    [["21/11/2026", "01/02/2026"], "DMY"],
    [["21.11.26", "22.11.26"], "DMY"],
    [["11/21/2026", "01/02/2026"], "MDY"],
    [["11/21/2026 10:00", "11/22/2026 11:00"], "MDY"],
    [["1/13/26", "2/1/26", "3/4/26"], "MDY"],
    // rien ne tranche : jour d'abord
    [["01/02/2026", "03/04/2026"], "DMY"],
    [[], "DMY"],
    [["", null, undefined, "abc", "Nov 21, 2026"], "DMY"],
    // majorité
    [["13/01/2026", "01/13/2026", "01/14/2026"], "MDY"],
    [["13/01/2026", "14/01/2026", "01/14/2026"], "DMY"],
    [["13/01/2026", "01/13/2026"], "DMY"],
    [["2026-11-21", "21/11/2026", "22/11/2026"], "DMY"],
    [["2026-11-21", "2026-11-22", "21/11/2026"], "YMD"],
  ];
  for (const [samples, expected] of table) assert.equal(detectDateOrder(samples), expected, JSON.stringify(samples));
  assert.equal(detectDateOrder(new Set(["11/30/2026"])), "MDY");
});

test("detectDateOrder puis parseDateLoose lisent une colonne entière", () => {
  const us = ["11/01/2026", "11/02/2026", "11/13/2026", "11/21/2026"];
  const fr = ["01/11/2026", "02/11/2026", "13/11/2026", "21/11/2026"];
  const expected = ["2026-11-01", "2026-11-02", "2026-11-13", "2026-11-21"];
  assert.deepEqual(us.map((s) => parseDateLoose(s, detectDateOrder(us))), expected);
  assert.deepEqual(fr.map((s) => parseDateLoose(s, detectDateOrder(fr))), expected);
});

test("compareISO et inRange", () => {
  assert.equal(compareISO("2026-11-21", "2026-11-21"), 0);
  assert.equal(compareISO("2026-11-20", "2026-11-21"), -1);
  assert.equal(compareISO("2027-01-01", "2026-12-31"), 1);
  assert.deepEqual(["2027-01-01", "2026-12-31", "2026-02-01", "2026-11-21"].sort(compareISO), ["2026-02-01", "2026-11-21", "2026-12-31", "2027-01-01"]);
  assert.equal(inRange("2026-11-21", "2026-11-01", "2026-11-30"), true);
  assert.equal(inRange("2026-11-01", "2026-11-01", "2026-11-30"), true);
  assert.equal(inRange("2026-11-30", "2026-11-01", "2026-11-30"), true);
  assert.equal(inRange("2026-10-31", "2026-11-01", "2026-11-30"), false);
  assert.equal(inRange("2026-12-01", "2026-11-01", "2026-11-30"), false);
  assert.equal(inRange("2026-11-21", null, "2026-11-30"), true);
  assert.equal(inRange("2026-11-21", "2026-11-01", null), true);
  assert.equal(inRange("2026-11-21", undefined, undefined), true);
  assert.equal(inRange("2026-11-21", "", ""), true);
  assert.equal(inRange("2026-12-01", null, "2026-11-30"), false);
  assert.equal(inRange("2026-10-31", "2026-11-01", null), false);
});
