// Le bouchon de développement doit se comporter comme les contrats des capacités (db, user, assets, downloads, sample).
import test from "node:test";
import assert from "node:assert/strict";
import "../../dev/mock-claude.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const create = (options = {}) => globalThis.__createMockClaude({ persist: false, ...options });
const rejectsWith = (promise, code) => assert.rejects(promise, (err) => {
  assert.equal(err.code, code, JSON.stringify(err));
  assert.equal(typeof err.message, "string");
  return true;
});

test("use() : promesse mémorisée, jamais synchrone, null pour une capacité absente", async () => {
  const { claude } = create({ capabilities: ["db", "user"] });
  assert.deepEqual(Object.keys(claude), ["use"], "rien d'autre que use sur window.claude");
  assert.ok(Object.isFrozen(claude));
  let resolved = false;
  const first = claude.use("db");
  first.then(() => { resolved = true; });
  assert.equal(resolved, false);
  assert.equal(claude.use("db"), first, "même promesse à chaque appel");
  const db = await first;
  assert.ok(Object.isFrozen(db));
  assert.equal(await claude.use("sample"), null);
  assert.equal(await claude.use("mcp"), null);
  assert.equal(await claude.use("inconnue"), null);
  assert.equal(globalThis.claude, undefined, "rien d'installé globalement dans Node");
});

test("db : grammaire des chemins", async () => {
  const db = await create().claude.use("db");
  assert.throws(() => db.doc("ledger"), TypeError);
  assert.throws(() => db.doc("ledger/2026-11/ops"), TypeError);
  assert.throws(() => db.collection("ledger/2026-11"), TypeError);
  assert.throws(() => db.doc("ledger/a b"), TypeError);
  assert.throws(() => db.doc("ledger/.."), TypeError);
  assert.throws(() => db.doc("ledger//x"), TypeError);
  assert.equal(db.doc("ledger/2026-11.2").id, "2026-11.2");
  assert.equal(db.collection("ledger").doc("2026-11").path, "ledger/2026-11");
  assert.equal(db.doc("config/main").collection("notes").path, "config/main/notes");
  assert.equal(db.collection("config").doc().id.length, 20);
});

test("db : set remplace, update fusionne récursivement et exige que le document existe", async () => {
  const { claude, mock } = create();
  const db = await claude.use("db");
  const ref = db.doc("config/main");
  let snap = await ref.get();
  assert.equal(snap.exists, false);
  assert.equal(snap.data(), undefined);
  await rejectsWith(ref.update({ a: 1 }), "invalid_argument");
  await ref.set({ a: 1, nested: { x: 1, y: { z: 1 } }, list: [1, 2, 3] });
  await ref.update({ nested: { y: { w: 2 }, x: null }, list: [9], b: { c: 1 } });
  snap = await ref.get();
  assert.deepEqual(snap.data(), { a: 1, nested: { x: null, y: { z: 1, w: 2 } }, list: [9], b: { c: 1 } });
  await ref.set({ only: true });
  assert.deepEqual((await ref.get()).data(), { only: true });
  await ref.delete();
  await ref.delete();
  assert.equal((await ref.get()).exists, false);
  await rejectsWith(ref.set([1, 2]), "invalid_argument");
  await rejectsWith(ref.set("texte"), "invalid_argument");
  await rejectsWith(ref.set(null), "invalid_argument");
  assert.deepEqual(mock.db.writes.map((w) => [w.op, w.ok]), [
    ["update", false], ["set", true], ["update", true], ["set", true], ["delete", true], ["delete", true],
    ["set", false], ["set", false], ["set", false],
  ]);
});

test("db : limite de 256 Kio et de 32 niveaux", async () => {
  const db = await create().claude.use("db");
  const ref = db.doc("ledger/2026-11");
  await ref.set({ text: "x".repeat(256 * 1024 - 20) });
  await rejectsWith(ref.set({ text: "x".repeat(256 * 1024) }), "invalid_argument");
  await rejectsWith(ref.update({ more: "y".repeat(100) }), "invalid_argument");
  assert.equal((await ref.get()).data().more, undefined, "un écrit refusé ne change rien");
  await rejectsWith(ref.set({ text: "é".repeat(140 * 1024) }), "invalid_argument");
  let deep = { leaf: 1 };
  for (let i = 0; i < 40; i++) deep = { deep };
  await rejectsWith(db.doc("x/deep").set(deep), "invalid_argument");
});

