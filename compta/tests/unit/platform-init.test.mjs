// initPlatform, fichiers, export, identité : contre le bouchon de window.claude et en mode local.
import test from "node:test";
import assert from "node:assert/strict";
import "../../dev/mock-claude.js";
import { initPlatform, CAPABILITIES, PlatformError } from "../../src/platform/index.js";
import { createFiles, createLocalFiles, describeFile, MAX_FILE_BYTES } from "../../src/platform/files.js";
import { createExporter, createLocalExporter } from "../../src/platform/exporter.js";
import { loadIdentity, makeResolveNames } from "../../src/platform/identity.js";
import { LOCAL_PREFIX } from "../../src/platform/backend-local.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const create = (options = {}) => globalThis.__createMockClaude({ persist: false, ...options });
const FAST = { retryDelayMs: 1, rateRetryDelayMs: 1, loadTimeoutMs: 2000, writeWaitMs: 2000 };

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

const op = (id, date) => ({ id, kind: "pl", date, label: "Test", accountId: "a", amountCents: -100, currency: "USD" });

test("capacités à déclarer : ni mcp ni courrier", () => {
  assert.deepEqual(CAPABILITIES, { db: {}, user: { scopes: ["profile"] }, assets: {}, downloads: {}, sample: { images: true } });
  assert.ok(Object.isFrozen(CAPABILITIES));
});

test("initPlatform dans Claude : propriétaire", async () => {
  const { claude, mock } = create();
  const platform = await initPlatform({ root: { claude }, store: FAST });
  assert.equal(platform.mode, "claude");
  assert.deepEqual(platform.user, { id: "u_demo_owner", name: "Alex", isOwner: true, canEdit: true, canWrite: true });
  assert.ok(platform.store && platform.files && platform.exporter && platform.ai);
  assert.equal("mail" in platform, false, "aucune fonction de courrier");
  assert.equal(platform.persistent, true);
  assert.equal(platform.ai.limits.images.maxCount, 5);

  await platform.store.putOps([op("op_1", "2026-11-01")]);
  assert.equal(mock.db.dump()["ledger/2026-11"].ops.op_1.id, "op_1");
  assert.equal(platform.store.getSnapshot().readOnly, false);
  assert.deepEqual(await platform.resolveNames(["u_demo_investor", "u_inconnu", "u_demo_investor", null, ""]), { u_demo_investor: "Sam", u_inconnu: "" });
  assert.deepEqual(await platform.resolveNames([]), {});

  // Réinitialiser ferme le store précédent.
  const again = await initPlatform({ root: { claude }, store: FAST });
  await assert.rejects(platform.store.putOps([op("op_2", "2026-11-02")]), (err) => err.code === "closed");
  await again.store.putOps([op("op_2", "2026-11-02")]);
  assert.equal(again.store.getSnapshot().ops.length, 2);
  again.dispose();
});

test("initPlatform dans Claude : lecteur, contributeur, plateforme muette", async () => {
  const viewer = await initPlatform({ root: { claude: create({ role: "viewer" }).claude }, store: FAST });
  assert.deepEqual([viewer.mode, viewer.user.canWrite, viewer.user.isOwner, viewer.files], ["claude", false, false, null]);
  assert.equal(viewer.store.getSnapshot().readOnly, true, "lecture seule connue d'avance");
  await assert.rejects(viewer.store.saveConfig({ onboarded: true }), (err) => err.code === "read_only");
  viewer.dispose();

  const contributor = await initPlatform({ root: { claude: create({ role: "contributor" }).claude }, store: FAST });
  assert.deepEqual([contributor.user.canWrite, contributor.user.canEdit, contributor.files], [true, false, null]);
  await contributor.store.saveConfig({ onboarded: true });
  contributor.dispose();

  const silent = await initPlatform({ root: { claude: create({ role: "viewer", can: null }).claude }, store: FAST });
  assert.equal(silent.user.canWrite, null, "inconnu : un écrit refusé tranchera");
  assert.equal(silent.store.getSnapshot().readOnly, false);
  await assert.rejects(silent.store.saveConfig({ onboarded: true }), (err) => err.code === "read_only");
  assert.equal(silent.store.getSnapshot().readOnly, true);
  silent.dispose();
});

test("initPlatform : base absente, capacités partielles, use() qui casse", async () => {
  const noDb = await initPlatform({ root: { claude: create({ capabilities: ["user", "downloads"] }).claude } });
  assert.equal(noDb.mode, "unavailable");
  assert.equal(noDb.store, null);
  assert.equal(noDb.files, null);
  assert.equal(noDb.ai, null);
  assert.ok(noDb.exporter);
  assert.equal(noDb.user.name, "Alex");

  const minimal = await initPlatform({ root: { claude: create({ capabilities: ["db"] }).claude }, store: FAST });
  assert.equal(minimal.mode, "claude");
  assert.deepEqual(minimal.user, { id: null, name: "", isOwner: false, canEdit: false, canWrite: null });
  assert.deepEqual([minimal.files, minimal.exporter, minimal.ai], [null, null, null]);
  assert.deepEqual(await minimal.resolveNames(["u_1"]), { u_1: "" });
  minimal.dispose();

  const broken = await initPlatform({ root: { claude: { use() { throw new Error("cassé"); } } } });
  assert.equal(broken.mode, "unavailable");
  const rejecting = await initPlatform({ root: { claude: { use: () => Promise.reject(new Error("refus")) } } });
  assert.equal(rejecting.mode, "unavailable");
  assert.equal(rejecting.store, null);
});

