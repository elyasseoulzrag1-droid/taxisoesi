import test from "node:test";
import assert from "node:assert/strict";
import { settlementPlan } from "../../src/core/settlement.js";
import { buildBook } from "../../src/core/ledger.js";
import { buildSeed } from "../../dev/seed.js";

function applyPlan(balances, cash, plan) {
  const b = { ...balances };
  let c = cash;
  for (const pay of plan.payments) {
    if (pay.from === "business") c -= pay.cents; else b[pay.from] += pay.cents;
    if (pay.to === "business") c += pay.cents; else b[pay.to] -= pay.cents;
  }
  return { b, c };
}

test("settlementPlan : chaque associé retombe à zéro quand la trésorerie suffit", () => {
  const book = { businessCashCents: 100000, partners: { a: { netCents: 60000, equityCents: 70000 }, b: { netCents: -20000, equityCents: -10000 }, c: { netCents: 30000, equityCents: 40000 } } };
  for (const mode of ["nets", "all"]) {
    const key = mode === "all" ? "equityCents" : "netCents";
    const plan = settlementPlan(book, { mode });
    const start = Object.fromEntries(Object.entries(book.partners).map(([id, p]) => [id, p[key]]));
    const { b, c } = applyPlan(start, book.businessCashCents, plan);
    assert.deepEqual(b, { a: 0, b: 0, c: 0 });
    assert.equal(plan.shortfallCents, 0);
    assert.equal(c, plan.cashAfterCents);
    assert.ok(plan.payments.every((p) => p.cents > 0 && p.from !== p.to));
  }
});

test("settlementPlan : trésorerie insuffisante, les associés débiteurs paient, le reste est signalé", () => {
  const book = { businessCashCents: 1000, partners: { a: { netCents: 5000 }, b: { netCents: -1500 } } };
  const plan = settlementPlan(book, { mode: "nets" });
  assert.deepEqual(plan.payments, [
    { from: "business", to: "a", cents: 1000 },
    { from: "b", to: "a", cents: 1500 },
  ]);
  assert.equal(plan.shortfallCents, 2500);
});

test("settlementPlan : rien à faire quand tout est à zéro, et les comptes non attribués sont ignorés", () => {
  const plan = settlementPlan({ businessCashCents: 0, partners: { a: { netCents: 0, equityCents: 0 }, unknown: { netCents: 900, equityCents: 900 } } });
  assert.deepEqual(plan.payments, []);
  assert.equal(plan.shortfallCents, 0);
});

test("settlementPlan : sur le jeu de démonstration, tout solder ramène les trois associés à zéro (hors comptes non attribués)", () => {
  const seed = buildSeed();
  const book = buildBook(seed.config, seed.ops);
  const plan = settlementPlan(book, { mode: "all" });
  const start = {};
  for (const [id, p] of Object.entries(book.partners)) if (id !== "unknown") start[id] = p.equityCents;
  const { b } = applyPlan(start, Math.max(0, book.businessCashCents), plan);
  const left = Object.values(b).reduce((s, v) => s + Math.max(0, v), 0);
  assert.equal(left, plan.shortfallCents);
  assert.ok(Object.values(b).every((v) => v >= 0));
});