test("db : instantanés gelés, livrés après coup, mêmes objets quand rien n'a changé, ordre par identifiant", async () => {
  const { claude } = create();
  const db = await claude.use("db");
  await db.doc("ledger/2026-11").set({ month: "2026-11", n: 1 });
  await db.doc("ledger/2026-09").set({ month: "2026-09", n: 2 });
  await db.doc("ledger/2026-10").set({ month: "2026-10", n: 3 });
  await db.doc("ledger/2026-10/sub/x").set({ nested: true });
  const seen = [];
  const off = db.collection("ledger").onSnapshot((snap) => seen.push(snap));
  assert.equal(seen.length, 0, "jamais de rappel synchrone");
  await tick();
  assert.equal(seen.length, 1);
  const first = seen[0];
  assert.deepEqual(first.docs.map((d) => d.id), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(first.size, 3);
  assert.equal(first.empty, false);
  assert.deepEqual(first.metadata, { fromCache: false, hasPendingWrites: false });
  assert.deepEqual(first.docChanges().map((c) => c.type), ["added", "added", "added"]);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.docs) && Object.isFrozen(first.docs[0]) && Object.isFrozen(first.docs[0].data()));
  assert.throws(() => { first.docs[0].data().n = 99; }, TypeError);

  await db.doc("ledger/2026-10").update({ n: 30 });
  await tick();
  assert.equal(seen.length, 2);
  const second = seen[1];
  assert.equal(second.docs[0], first.docs[0], "document inchangé : même objet");
  assert.equal(second.docs[0].data(), first.docs[0].data());
  assert.notEqual(second.docs[1], first.docs[1]);
  assert.deepEqual(second.docChanges().map((c) => [c.type, c.doc.id, c.oldIndex, c.newIndex]), [["modified", "2026-10", 1, 1]]);

  await db.doc("ledger/2026-09").delete();
  await db.doc("autre/doc").set({ a: 1 });
  await tick();
  assert.equal(seen.length, 3, "un écrit ailleurs ne réveille pas cet abonné");
  assert.deepEqual(seen[2].docChanges().map((c) => [c.type, c.doc.id, c.oldIndex, c.newIndex]), [["removed", "2026-09", 0, -1], ["modified", "2026-10", 1, 0], ["modified", "2026-11", 2, 1]]);
  off();
  off();
  await db.doc("ledger/2026-12").set({ n: 4 });
  await tick();
  assert.equal(seen.length, 3, "plus rien après le désabonnement");
});

test("db : abonnement à un document, filtres, tri, limite", async () => {
  const db = await create().claude.use("db");
  const col = db.collection("tasks");
  await col.doc("a").set({ rank: 3, tag: "x", tags: ["u", "v"] });
  await col.doc("b").set({ rank: 1, tag: "y" });
  await col.doc("c").set({ rank: 2, tag: "x" });
  await col.doc("d").set({ tag: "x" });
  const ids = async (query) => (await query.get()).docs.map((d) => d.id);
  assert.deepEqual(await ids(col.where("tag", "==", "x")), ["a", "c", "d"]);
  assert.deepEqual(await ids(col.where("rank", ">=", 2)), ["a", "c"]);
  assert.deepEqual(await ids(col.where("tag", "in", ["y", "z"])), ["b"]);
  assert.deepEqual(await ids(col.where("tags", "array-contains", "v")), ["a"]);
  assert.deepEqual(await ids(col.orderBy("rank")), ["b", "c", "a", "d"], "champ absent : en dernier");
  assert.deepEqual(await ids(col.orderBy("rank", "desc").limit(2)), ["a", "c"]);
  await rejectsWith(col.limit(0).get(), "invalid_argument");
  await rejectsWith(col.limit(1001).get(), "invalid_argument");
  await rejectsWith(col.orderBy("rank").orderBy("tag").get(), "invalid_argument");

  const states = [];
  const off = db.doc("tasks/zz").onSnapshot((snap) => states.push(snap.exists ? snap.data().v : null));
  await tick();
  await db.doc("tasks/zz").set({ v: 1 });
  await tick();
  await db.doc("tasks/zz").delete();
  await tick();
  off();
  assert.deepEqual(states, [null, 1, null]);

  const added = await col.add({ rank: 9 });
  assert.equal((await added.get()).data().rank, 9);
});

