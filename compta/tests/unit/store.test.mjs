// Le vrai Store, exercé contre les deux supports : le bouchon de la base Claude et le localStorage (faux stockage).
import test from "node:test";
import assert from "node:assert/strict";
import "../../dev/mock-claude.js";
import { createStore, diffPatch, DUMP_FORMAT } from "../../src/platform/store.js";
import { createClaudeBackend } from "../../src/platform/backend-claude.js";
import { createLocalBackend, LOCAL_PREFIX } from "../../src/platform/backend-local.js";
import { PlatformError } from "../../src/platform/errors.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** Enveloppe un backend : journal des écritures, pannes injectées, latence, détection des écritures simultanées. */
function instrument(backend) {
  const ctl = { log: [], overlaps: 0, delayMs: 0, fails: [] };
  const active = new Map();
  const run = (op, path, data) => {
    ctl.log.push({ op, path, data });
    const running = active.get(path) || 0;
    if (running) ctl.overlaps++;
    active.set(path, running + 1);
    const rule = ctl.fails.find((f) => !f.match || f.match(op, path));
    if (rule && --rule.count <= 0) ctl.fails.splice(ctl.fails.indexOf(rule), 1);
    const promise = (async () => {
      if (ctl.delayMs) await tick(ctl.delayMs);
      if (rule) throw { code: rule.code, message: "panne injectée" };
      return op === "delete" ? backend.delete(path) : backend[op](path, data);
    })();
    const done = () => active.set(path, active.get(path) - 1);
    promise.then(done, done);
    return promise;
  };
  ctl.failNext = (code, count = 1, match = null) => ctl.fails.push({ code, count, match });
  ctl.backend = {
    kind: backend.kind,
    listen: (...args) => backend.listen(...args),
    set: (path, data) => run("set", path, data),
    update: (path, data) => run("update", path, data),
    delete: (path) => run("delete", path),
  };
  return ctl;
}

const FAST = { retryDelayMs: 1, rateRetryDelayMs: 1, loadTimeoutMs: 2000, writeWaitMs: 2000 };

async function claudeEnv(storeOptions = {}, mockOptions = {}) {
  const { claude, mock } = globalThis.__createMockClaude({ persist: false, ...mockOptions });
  const db = await claude.use("db");
  const ctl = instrument(createClaudeBackend(db));
  const store = createStore(ctl.backend, { ...FAST, ...storeOptions });
  return { name: "claude", store, ctl, mock, dump: () => mock.db.dump(), seed: (docs) => mock.db.load(docs) };
}

async function localEnv(storeOptions = {}) {
  const storage = fakeStorage();
  const target = { addEventListener(type, fn) { this[type] = fn; } };
  const ctl = instrument(createLocalBackend({ storage, target }));
  const store = createStore(ctl.backend, { ...FAST, ...storeOptions });
  const dump = () => {
    const out = {};
    for (const key of [...storage.map.keys()].sort()) out[key.slice(LOCAL_PREFIX.length)] = JSON.parse(storage.map.get(key));
    return out;
  };
  // Comme si un autre onglet avait écrit : on modifie le stockage puis on émet l'événement "storage".
  const seed = (docs) => {
    for (const path of Object.keys(docs)) {
      storage.setItem(LOCAL_PREFIX + path, JSON.stringify(docs[path]));
      target.storage({ key: LOCAL_PREFIX + path });
    }
  };
  return { name: "local", store, ctl, storage, dump, seed };
}

const ENVS = [["base Claude (bouchon)", claudeEnv], ["localStorage", localEnv]];

function op(id, date, extra = {}) {
  return { id, kind: "pl", date, label: "Opération " + id, accountId: "acc_main", amountCents: -1234, currency: "USD", categoryId: "software", ...extra };
}

/** Attend le premier instantané chargé. */
async function ready(store) {
  for (let i = 0; i < 200; i++) {
    if (store.getSnapshot().loaded) return store.getSnapshot();
    await tick(2);
  }
  throw new Error("le store n'a jamais chargé");
}