test("initPlatform hors de Claude : mode local sur le stockage de l'appareil", async () => {
  const storage = fakeStorage();
  const platform = await initPlatform({ root: {}, local: { storage, target: null }, store: FAST });
  assert.equal(platform.mode, "local");
  assert.deepEqual(platform.user, { id: null, name: "", isOwner: true, canEdit: true, canWrite: true });
  assert.equal(platform.ai, null);
  assert.equal(platform.exporter, null, "pas de document dans Node : pas d'export");
  assert.ok(platform.files);
  assert.equal(platform.persistent, true);
  await platform.store.putOps([op("op_1", "2026-11-01")]);
  assert.ok(storage.map.has(LOCAL_PREFIX + "ledger/2026-11"));
  platform.dispose();

  // Un rechargement retrouve les données.
  const reloaded = await initPlatform({ root: {}, local: { storage, target: null }, store: FAST });
  for (let i = 0; i < 50 && !reloaded.store.getSnapshot().loaded; i++) await tick(2);
  assert.deepEqual(reloaded.store.getSnapshot().ops.map((o) => o.id), ["op_1"]);
  reloaded.dispose();
});

test("fichiers : types acceptés et messages", () => {
  const blob = (type, size = 10) => new Blob([new Uint8Array(size)], { type });
  assert.deepEqual(describeFile(blob("image/png"), "Reçu  Applovin.PNG"), { type: "image/png", size: 10, name: "Reçu Applovin.PNG" });
  assert.equal(describeFile(blob(""), "facture.pdf").type, "application/pdf", "type vide : on se fie à l'extension");
  assert.equal(describeFile(blob("application/octet-stream"), "photo.JPEG").type, "image/jpeg");
  assert.equal(describeFile(blob("image/jpeg;charset=binary"), "x").type, "image/jpeg");
  assert.equal(describeFile(blob("image/webp")).name, "justificatif.webp");
  assert.throws(() => describeFile(blob("image/heic"), "IMG_1.HEIC"), (err) => err instanceof PlatformError && err.code === "unsupported_type" && /capture d'écran ou un PDF/.test(err.message));
  assert.throws(() => describeFile(blob(""), "IMG_1.heif"), /HEIC/);
  assert.throws(() => describeFile(blob("text/csv"), "export.csv"), (err) => err.code === "unsupported_type" && /PNG, JPEG, WebP, GIF ou PDF/.test(err.message));
  assert.throws(() => describeFile(blob("image/png", 0), "vide.png"), (err) => err.code === "invalid_request" && /vide/.test(err.message));
  assert.throws(() => describeFile({ size: MAX_FILE_BYTES + 1, type: "application/pdf" }, "gros.pdf"), (err) => err.code === "too_large" && /20 Mo/.test(err.message));
});

test("fichiers : envoi, URL, suppression, pannes", async () => {
  const { claude, mock } = create();
  const assets = await claude.use("assets");
  const files = createFiles(assets, { retryDelayMs: 1 });
  const info = await files.upload(new Blob(["%PDF-1.7 facture"], { type: "" }), "TikTok-Invoice.pdf");
  assert.match(info.id, /^[0-9a-f]{32}$/);
  assert.deepEqual({ ...info, id: "" }, { id: "", name: "TikTok-Invoice.pdf", type: "application/pdf", size: 16 });
  assert.equal(mock.assets.list()[0].contentType, "application/pdf");
  assert.equal(files.urlFor(info.id), "/_blob/" + info.id);
  assert.equal(files.urlFor("0123456789abcdef0123456789abcdef"), "/_blob/0123456789abcdef0123456789abcdef");
  assert.equal(files.urlFor(""), "");
  await files.remove(info.id);
  assert.equal(mock.assets.list().length, 0);
  await files.remove(info.id);
  await assert.rejects(files.upload(new Blob(["x"], { type: "text/plain" }), "note.txt"), (err) => err.code === "unsupported_type");

  // L'URL renvoyée par la plateforme pour cette visite est réutilisée telle quelle.
  let attempts = 0;
  const flaky = {
    upload: async () => { attempts++; if (attempts === 1) throw { code: "store_unavailable", message: "try later" }; return { id: "f".repeat(32), url: "blob:visite", sizeBytes: 3, contentType: "image/png" }; },
    delete: async () => { throw { code: "not_uploader", message: "someone else's" }; },
  };
  const retried = createFiles(flaky, { retryDelayMs: 1 });
  const sent = await retried.upload(new Blob(["abc"], { type: "image/png" }), "a.png");
  assert.equal(attempts, 2, "une seule nouvelle tentative");
  assert.equal(retried.urlFor(sent.id), "blob:visite");
  await assert.rejects(retried.remove(sent.id), (err) => err.code === "not_uploader" && /envoyés toi-même/.test(err.message));

  const failing = (code) => createFiles({ upload: async () => { throw { code, message: "x" }; } }, { retryDelayMs: 1 });
  const file = new Blob(["abc"], { type: "image/png" });
  await assert.rejects(failing("quota_or_state").upload(file, "a.png"), (err) => err.code === "quota_or_state" && /plein/.test(err.message));
  await assert.rejects(failing("store_unavailable").upload(file, "a.png"), (err) => err.code === "upstream_error" && /Réessaie/.test(err.message));
  await assert.rejects(failing("not_granted").upload(file, "a.png"), (err) => err.code === "unavailable");
  await assert.rejects(failing("upstream_auth").upload(file, "a.png"), (err) => /Recharge la page/.test(err.message));
  await assert.rejects(failing("rate_limited").upload(file, "a.png"), (err) => /Attends/.test(err.message));
  await assert.rejects(failing("too_large").upload(file, "a.png"), (err) => /20 Mo/.test(err.message));

  const local = createLocalFiles();
  const kept = await local.upload(file, "a.png");
  assert.match(kept.id, /^local_/);
  assert.deepEqual([kept.name, kept.type, kept.size], ["a.png", "image/png", 3]);
  assert.equal(typeof local.urlFor(kept.id), "string");
  await local.remove(kept.id);
  assert.equal(local.urlFor(kept.id), "");
});

test("export : enregistré, refusé par le visiteur, erreurs", async () => {
  const { claude, mock } = create();
  const exporter = createExporter(await claude.use("downloads"));
  assert.equal(await exporter.save("journal-2026-11.csv", "\ufeffdate;montant\r\n2026-11-21;-94,77"), "saved");
  const buffer = new Uint8Array([80, 75, 3, 4]).buffer;
  assert.equal(await exporter.save("compta.xlsx", buffer), "saved");
  assert.equal(buffer.byteLength, 4, "le tampon de l'appelant n'est pas vidé");
  assert.equal(await exporter.save("sauvegarde.json", new Blob(['{"format":"starringyou-compta"}'])), "saved");
  assert.deepEqual(mock.downloads.map((d) => d.filename), ["journal-2026-11.csv", "compta.xlsx", "sauvegarde.json"]);
  assert.equal(mock.downloads[2].text, '{"format":"starringyou-compta"}');

  mock.downloadDecision = "decline";
  assert.equal(await exporter.save("journal.csv", "x"), "declined");
  mock.downloadDecision = "rate_limited";
  await assert.rejects(exporter.save("journal.csv", "x"), (err) => err instanceof PlatformError && err.code === "rate_limited" && /Attends/.test(err.message));
  mock.downloadDecision = "unavailable";
  await assert.rejects(exporter.save("journal.csv", "x"), (err) => err.code === "unavailable" && /pas disponible/.test(err.message));
  mock.downloadDecision = "code_futur";
  await assert.rejects(exporter.save("journal.csv", "x"), (err) => err.code === "unavailable");
  mock.downloadDecision = "accept";
  await assert.rejects(exporter.save("page.html", "<p>x</p>"), (err) => err.code === "rejected_extension" && /format/.test(err.message));
  await assert.rejects(exporter.save("journal.csv", ""), (err) => err.code === "bad_request" && /rien à enregistrer/.test(err.message));
  await assert.rejects(exporter.save("", "x"), (err) => err.code === "rejected_extension");
  assert.equal(mock.downloads.length, 3);
  assert.equal(createLocalExporter(null), null);
});

test("identité : valeurs sûres même quand la capacité manque ou casse", async () => {
  assert.deepEqual(await loadIdentity(null), { id: null, name: "", isOwner: false, canEdit: false, canWrite: null });
  const odd = { me: async () => { throw new Error("x"); }, can: async () => "oui" };
  assert.deepEqual(await loadIdentity(odd), { id: null, name: "", isOwner: false, canEdit: false, canWrite: null });
  const partial = { me: async () => ({ id: "u_1", name: "", isOwner: false, canEdit: true }), can: async () => false };
  assert.deepEqual(await loadIdentity(partial), { id: "u_1", name: "", isOwner: false, canEdit: true, canWrite: false });
  const names = makeResolveNames({ profiles: async () => { throw new Error("x"); } });
  assert.deepEqual(await names(["u_1"]), { u_1: "" });
  assert.deepEqual(await makeResolveNames(null)("u_1"), { u_1: "" });
});