test("db : visiteur sans droit d'écriture, pannes injectées, plafond d'abonnements", async () => {
  const { claude, mock } = create({ role: "viewer", seed: { "config/main": { v: 1 } } });
  const db = await claude.use("db");
  assert.deepEqual((await db.doc("config/main").get()).data(), { v: 1 }, "la lecture reste possible");
  await rejectsWith(db.doc("config/main").set({ v: 2 }), "invalid_argument");
  await rejectsWith(db.doc("config/main").update({ v: 2 }), "invalid_argument");
  await rejectsWith(db.doc("config/main").delete(), "invalid_argument");
  mock.setRole("owner");
  mock.db.failNext("unavailable");
  await rejectsWith(db.doc("config/main").set({ v: 2 }), "unavailable");
  await db.doc("config/main").set({ v: 3 });
  assert.equal(mock.db.get("config/main").v, 3);

  const offs = [];
  for (let i = 0; i < 64; i++) offs.push(db.doc("config/main").onSnapshot(() => {}));
  const errors = [];
  db.collection("config").onSnapshot(() => assert.fail("pas de livraison"), (err) => errors.push(err.code));
  await tick();
  assert.deepEqual(errors, ["resource_exhausted"]);
  offs.forEach((off) => off());

  // Base injoignable puis copie locale : rien, puis fromCache, puis réponse définitive.
  const metas = [];
  mock.db.hold = true;
  const off = db.collection("config").onSnapshot((snap) => metas.push(snap.metadata.fromCache));
  await tick();
  assert.deepEqual(metas, []);
  mock.db.hold = false;
  mock.db.cacheOnly = true;
  mock.db.refresh();
  await tick();
  mock.db.cacheOnly = false;
  mock.db.refresh();
  await tick();
  off();
  assert.deepEqual(metas, [true, false]);
});

test("db : écritures simultanées sur un même document repérées, reset()", async () => {
  const { claude, mock } = create({ latencyMs: 5 });
  const db = await claude.use("db");
  const ref = db.doc("config/main");
  await Promise.all([ref.set({ a: 1 }), ref.set({ a: 2 })]);
  assert.equal(mock.db.overlaps, 1);
  await ref.set({ a: 3 });
  assert.equal(mock.db.overlaps, 1);
  const seen = [];
  db.collection("config").onSnapshot((snap) => seen.push(snap.size));
  await tick(10);
  mock.reset();
  await tick(10);
  assert.deepEqual(seen, [1, 0]);
  assert.deepEqual(mock.db.dump(), {});
  assert.equal(mock.db.writes.length, 0);
});

test("user : rôles, can(), profils", async () => {
  const owner = await create().claude.use("user");
  const me = await owner.me();
  assert.deepEqual([me.id, me.name, me.isOwner, me.canEdit, me.email], ["u_demo_owner", "Alex", true, true, null]);
  assert.match(me.avatarUrl, /^data:image\/svg\+xml,/);
  assert.equal(await owner.can("data.write"), true);
  assert.equal(await owner.can("nimporte.quoi"), false);
  assert.equal(await owner.id(), me.id);
  const profiles = await owner.profiles(["u_demo_owner", "u_demo_investor", "u_inconnu"]);
  assert.deepEqual(Object.keys(profiles), ["u_demo_owner", "u_demo_investor", "u_inconnu"]);
  assert.equal(profiles.u_demo_investor.name, "Sam");
  assert.equal(profiles.u_inconnu.name, "");
  assert.equal(profiles.u_demo_owner.isMe, true);

  const contributor = await create({ role: "contributor" }).claude.use("user");
  assert.deepEqual([await contributor.isOwner(), await contributor.canEdit(), await contributor.can("data.write"), await contributor.can("assets.write")], [false, false, true, false]);
  const viewer = create({ role: "viewer" });
  assert.equal(await (await viewer.claude.use("user")).can("data.write"), false);
  assert.equal(await viewer.claude.use("assets"), null, "pas de capacité assets sans droit de modification");
  const silent = await create({ can: null }).claude.use("user");
  assert.equal(await silent.can("data.write"), null);
});