for (const [label, makeEnv] of ENVS) {
  test(`[${label}] chaque opération va dans le document de son mois`, async () => {
    const env = await makeEnv();
    await env.store.putOps([op("op_a", "2026-09-29"), op("op_b", "2026-10-15"), op("op_c", "2026-11-21"), op("op_d", "2026-11-02")]);
    const docs = env.dump();
    assert.deepEqual(Object.keys(docs).sort(), ["ledger/2026-09", "ledger/2026-10", "ledger/2026-11"]);
    assert.equal(docs["ledger/2026-11"].v, 1);
    assert.equal(docs["ledger/2026-11"].month, "2026-11");
    assert.deepEqual(Object.keys(docs["ledger/2026-11"].ops).sort(), ["op_c", "op_d"]);
    const snap = env.store.getSnapshot();
    assert.deepEqual(snap.ops.map((o) => o.id), ["op_a", "op_b", "op_d", "op_c"], "tri par date puis identifiant");
    assert.equal(snap.ops[0].label, "Opération op_a");
    env.store.close();
  });

  test(`[${label}] 500 opérations sur 6 mois : 6 écritures, une seule notification`, async () => {
    const env = await makeEnv();
    await ready(env.store);
    const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
    const ops = [];
    for (let i = 0; i < 500; i++) ops.push(op("op_" + String(i).padStart(4, "0"), months[i % 6] + "-" + String((i % 27) + 1).padStart(2, "0")));
    let notifications = 0;
    const off = env.store.subscribe(() => { notifications++; });
    notifications = 0;
    await env.store.putOps(ops);
    await env.store.flush();
    await tick(10);
    off();
    assert.equal(env.ctl.log.length, 6, "une écriture par mois");
    assert.ok(env.ctl.log.every((w) => w.op === "set"));
    assert.equal(env.ctl.overlaps, 0);
    assert.equal(env.store.getSnapshot().ops.length, 500);
    assert.equal(notifications, 1, "une rafale = une notification");

    // Modifier 10 opérations réparties sur 2 mois : 2 écritures de plus, en update.
    env.ctl.log.length = 0;
    const edits = ops.filter((o) => o.date.startsWith("2026-06") || o.date.startsWith("2026-07")).slice(0, 10).map((o) => ({ ...o, label: "Modifiée" }));
    await env.store.putOps(edits);
    assert.equal(env.ctl.log.length, 2);
    assert.ok(env.ctl.log.every((w) => w.op === "update"));
    env.store.close();
  });

  test(`[${label}] un mois trop gros déborde dans des fragments .2, .3`, async () => {
    const env = await makeEnv({ softLimitBytes: 2000, hardLimitBytes: 2600 });
    const ops = [];
    for (let i = 0; i < 30; i++) ops.push(op("op_" + String(i).padStart(2, "0"), "2026-11-10"));
    await env.store.putOps(ops);
    const docs = env.dump();
    const ids = Object.keys(docs).sort();
    assert.ok(ids.length >= 3, "au moins trois fragments : " + ids.join(", "));
    assert.equal(ids[0], "ledger/2026-11");
    assert.equal(ids[1], "ledger/2026-11.2");
    assert.equal(ids[2], "ledger/2026-11.3");
    for (const id of ids) {
      assert.ok(JSON.stringify(docs[id]).length <= 2000, id + " reste sous la limite souple");
      assert.equal(docs[id].month, "2026-11");
    }
    assert.equal(env.store.getSnapshot().ops.length, 30);
    assert.equal(env.ctl.log.length, ids.length, "une écriture par fragment");

    // Une opération existante est mise à jour sur place, dans son fragment.
    const holder = ids.find((id) => docs[id].ops.op_00);
    env.ctl.log.length = 0;
    await env.store.putOps([{ ...ops[0], label: "Sur place" }]);
    assert.deepEqual(env.ctl.log.map((w) => [w.op, w.path]), [["update", holder]]);
    assert.equal(env.dump()[holder].ops.op_00.label, "Sur place");

    // Une nouvelle opération va dans le premier fragment qui a de la place (ou un nouveau).
    await env.store.putOps([op("op_new", "2026-11-11")]);
    const after = env.dump();
    const where = Object.keys(after).filter((id) => after[id].ops.op_new);
    assert.equal(where.length, 1);
    assert.equal(env.store.getSnapshot().ops.length, 31);
    env.store.close();
  });

  test(`[${label}] changer le mois d'une opération la déplace (marque de suppression dans l'ancien document)`, async () => {
    const env = await makeEnv();
    await env.store.putOps([op("op_m", "2026-10-30", { updatedAt: "2026-10-30T10:00:00.000Z" }), op("op_stay", "2026-10-12")]);
    env.ctl.log.length = 0;
    await env.store.putOps([op("op_m", "2026-11-02", { updatedAt: "2026-11-02T09:00:00.000Z" })]);
    assert.deepEqual(env.ctl.log.map((w) => [w.op, w.path]), [["set", "ledger/2026-11"], ["update", "ledger/2026-10"]], "le nouveau d'abord, l'effacement ensuite");
    const docs = env.dump();
    assert.equal(docs["ledger/2026-10"].ops.op_m, null);
    assert.equal(docs["ledger/2026-11"].ops.op_m.date, "2026-11-02");
    const snap = env.store.getSnapshot();
    assert.deepEqual(snap.ops.map((o) => [o.id, o.date]), [["op_stay", "2026-10-12"], ["op_m", "2026-11-02"]]);

    // Si l'écriture du nouveau mois échoue, l'ancienne copie n'est pas effacée.
    env.ctl.log.length = 0;
    env.ctl.failNext("quota_exceeded", 1, (kind, path) => path === "ledger/2026-12");
    await assert.rejects(env.store.putOps([op("op_m", "2026-12-01")]), (err) => err instanceof PlatformError && err.code === "quota_exceeded");
    await env.store.flush();
    assert.equal(env.dump()["ledger/2026-11"].ops.op_m.date, "2026-11-02", "rien perdu");
    assert.ok(!env.ctl.log.some((w) => w.path === "ledger/2026-11"), "aucun effacement tenté");
    assert.deepEqual(env.store.getSnapshot().ops.map((o) => [o.id, o.date]), [["op_stay", "2026-10-12"], ["op_m", "2026-11-02"]]);
    env.store.close();
  });

  test(`[${label}] un champ retiré est écrit à null et disparaît de l'instantané`, async () => {
    const env = await makeEnv();
    const full = op("op_f", "2026-11-05", {
      note: "à revoir", party: "Klaviyo Inc", needsReview: true,
      meta: { payoutId: "p1", feesCents: 120 },
      attachments: [{ id: "a1", name: "recu.pdf", type: "application/pdf", size: 10 }],
      splits: [{ categoryId: "software", amountCents: -1234 }],
    });
    await env.store.putOps([full]);
    const { note, needsReview, splits, ...rest } = full;
    await env.store.putOps([{ ...rest, meta: { payoutId: "p1" }, attachments: [] }]);
    const stored = env.dump()["ledger/2026-11"].ops.op_f;
    assert.equal(stored.note, null);
    assert.equal(stored.needsReview, null);
    assert.equal(stored.splits, null);
    assert.deepEqual(stored.meta, { payoutId: "p1", feesCents: null });
    assert.deepEqual(stored.attachments, []);
    const live = env.store.getSnapshot().ops[0];
    assert.ok(!("note" in live) && !("needsReview" in live) && !("splits" in live));
    assert.deepEqual(live.meta, { payoutId: "p1" });
    assert.equal(live.party, "Klaviyo Inc");
    // Une valeur null passée par l'appelant vaut "champ absent".
    await env.store.putOps([{ ...rest, party: null, meta: { payoutId: "p1" }, attachments: [] }]);
    assert.ok(!("party" in env.store.getSnapshot().ops[0]));
    env.store.close();
  });

  test(`[${label}] supprimer des opérations`, async () => {
    const env = await makeEnv();
    await env.store.putOps([op("op_1", "2026-11-01"), op("op_2", "2026-11-02"), op("op_3", "2026-10-02")]);
    env.ctl.log.length = 0;
    await env.store.deleteOps(["op_1", "op_3", "inconnue"]);
    assert.equal(env.ctl.log.length, 2, "une écriture par document touché");
    const docs = env.dump();
    assert.equal(docs["ledger/2026-11"].ops.op_1, null);
    assert.equal(docs["ledger/2026-10"].ops.op_3, null);
    assert.deepEqual(env.store.getSnapshot().ops.map((o) => o.id), ["op_2"]);
    env.ctl.log.length = 0;
    await env.store.deleteOps(["inconnue"]);
    assert.equal(env.ctl.log.length, 0);
    // Recréer une opération supprimée fonctionne (l'objet remplace la marque null).
    await env.store.putOps([op("op_1", "2026-11-01", { label: "Revenue" })]);
    assert.equal(env.dump()["ledger/2026-11"].ops.op_1.label, "Revenue");
    env.store.close();
  });

  test(`[${label}] une écriture à la fois par document, dans l'ordre`, async () => {
    const env = await makeEnv();
    await env.store.putOps([op("op_q", "2026-11-01")]);
    env.ctl.delayMs = 8;
    env.ctl.log.length = 0;
    const calls = [];
    for (let i = 1; i <= 5; i++) calls.push(env.store.putOps([op("op_q", "2026-11-01", { label: "Version " + i }), op("op_q" + i, "2026-11-0" + i)]));
    await Promise.all(calls);
    assert.equal(env.ctl.overlaps, 0, "jamais deux écritures en même temps sur le même document");
    assert.ok(env.ctl.log.length <= 5 && env.ctl.log.length >= 1);
    assert.ok(env.ctl.log.length <= 2, "les écritures en attente sont regroupées : " + env.ctl.log.length);
    const stored = env.dump()["ledger/2026-11"].ops;
    assert.equal(stored.op_q.label, "Version 5", "la dernière gagne");
    assert.equal(Object.keys(stored).length, 6);
    // Supprimer puis recréer tout de suite : deux écritures distinctes, dans l'ordre.
    env.ctl.log.length = 0;
    const gone = env.store.deleteOps(["op_q"]);
    const back = env.store.putOps([op("op_q", "2026-11-01", { label: "Recréée" })]);
    await Promise.all([gone, back]);
    assert.equal(env.ctl.overlaps, 0);
    assert.equal(env.dump()["ledger/2026-11"].ops.op_q.label, "Recréée");
    assert.equal(env.dump()["ledger/2026-11"].ops.op_q.amountCents, -1234, "l'opération recréée est complète");
    assert.equal(env.ctl.log.length, 2);
    env.store.close();
  });

  test(`[${label}] écho local immédiat, puis retour arrière si la base refuse`, async () => {
    const env = await makeEnv();
    await ready(env.store);
    await tick(5);
    env.ctl.delayMs = 25;
    const seen = [];
    const off = env.store.subscribe((snap) => seen.push(snap.ops.length));
    const pending = env.store.putOps([op("op_e", "2026-11-21")]);
    await tick(8);
    assert.equal(env.store.getSnapshot().ops.length, 1, "visible avant la réponse de la base");
    assert.equal(env.dump()["ledger/2026-11"], undefined, "pas encore écrit");
    await pending;
    assert.equal(env.dump()["ledger/2026-11"].ops.op_e.id, "op_e");

    env.ctl.failNext("quota_exceeded");
    const refused = env.store.putOps([op("op_ko", "2026-11-22")]);
    await tick(8);
    assert.equal(env.store.getSnapshot().ops.length, 2, "écho de l'opération en cours");
    await assert.rejects(refused, (err) => {
      assert.ok(err instanceof PlatformError);
      assert.equal(err.code, "quota_exceeded");
      assert.match(err.message, /stockage est plein/);
      return true;
    });
    await tick(5);
    assert.deepEqual(env.store.getSnapshot().ops.map((o) => o.id), ["op_e"], "l'écho est retiré");
    assert.equal(env.store.getSnapshot().readOnly, false);
    off();
    assert.deepEqual(seen, [0, 1, 2, 1]);
    env.store.close();
  });

  test(`[${label}] "unavailable" : une seule nouvelle tentative`, async () => {
    const env = await makeEnv();
    env.ctl.failNext("unavailable", 1);
    await env.store.putOps([op("op_r", "2026-11-21")]);
    assert.equal(env.ctl.log.length, 2);
    assert.equal(env.store.getSnapshot().ops.length, 1);
    env.ctl.log.length = 0;
    env.ctl.failNext("unavailable", 2);
    await assert.rejects(env.store.putOps([op("op_r2", "2026-11-21")]), (err) => err.code === "unavailable" && /ne répond pas/.test(err.message));
    assert.equal(env.ctl.log.length, 2);
    env.ctl.failNext("code_inconnu", 2);
    await assert.rejects(env.store.putOps([op("op_r3", "2026-11-21")]), (err) => err.code === "unavailable");
    env.ctl.failNext("resource_exhausted", 2);
    await assert.rejects(env.store.putOps([op("op_r4", "2026-11-21")]), (err) => err.code === "resource_exhausted" && /Attends/.test(err.message));
    assert.deepEqual(env.store.getSnapshot().ops.map((o) => o.id), ["op_r"]);
    env.store.close();
  });

  test(`[${label}] un écrit bien formé refusé (invalid_argument) fait passer en lecture seule`, async () => {
    const env = await makeEnv();
    await ready(env.store);
    assert.equal(env.store.getSnapshot().readOnly, false);
    env.ctl.failNext("invalid_argument");
    await assert.rejects(env.store.putOps([op("op_ro", "2026-11-21")]), (err) => err.code === "read_only" && /lecture seule/.test(err.message));
    await tick(2);
    const snap = env.store.getSnapshot();
    assert.equal(snap.readOnly, true);
    assert.equal(snap.ops.length, 0);
    env.ctl.log.length = 0;
    await assert.rejects(env.store.saveConfig({ onboarded: true }), (err) => err.code === "read_only");
    await assert.rejects(env.store.deleteOps(["x"]), (err) => err.code === "read_only");
    await assert.rejects(env.store.putStats("2026-11", { shopify: {} }), (err) => err.code === "read_only");
    await env.store.addAudit({ action: "create", summary: "ignoré en lecture seule" });
    assert.equal(env.ctl.log.length, 0, "plus aucun appel à la base");
    env.store.close();

    const fixed = await makeEnv({ readOnly: true });
    await assert.rejects(fixed.store.putOps([op("op_x", "2026-11-21")]), (err) => err.code === "read_only");
    fixed.store.setReadOnly(false);
    await fixed.store.putOps([op("op_x", "2026-11-21")]);
    assert.equal(fixed.store.getSnapshot().ops.length, 1);
    fixed.store.close();
  });

  test(`[${label}] l'identité de ops et des autres vues reste stable quand rien n'a changé pour elles`, async () => {
    const env = await makeEnv();
    await env.store.putOps([op("op_1", "2026-11-01"), op("op_2", "2026-11-02"), op("op_3", "2026-10-03")]);
    await env.store.putStats("2026-11", { shopify: { days: { "01": { orders: 3 } } } });
    await env.store.flush();
    await tick(10);
    const before = env.store.getSnapshot();
    assert.ok(Object.isFrozen(before) && Object.isFrozen(before.ops) && Object.isFrozen(before.ops[0]));
    await env.store.saveConfig({ business: { name: "StarringYou" } });
    await tick(10);
    const after = env.store.getSnapshot();
    assert.notEqual(after, before);
    assert.equal(after.config.business.name, "StarringYou");
    assert.equal(after.ops, before.ops, "ops garde la même référence");
    assert.equal(after.statsByMonth, before.statsByMonth);
    assert.equal(after.audit, before.audit);
    assert.equal(after.ignored, before.ignored);

    // Réécrire une opération identique : aucune écriture, aucune nouvelle référence.
    env.ctl.log.length = 0;
    await env.store.putOps([op("op_1", "2026-11-01")]);
    await env.store.saveConfig({ business: { name: "StarringYou" } });
    await tick(10);
    assert.equal(env.ctl.log.length, 0);
    assert.equal(env.store.getSnapshot(), after, "même instantané");

    // Modifier une opération : les autres objets gardent leur identité.
    await env.store.putOps([op("op_2", "2026-11-02", { label: "Changée" })]);
    await tick(10);
    const last = env.store.getSnapshot();
    assert.notEqual(last.ops, after.ops);
    assert.equal(last.ops.find((o) => o.id === "op_1"), after.ops.find((o) => o.id === "op_1"));
    assert.equal(last.ops.find((o) => o.id === "op_3"), after.ops.find((o) => o.id === "op_3"));
    assert.equal(last.config, after.config);
    env.store.close();
  });

  test(`[${label}] réglages : création, fusion profonde, null pour retirer`, async () => {
    const env = await makeEnv();
    const first = await ready(env.store);
    assert.equal(first.config, null);
    await env.store.saveConfig({ onboarded: false, business: { name: "StarringYou", baseCurrency: "USD" }, accounts: { a1: { id: "a1", name: "Slash", cards: ["0562"] }, a2: { id: "a2", name: "Revolut" } } });
    assert.equal(env.dump()["config/main"].v, 1);
    await env.store.saveConfig({ business: { baseCurrency: "EUR" }, accounts: { a2: null, a1: { cards: ["0562", "2487"] } }, closed: { "2026-10": { at: "2026-11-01T08:00:00.000Z", by: null } } });
    const stored = env.dump()["config/main"];
    assert.equal(stored.business.name, "StarringYou");
    assert.equal(stored.business.baseCurrency, "EUR");
    assert.equal(stored.accounts.a2, null);
    assert.deepEqual(stored.accounts.a1.cards, ["0562", "2487"]);
    const config = env.store.getSnapshot().config;
    assert.equal(config.accounts.a2, null, "la config est livrée brute : les normaliseurs retirent les null");
    assert.equal(config.closed["2026-10"].at, "2026-11-01T08:00:00.000Z");
    await assert.rejects(env.store.saveConfig("x"), (err) => err.code === "invalid");
    // diffPatch : de l'ancienne config vers la nouvelle, sans oublier les clés retirées.
    const next = { ...JSON.parse(JSON.stringify(config)), accounts: { a1: { id: "a1", name: "Slash USD", cards: ["0562"] } } };
    delete next.closed;
    const patch = diffPatch(config, next);
    assert.deepEqual(patch, { accounts: { a1: { name: "Slash USD", cards: ["0562"] } }, closed: null });
    await env.store.saveConfig(patch);
    assert.equal(env.store.getSnapshot().config.accounts.a1.name, "Slash USD");
    env.store.close();
  });

  test(`[${label}] statistiques et lignes ignorées`, async () => {
    const env = await makeEnv();
    await env.store.putStats("2026-11", { shopify: { days: { "01": { orders: 3, grossCents: 9000, currency: "USD" } } } });
    await env.store.putStats("2026-11", { shopify: { days: { "02": { orders: 1 } } }, ads: { meta: { days: { "01": { spendCents: 5000, currency: "USD" } } } } });
    const stats = env.store.getSnapshot().statsByMonth;
    assert.deepEqual(Object.keys(stats), ["2026-11"]);
    assert.equal(stats["2026-11"].month, "2026-11");
    assert.equal(stats["2026-11"].shopify.days["01"].orders, 3);
    assert.equal(stats["2026-11"].shopify.days["02"].orders, 1);
    assert.equal(stats["2026-11"].ads.meta.days["01"].spendCents, 5000);
    await assert.rejects(env.store.putStats("novembre", {}), (err) => err.code === "invalid");

    await env.store.setIgnored(["h1", "h2"], "2026-11-21");
    await env.store.setIgnored(["h3"], "2026-11-22");
    assert.deepEqual(env.store.getSnapshot().ignored, { h1: "2026-11-21", h2: "2026-11-21", h3: "2026-11-22" });
    await env.store.setIgnored(["h2"], null);
    assert.deepEqual(env.store.getSnapshot().ignored, { h1: "2026-11-21", h3: "2026-11-22" });
    assert.equal(env.dump()["meta/ignored"].hashes.h2, null);
    env.store.close();
  });

  test(`[${label}] journal : plafonné par mois, le plus récent d'abord, ne rejette jamais`, async () => {
    const env = await makeEnv({ auditCap: 5 });
    for (let i = 1; i <= 8; i++) {
      await env.store.addAudit({ id: "au_" + i, at: `2026-11-0${i}T10:00:00.000Z`, by: null, action: "create", summary: "Entrée " + i });
    }
    let audit = env.store.getSnapshot().audit;
    assert.deepEqual(audit.map((e) => e.id), ["au_8", "au_7", "au_6", "au_5", "au_4"]);
    const stored = env.dump()["audit/2026-11"].entries;
    assert.equal(stored.au_1, null);
    assert.equal(stored.au_8.summary, "Entrée 8");
    // Beaucoup d'entrées : le document est réécrit au propre, il ne grossit pas sans fin.
    for (let i = 9; i <= 30; i++) {
      await env.store.addAudit({ id: "au_" + i, at: `2026-11-${String(i).padStart(2, "0")}T10:00:00.000Z`, action: "update", summary: "Entrée " + i });
    }
    audit = env.store.getSnapshot().audit;
    assert.equal(audit.length, 5);
    assert.equal(audit[0].id, "au_30");
    assert.ok(Object.keys(env.dump()["audit/2026-11"].entries).length <= 11, "marques de suppression bornées");
    // Sans identifiant ni date : complétés. Une panne n'est jamais propagée.
    await env.store.addAudit({ action: "config", summary: "Sans date" });
    env.ctl.failNext("quota_exceeded", 5);
    await env.store.addAudit({ action: "config", summary: "Perdue" });
    await env.store.addAudit(null);
    env.ctl.fails.length = 0;
    const months = Object.keys(env.dump()).filter((p) => p.startsWith("audit/"));
    assert.ok(months.length >= 1);
    env.store.close();
  });

  test(`[${label}] sauvegarde puis restauration (remplacement et fusion)`, async () => {
    const source = await makeEnv();
    await source.store.saveConfig({ onboarded: true, business: { name: "StarringYou", baseCurrency: "USD" }, partners: { p1: { id: "p1", name: "Associé 1", sharePct: 40 } } });
    await source.store.putOps([
      op("op_1", "2026-09-29", { label: "Lancement" }), op("op_2", "2026-10-10"),
      op("op_3", "2026-11-14", { kind: "transfer", fromAccountId: "acc_p3", toAccountId: "acc_main", amountCents: 500000 }),
    ]);
    await source.store.putStats("2026-10", { shopify: { days: { "10": { orders: 2 } } } });
    await source.store.setIgnored(["hash1"], "2026-11-20");
    await source.store.deleteOps(["op_2"]);
    const dump = await source.store.exportAll();
    assert.equal(dump.format, DUMP_FORMAT);
    assert.equal(dump.version, 1);
    assert.match(dump.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(dump.ops.map((o) => o.id), ["op_1", "op_3"]);
    assert.equal(dump.config.business.name, "StarringYou");
    assert.equal(dump.statsByMonth["2026-10"].shopify.days["10"].orders, 2);
    assert.ok(!Object.isFrozen(dump) && !Object.isFrozen(dump.ops), "la sauvegarde est une copie modifiable");
    const text = JSON.stringify(dump);
    source.store.close();

    // Remplacement : ce qui existait disparaît.
    const target = await makeEnv();
    await target.store.saveConfig({ onboarded: false, business: { name: "Ancien" }, demo: true });
    await target.store.putOps([op("op_old", "2026-08-01"), op("op_1", "2026-09-29", { label: "Ancienne version" })]);
    await target.store.putStats("2026-08", { shopify: { days: { "01": { orders: 9 } } } });
    const result = await target.store.importAll(JSON.parse(text), { replace: true });
    assert.deepEqual(result, { ops: 2 });
    await target.store.flush();
    await tick(10);
    let snap = target.store.getSnapshot();
    assert.deepEqual(snap.ops, dump.ops);
    assert.deepEqual(snap.config, dump.config);
    assert.equal(snap.config.demo, undefined);
    assert.deepEqual(Object.keys(snap.statsByMonth), ["2026-10"]);
    assert.deepEqual(snap.ignored, { hash1: "2026-11-20" });
    const paths = Object.keys(target.dump());
    assert.ok(!paths.includes("ledger/2026-08") && !paths.includes("stats/2026-08") && !paths.includes("ledger/2026-10"));
    const again = await target.store.exportAll();
    assert.deepEqual({ ...again, exportedAt: "" }, { ...dump, exportedAt: "" }, "aller-retour sans perte");
    target.store.close();

    // Fusion : on garde l'existant, la sauvegarde gagne sur les identifiants communs.
    const merged = await makeEnv();
    await merged.store.saveConfig({ business: { name: "Ancien", vat: true } });
    await merged.store.putOps([op("op_old", "2026-08-01"), op("op_1", "2026-08-15", { label: "Ancienne version", note: "à effacer" })]);
    const res = await merged.store.importAll(JSON.parse(text), { replace: false });
    assert.deepEqual(res, { ops: 2 });
    snap = merged.store.getSnapshot();
    assert.deepEqual(snap.ops.map((o) => o.id), ["op_old", "op_1", "op_3"]);
    const moved = snap.ops.find((o) => o.id === "op_1");
    assert.equal(moved.label, "Lancement");
    assert.equal(moved.date, "2026-09-29");
    assert.ok(!("note" in moved));
    assert.equal(snap.config.business.name, "StarringYou");
    assert.equal(snap.config.business.vat, true);
    assert.equal(merged.dump()["ledger/2026-08"].ops.op_1, null);

    await assert.rejects(merged.store.importAll({ format: "autre" }), (err) => err.code === "bad_dump" && /sauvegarde/.test(err.message));
    await assert.rejects(merged.store.importAll({ format: DUMP_FORMAT, version: 99 }), (err) => err.code === "bad_dump");
    const partial = await merged.store.importAll({ format: DUMP_FORMAT, version: 1, ops: [op("ok", "2026-11-01"), { id: "sans date" }, null, op("__proto__", "2026-11-01")] });
    assert.deepEqual(partial, { ops: 1 });
    merged.store.close();
  });

  test(`[${label}] deux copies de la même opération : la plus récente gagne, la suivante écriture nettoie`, async () => {
    const env = await makeEnv();
    env.seed({
      "ledger/2026-10": { v: 1, month: "2026-10", ops: { op_d: op("op_d", "2026-10-30", { label: "Vieille copie", updatedAt: "2026-10-30T10:00:00.000Z" }), op_x: null } },
      "ledger/2026-11": { v: 1, month: "2026-11", ops: { op_d: op("op_d", "2026-11-01", { label: "Bonne copie", updatedAt: "2026-11-01T10:00:00.000Z" }) } },
      "ledger/2026-11.2": { v: 1, month: "2026-11", ops: { op_e: op("op_e", "2026-11-03") } },
    });
    await tick(10);
    let snap = await ready(env.store);
    await tick(10);
    snap = env.store.getSnapshot();
    assert.deepEqual(snap.ops.map((o) => [o.id, o.label]), [["op_d", "Bonne copie"], ["op_e", "Opération op_e"]]);
    await env.store.putOps([op("op_d", "2026-11-01", { label: "Corrigée", updatedAt: "2026-11-05T10:00:00.000Z" })]);
    const docs = env.dump();
    assert.equal(docs["ledger/2026-10"].ops.op_d, null, "la copie en trop est effacée");
    assert.equal(docs["ledger/2026-11"].ops.op_d.label, "Corrigée");
    await env.store.deleteOps(["op_e"]);
    assert.equal(env.dump()["ledger/2026-11.2"].ops.op_e, null);
    env.store.close();
  });

  test(`[${label}] entrées invalides refusées avec un message clair`, async () => {
    const env = await makeEnv();
    await assert.rejects(env.store.putOps([{ id: "", date: "2026-11-01" }]), (err) => err.code === "invalid_op" && /identifiant ou une date/.test(err.message));
    await assert.rejects(env.store.putOps([op("op_1", "2026-13-01")]), (err) => err.code === "invalid_op");
    await assert.rejects(env.store.putOps("op_1"), (err) => err.code === "invalid_op");
    await assert.rejects(env.store.putOps([op("op_big", "2026-11-01", { note: "x".repeat(70000) })]), (err) => err.code === "too_large" && /trop volumineuse/.test(err.message));
    await env.store.putOps([]);
    assert.equal(env.ctl.log.length, 0);
    env.store.close();
  });
}

// ---------------------------------------------------------------- propre à la base Claude (bouchon)

test("[base Claude] la limite de 256 Kio par document est respectée grâce aux fragments", async () => {
  const env = await claudeEnv();
  const ops = [];
  for (let i = 0; i < 1500; i++) ops.push(op("op_" + String(i).padStart(5, "0"), "2026-11-15", { note: "n".repeat(180) }));
  await env.store.putOps(ops);
  const docs = env.dump();
  const ids = Object.keys(docs);
  assert.ok(ids.length >= 3, ids.join(", "));
  for (const id of ids) assert.ok(JSON.stringify(docs[id]).length < 200 * 1024, id);
  assert.ok(env.mock.db.writes.every((w) => w.ok));
  assert.equal(env.mock.db.overlaps, 0);
  assert.equal(env.store.getSnapshot().ops.length, 1500);
  env.store.close();
});

test("[base Claude] un document trop gros refusé par la base n'est pas pris pour de la lecture seule", async () => {
  const env = await claudeEnv({ softLimitBytes: 10 ** 7, hardLimitBytes: 10 ** 7 });
  const ops = [];
  for (let i = 0; i < 1200; i++) ops.push(op("op_" + String(i).padStart(5, "0"), "2026-11-15", { note: "n".repeat(180) }));
  await assert.rejects(env.store.putOps(ops), (err) => err.code === "too_large" && /trop volumineux/.test(err.message));
  assert.equal(env.store.getSnapshot().readOnly, false);
  assert.equal(env.store.getSnapshot().ops.length, 0);
  env.store.close();
});

test("[base Claude] visiteur en lecture seule : le premier écrit refusé bascule l'appli", async () => {
  const env = await claudeEnv({}, { role: "viewer", can: null, seed: { "config/main": { v: 1, onboarded: true } } });
  const snap = await ready(env.store);
  assert.equal(snap.config.onboarded, true);
  assert.equal(snap.readOnly, false, "la plateforme n'a rien dit : on laisse un écrit trancher");
  await assert.rejects(env.store.putOps([op("op_1", "2026-11-01")]), (err) => err.code === "read_only");
  await assert.rejects(env.store.saveConfig({ onboarded: false }), (err) => err.code === "read_only");
  assert.equal(env.store.getSnapshot().readOnly, true);
  assert.equal(env.store.getSnapshot().config.onboarded, true);
  env.store.close();
});

test("[base Claude] les écrits d'un autre visiteur arrivent en direct", async () => {
  const { claude, mock } = globalThis.__createMockClaude({ persist: false });
  const db = await claude.use("db");
  const a = createStore(createClaudeBackend(db), FAST);
  const b = createStore(createClaudeBackend(db), FAST);
  await a.putOps([op("op_1", "2026-11-01")]);
  await tick(10);
  assert.deepEqual(b.getSnapshot().ops.map((o) => o.id), ["op_1"]);
  await b.putOps([op("op_2", "2026-11-02")]);
  await tick(10);
  assert.deepEqual(a.getSnapshot().ops.map((o) => o.id), ["op_1", "op_2"]);
  assert.equal(Object.keys(mock.db.dump()["ledger/2026-11"].ops).length, 2);
  mock.reset();
  await tick(10);
  assert.equal(a.getSnapshot().ops.length, 0);
  a.close();
  b.close();
});

// ---------------------------------------------------------------- chargement, fraîcheur, erreurs d'abonnement

function manualBackend() {
  const handlers = {};
  const calls = [];
  return {
    handlers, calls,
    backend: {
      kind: "manual",
      listen(col, onDocs, onError) { handlers[col] = { onDocs, onError }; return () => { handlers[col] = null; }; },
      async set(path, data) { calls.push(["set", path, data]); },
      async update(path, data) { calls.push(["update", path, data]); },
      async delete(path) { calls.push(["delete", path]); },
    },
  };
}

test("chargement : prêt quand config et ledger ont répondu, stale après le délai", async () => {
  const m = manualBackend();
  const store = createStore(m.backend, { loadTimeoutMs: 30, writeWaitMs: 20 });
  let snap = store.getSnapshot();
  assert.deepEqual([snap.ready, snap.loaded, snap.stale, snap.error], [false, false, false, null]);
  assert.deepEqual(Object.keys(m.handlers).sort(), ["audit", "config", "ledger", "meta", "stats"], "un abonnement par collection");

  m.handlers.config.onDocs([{ id: "main", data: { v: 1, onboarded: true } }], { fromCache: true });
  snap = store.getSnapshot();
  assert.equal(snap.ready, false, "le grand livre n'a pas encore répondu");
  m.handlers.ledger.onDocs([{ id: "2026-11", data: { v: 1, month: "2026-11", ops: { op_1: op("op_1", "2026-11-01") } } }], { fromCache: true });
  snap = store.getSnapshot();
  assert.deepEqual([snap.ready, snap.loaded, snap.stale, snap.ops.length], [true, true, false, 1]);

  // Rien de définitif : écrire attend, puis refuse proprement.
  await assert.rejects(store.putOps([op("op_2", "2026-11-02")]), (err) => err.code === "offline" && /Connexion/.test(err.message));
  assert.equal(m.calls.length, 0);

  await tick(40);
  snap = store.getSnapshot();
  assert.equal(snap.stale, true, "copie locale seulement après 10 s (ici 30 ms)");
  assert.equal(snap.ready, true);

  m.handlers.config.onDocs([{ id: "main", data: { v: 1, onboarded: true } }], { fromCache: false });
  m.handlers.ledger.onDocs([{ id: "2026-11", data: { v: 1, month: "2026-11", ops: { op_1: op("op_1", "2026-11-01") } } }], { fromCache: false });
  snap = store.getSnapshot();
  assert.equal(snap.stale, false, "une réponse définitive efface l'avertissement");
  for (const name of ["stats", "audit", "meta"]) m.handlers[name].onDocs([], { fromCache: false });
  await store.putOps([op("op_2", "2026-11-02")]);
  assert.deepEqual(m.calls.map((c) => [c[0], c[1]]), [["update", "ledger/2026-11"]]);

  // Coupure après coup : nos propres écrits en attente ne comptent pas, une vraie copie locale si, mais on peut encore écrire.
  const fresh = [{ id: "2026-11", data: { v: 1, month: "2026-11", ops: { op_1: op("op_1", "2026-11-01"), op_2: op("op_2", "2026-11-02") } } }];
  m.handlers.ledger.onDocs(fresh, { fromCache: true, pending: true });
  await tick(40);
  assert.equal(store.getSnapshot().stale, false);
  m.handlers.ledger.onDocs(fresh, { fromCache: true, pending: false });
  await tick(40);
  assert.equal(store.getSnapshot().stale, true, "copie locale depuis trop longtemps");
  await store.putOps([op("op_3", "2026-11-03")]);
  assert.equal(m.calls.length, 2);
  m.handlers.ledger.onDocs(fresh, { fromCache: false });
  assert.equal(store.getSnapshot().stale, false);
  store.close();
});

test("abonnement coupé par unavailable : un nouvel abonnement est ouvert tout seul", async () => {
  const m = manualBackend();
  const store = createStore(m.backend, { loadTimeoutMs: 1000, writeWaitMs: 20, resubscribeDelayMs: 10 });
  for (const name of ["config", "ledger", "stats", "audit", "meta"]) m.handlers[name].onDocs([], { fromCache: false });
  const before = m.handlers.ledger;
  before.onError({ code: "unavailable", message: "host stopped answering" });
  assert.equal(store.getSnapshot().error.code, "unavailable");
  assert.equal(store.getSnapshot().stale, true);
  await tick(30);
  assert.notEqual(m.handlers.ledger, before, "nouvel abonnement");
  assert.equal(store.getSnapshot().error, null);
  m.handlers.ledger.onDocs([], { fromCache: false });
  assert.equal(store.getSnapshot().stale, false);
  store.close();
});

test("chargement : sans aucune réponse, prêt mais vide et stale après le délai", async () => {
  const m = manualBackend();
  const store = createStore(m.backend, { loadTimeoutMs: 20, writeWaitMs: 10 });
  const seen = [];
  store.subscribe((snap) => seen.push([snap.ready, snap.loaded, snap.stale]));
  await tick(40);
  assert.deepEqual(seen, [[false, false, false], [true, false, true]]);
  assert.equal(store.getSnapshot().error.code, "offline", "rien reçu : on le dit, ce n'est pas un premier lancement");
  assert.match(store.getSnapshot().error.message, /pas joignables/);
  await assert.rejects(store.saveConfig({ onboarded: true }), (err) => err.code === "offline");
  // Dès que la base répond, l'avertissement disparaît.
  for (const name of ["config", "ledger"]) m.handlers[name].onDocs([], { fromCache: false });
  assert.deepEqual([store.getSnapshot().error, store.getSnapshot().stale, store.getSnapshot().loaded], [null, false, true]);
  await assert.rejects(store.exportAll(), (err) => err.code === "offline");
  store.close();
});

test("abonnement interrompu : erreur en français dans l'instantané, puis retry()", async () => {
  const m = manualBackend();
  const store = createStore(m.backend, { loadTimeoutMs: 1000, writeWaitMs: 20 });
  m.handlers.config.onDocs([], { fromCache: false });
  m.handlers.ledger.onError({ code: "revoked", message: "grant withdrawn" });
  let snap = store.getSnapshot();
  assert.equal(snap.ready, true, "l'erreur met fin au chargement");
  assert.equal(snap.error.code, "revoked");
  assert.match(snap.error.message, /Recharge la page/);
  assert.equal(snap.stale, true);
  await assert.rejects(store.putOps([op("op_1", "2026-11-01")]), (err) => err.code === "revoked");

  m.handlers.stats.onError({ code: "mystere" });
  assert.equal(store.getSnapshot().error.code, "revoked", "la première erreur reste affichée");

  store.retry();
  assert.equal(store.getSnapshot().error, null);
  m.handlers.ledger.onDocs([], { fromCache: false });
  m.handlers.stats.onDocs([], { fromCache: false });
  snap = store.getSnapshot();
  assert.deepEqual([snap.ready, snap.stale, snap.error], [true, false, null]);
  store.close();
  await assert.rejects(store.putOps([op("op_1", "2026-11-01")]), (err) => err.code === "closed");
});

// ---------------------------------------------------------------- propre au mode local

test("[localStorage] clés préfixées, autre onglet, données abîmées", async () => {
  const storage = fakeStorage();
  const target = { addEventListener(type, fn) { this[type] = fn; } };
  storage.setItem("autre-appli", "x");
  storage.setItem(LOCAL_PREFIX + "ledger/2026-09", "{pas du json");
  storage.setItem(LOCAL_PREFIX + "ledger/2026-08", JSON.stringify([1, 2]));
  const store = createStore(createLocalBackend({ storage, target }), FAST);
  await store.putOps([op("op_1", "2026-11-01")]);
  await store.saveConfig({ onboarded: true });
  const keys = [...storage.map.keys()].filter((k) => k.startsWith("sy-compta:")).sort();
  assert.deepEqual(keys, ["sy-compta:db:config/main", "sy-compta:db:ledger/2026-08", "sy-compta:db:ledger/2026-09", "sy-compta:db:ledger/2026-11"]);
  assert.equal(storage.getItem("autre-appli"), "x");
  assert.equal(store.getSnapshot().ops.length, 1, "les documents illisibles sont ignorés");

  // Un autre onglet écrit dans le même stockage.
  const other = createStore(createLocalBackend({ storage, target: null }), FAST);
  await other.putOps([op("op_2", "2026-11-02")]);
  assert.equal(store.getSnapshot().ops.length, 1);
  target.storage({ key: LOCAL_PREFIX + "ledger/2026-11" });
  await tick(5);
  assert.deepEqual(store.getSnapshot().ops.map((o) => o.id), ["op_1", "op_2"]);
  storage.map.clear();
  target.storage({ key: null });
  await tick(5);
  assert.equal(store.getSnapshot().ops.length, 0);
  assert.equal(store.getSnapshot().config, null);
  store.close();
  other.close();
});

test("[localStorage] stockage indisponible ou plein", async () => {
  const broken = { get length() { throw new Error("interdit"); }, key() { throw new Error("interdit"); }, getItem() { throw new Error("interdit"); }, setItem() { throw new Error("interdit"); }, removeItem() { throw new Error("interdit"); } };
  const volatile = createLocalBackend({ storage: broken, target: null });
  assert.equal(volatile.persistent, false, "repli en mémoire");
  const store = createStore(volatile, FAST);
  await store.putOps([op("op_1", "2026-11-01")]);
  assert.equal(store.getSnapshot().ops.length, 1);
  store.close();

  const storage = fakeStorage();
  let full = false;
  const guarded = { ...storage, get length() { return storage.length; }, setItem(k, v) { if (full) throw new Error("QuotaExceededError"); storage.setItem(k, v); } };
  const backend = createLocalBackend({ storage: guarded, target: null });
  assert.equal(backend.persistent, true);
  const limited = createStore(backend, FAST);
  await limited.putOps([op("op_1", "2026-11-01")]);
  full = true;
  await assert.rejects(limited.putOps([op("op_2", "2026-11-02")]), (err) => err.code === "quota_exceeded" && /plein/.test(err.message));
  assert.deepEqual(limited.getSnapshot().ops.map((o) => o.id), ["op_1"]);
  assert.equal(limited.getSnapshot().readOnly, false);
  limited.close();
});