test("assets : envoi, types refusés, suppression", async () => {
  const { claude, mock } = create();
  const assets = await claude.use("assets");
  const result = await assets.upload(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  assert.match(result.id, /^[0-9a-f]{32}$/);
  assert.deepEqual([result.sizeBytes, result.contentType, result.url], [8, "application/pdf", "/_blob/" + result.id]);
  const typed = await assets.upload(new Blob(["abc"]), { type: "image/png" });
  assert.equal(typed.contentType, "image/png");
  await rejectsWith(assets.upload(new Blob(["abc"], { type: "image/heic" })), "unsupported_type");
  await rejectsWith(assets.upload(new Blob(["abc"], { type: "text/plain;charset=utf-8" })), "unsupported_type");
  await rejectsWith(assets.upload(new Blob([])), "invalid_request");
  await rejectsWith(assets.upload("pas un blob"), "invalid_request");
  const listing = await assets.list();
  assert.equal(listing.assets.length, 2);
  assert.equal(listing.usage.bytes, 11);
  assert.deepEqual(await assets.delete(result.id), { deleted: true });
  assert.deepEqual(await assets.delete(result.id), { deleted: false });
  mock.assets.limits.maxFiles = 1;
  await rejectsWith(assets.upload(new Blob(["abc"], { type: "image/png" })), "quota_or_state");
});

test("downloads : confirmation, refus, extensions", async () => {
  const { claude, mock } = create();
  const downloads = await claude.use("downloads");
  assert.deepEqual(await downloads.save({ filename: "journal.csv", data: "a;b\r\n1;2" }), { status: "saved" });
  await downloads.save({ filename: "export.json", data: new Blob(['{"a":1}']) });
  await downloads.save({ filename: "classeur.xlsx", data: new Uint8Array([80, 75, 3, 4]).buffer });
  assert.deepEqual(mock.downloads.map((d) => [d.filename, d.size, d.text]), [["journal.csv", 8, "a;b\r\n1;2"], ["export.json", 7, '{"a":1}'], ["classeur.xlsx", 4, null]]);
  await rejectsWith(downloads.save({ filename: "page.exe", data: "x" }), "rejected_extension");
  await rejectsWith(downloads.save({ filename: "sans-extension", data: "x" }), "rejected_extension");
  await rejectsWith(downloads.save({ filename: "vide.csv", data: "" }), "bad_request");
  await rejectsWith(downloads.save({ filename: 12, data: "x" }), "bad_request");
  mock.downloadDecision = "decline";
  await rejectsWith(downloads.save({ filename: "journal.csv", data: "x" }), "declined");
  mock.downloadDecision = "rate_limited";
  await rejectsWith(downloads.save({ filename: "journal.csv", data: "x" }), "rate_limited");
  assert.equal(mock.downloads.length, 3);
});

test("sample : validation, flux, JSON tolérant, consentement, annulation", async () => {
  const { claude, mock } = create();
  const sample = await claude.use("sample");
  assert.equal(typeof sample, "function");
  assert.ok(Object.isFrozen(sample));
  const limits = await sample.limits();
  assert.equal(limits.maxPromptBytes, 262144);
  assert.ok(limits.images.maxCount >= 1 && limits.tools.maxCount >= 1);

  await rejectsWith(sample(""), "invalid_request");
  await rejectsWith(sample({ prompt: "ancienne forme" }), "invalid_request");
  await rejectsWith(sample([{ role: "assistant", content: "x" }]), "invalid_request");
  await rejectsWith(sample([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), "invalid_request");
  await rejectsWith(sample([{ role: "system", content: "a" }, { role: "user", content: "b" }]), "invalid_request");
  await rejectsWith(sample("bonjour", new AbortController()), "invalid_request");
  await rejectsWith(sample("bonjour", { signal: new AbortController() }), "invalid_request");
  await rejectsWith(sample("bonjour", { tools: [{ name: "t", description: "d", execute() {} }], cache: true }), "invalid_request");
  await rejectsWith(sample("x".repeat(262145)), "prompt_too_large");

  const updates = [];
  let sync = true;
  const promise = sample("Combien ai-je dépensé en pub ?", { onText: (u) => { assert.equal(sync, false); updates.push(u); } });
  sync = false;
  const result = await promise;
  assert.ok(result.text.includes("Combien ai-je dépensé en pub ?"));
  assert.deepEqual([result.truncated, result.modelTierApplied], [false, "default"]);
  assert.ok(updates.length >= 1);
  assert.equal(updates[updates.length - 1].text, result.text);
  assert.equal(updates.map((u) => u.delta).join(""), result.text);

  mock.sampleHandler = async () => 'Voici : ```json\n{"items":[1,2]}\n```';
  assert.deepEqual(await sample.json("extrait"), { items: [1, 2] });
  mock.sampleHandler = async () => "Le total est [1, 2, 3] environ";
  assert.deepEqual(await sample.json("extrait"), [1, 2, 3]);
  mock.sampleHandler = async () => "rien d'exploitable";
  await assert.rejects(sample.json("extrait"), (err) => err.code === "invalid_json" && err.text === "rien d'exploitable");
  mock.sampleHandler = async () => { throw { code: "rate_limited", message: "limit", reason: "usage_limit" }; };
  await assert.rejects(sample("x"), (err) => err.code === "rate_limited" && err.reason === "usage_limit");
  mock.sampleHandler = async () => "ok";

  const ctl = new AbortController();
  ctl.abort();
  await rejectsWith(sample("x", { signal: ctl.signal }), "cancelled");
  await rejectsWith(sample("x", { images: [new Blob(["x"], { type: "image/heic" })] }), "image_rejected");
  mock.sampleLimits.images = undefined;
  await rejectsWith(sample("x", { images: [new Blob(["x"], { type: "image/png" })] }), "images_unavailable");
  mock.sampleConsent = "denied";
  await rejectsWith(sample("x"), "not_granted");
  assert.ok(mock.sampleCalls.length > 10);
});
