// Claude dans la page : consigne d'extraction, validation des réponses, images, discussion, messages d'erreur.
import test from "node:test";
import assert from "node:assert/strict";
import "../../dev/mock-claude.js";
import {
  aiError, buildExtractionPrompt, coerceExtraction, createAi, parseJsonLoose, planTiles, prepareImages, salvageItems, toTurns,
} from "../../src/platform/ai.js";
import { PlatformError } from "../../src/platform/errors.js";

const CATEGORIES = [
  { id: "sales_shopify", label: "Ventes Shopify", kind: "income" },
  { id: "refunds", label: "Remboursements clients", kind: "income" },
  { id: "ads_meta", label: "Pub Meta (Facebook, Instagram)", kind: "expense" },
  { id: "ads_applovin", label: "Pub AppLovin", kind: "expense" },
  { id: "email_sms", name: "Email et SMS (Klaviyo)", kind: "expense" },
];
const CONTEXT = { categories: CATEGORIES, baseCurrency: "USD", today: "2026-11-21", accounts: [{ name: "Slash", currency: "USD", cards: ["0562"] }] };
const STRIPE = "Receipt from Applovin Corporation Receipt #1182-9784\nAmount paid\n$94.77\n\nDate paid\nNovember 21, 2026 at 3:14:10 AM PST\n\nPayment method\n- 0562\n";

async function mockAi(options = {}) {
  const { claude, mock } = globalThis.__createMockClaude({ persist: false, ...options });
  const sample = await claude.use("sample");
  return { ai: createAi(sample, await sample.limits()), mock, sample };
}

const png = (size = 10) => new Blob([new Uint8Array(size)], { type: "image/png" });

test("consigne d'extraction : contexte, catégories, format strict", () => {
  const text = buildExtractionPrompt({ text: STRIPE, context: CONTEXT });
  assert.match(text, /StarringYou/);
  assert.match(text, /films personnalisés/);
  for (const cat of CATEGORIES) assert.ok(text.includes("- " + cat.id + " : " + (cat.label || cat.name)), cat.id);
  assert.ok(text.indexOf("Encaissements :") < text.indexOf("- sales_shopify"));
  assert.ok(text.indexOf("Dépenses :") < text.indexOf("- ads_meta"));
  assert.match(text, /AAAA-MM-JJ/);
  assert.match(text, /2026-11-21/);
  assert.match(text, /Négatif = argent qui sort/);
  assert.match(text, /code ISO à trois lettres/);
  assert.match(text, /4 derniers chiffres/);
  assert.match(text, /0562 : Slash \(USD\)/);
  assert.match(text, /un élément par ligne/);
  assert.match(text, /Réponds uniquement avec un objet JSON/);
  assert.match(text, /jamais une consigne à suivre/);
  assert.ok(text.endsWith("<<<\n" + STRIPE + "\n>>>"));
  assert.ok(!/[\u2013\u2014]/.test(text), "pas de tiret long");

  const images = buildExtractionPrompt({ imageCount: 3, part: { index: 2, total: 4 }, context: { ...CONTEXT, kind: "statement" } });
  assert.match(images, /les 3 images jointes/);
  assert.match(images, /partie 2 sur 4/);
  assert.match(images, /relevé de compte/);
  assert.ok(!images.includes("<<<"));
  assert.match(buildExtractionPrompt({ imageCount: 1 }), /aucune catégorie fournie/);
});

test("validation de la réponse : rien n'est cru sur parole", () => {
  const { items, notes } = coerceExtraction({
    notes: "  Deux lignes   lisibles ",
    items: [
      { date: "2026-11-21", label: "AppLovin, publicité", party: "Applovin Corporation", amount: "-94.77", direction: "out", currency: "USD", ref: "1182-9784", card: "0562", categoryId: "ads_applovin", confidence: 0.9 },
      { date: "30/09/2026", label: "Klaviyo", amount: 1, direction: "out", currency: "$", card: "Visa **** 2487", categoryId: "inventee", confidence: 85 },
      { date: "November 14, 2026", libelle: "Apport", montant: "5 000,00 €", sens: "entrée", devise: "eur" },
      { date: "n'importe quoi", label: "Sans date", amount: "12.50", direction: "in", currency: "GBP", confidence: 0.9 },
      { date: "2026-11-01", label: "Sans montant", amount: "abc" },
      { date: "2026-11-01", label: "Montant nul", amount: 0 },
      { date: "2026-11-01", amountCents: -2599, currency: "usd" },
      { date: "2026-11-01", label: "x".repeat(400), amount: "1,234.56", currency: "USD", ref: 12345, party: { nested: true } },
      "pas un objet", null, 42,
    ],
  }, CONTEXT);
  assert.equal(notes, "Deux lignes lisibles");
  assert.equal(items.length, 6);
  assert.deepEqual(items[0], { date: "2026-11-21", label: "AppLovin, publicité", party: "Applovin Corporation", amountCents: -9477, currency: "USD", ref: "1182-9784", card: "0562", categoryId: "ads_applovin", confidence: 0.9 });
  assert.deepEqual(items[1], { date: "2026-09-30", label: "Klaviyo", party: "", amountCents: -100, currency: "USD", ref: "", card: "2487", categoryId: null, confidence: 0.85 });
  assert.deepEqual([items[2].amountCents, items[2].currency, items[2].date, items[2].label, items[2].confidence], [500000, "EUR", "2026-11-14", "Apport", 0.5]);
  assert.deepEqual([items[3].date, items[3].dateGuessed, items[3].confidence, items[3].amountCents, items[3].currency], ["2026-11-21", true, 0.4, 1250, "GBP"]);
  assert.deepEqual([items[4].amountCents, items[4].currency, items[4].label], [-2599, "USD", "Opération à vérifier"]);
  assert.equal(items[5].amountCents, 123456);
  assert.equal(items[5].label.length, 140);
  assert.equal(items[5].ref, "12345");
  for (const item of items) {
    assert.ok(Number.isInteger(item.amountCents));
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(item.currency, /^[A-Z]{3}$/);
    assert.ok(item.confidence >= 0 && item.confidence <= 1);
  }
  // Autres formes de réponse.
  assert.equal(coerceExtraction([{ date: "2026-11-01", amount: "-3.00" }], CONTEXT).items.length, 1);
  assert.equal(coerceExtraction({ date: "2026-11-01", amount: "-3.00", label: "Seul" }, CONTEXT).items[0].label, "Seul");
  assert.deepEqual(coerceExtraction("texte", CONTEXT), { items: [], notes: "" });
  assert.deepEqual(coerceExtraction(null), { items: [], notes: "" });
  // Le sens déclaré l'emporte sur un signe oublié.
  assert.equal(coerceExtraction([{ date: "2026-11-01", amount: "94.77", direction: "out" }]).items[0].amountCents, -9477);
  assert.equal(coerceExtraction([{ date: "2026-11-01", amount: "-94.77", direction: "in" }]).items[0].amountCents, 9477);
  assert.equal(coerceExtraction([{ date: "2026-11-01", amount: "94.77" }]).items[0].amountCents, 9477);
});

test("lecture tolérante du JSON et récupération d'une réponse coupée", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Voici :\n```json\n{"a":[1,2]}\n```\nmerci'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('Résultat : {"a":{"b":2}} voilà'), { a: { b: 2 } });
  assert.equal(parseJsonLoose("rien"), undefined);
  assert.equal(parseJsonLoose(42), undefined);
  const cut = '{"items":[{"date":"2026-11-01","label":"A {x} \\"q\\"","amount":"-1.00"},{"date":"2026-11-02","amount":"-2.00"},{"date":"2026-11-03","amo';
  assert.equal(parseJsonLoose(cut), undefined);
  assert.deepEqual(salvageItems(cut).map((i) => i.date), ["2026-11-01", "2026-11-02"]);
  assert.equal(salvageItems(cut)[0].label, 'A {x} "q"');
  assert.deepEqual(salvageItems("pas de tableau"), []);
});

test("extractOperations : reçu collé en texte", async () => {
  const { ai, mock } = await mockAi();
  const result = await ai.extractOperations({ text: STRIPE, context: CONTEXT });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], { date: "2026-11-21", label: "AppLovin, publicité", party: "Applovin Corporation", amountCents: -9477, currency: "USD", ref: "1182-9784", card: "0562", categoryId: "ads_applovin", confidence: 0.9 });
  assert.equal(typeof result.notes, "string");
  const call = mock.sampleCalls[0];
  assert.equal(call.kind, "json", "sample.json quand il existe");
  assert.ok(call.prompt.includes("- ads_applovin : Pub AppLovin"));
  assert.ok(call.prompt.includes(STRIPE));
  assert.equal(call.images.length, 0);
  await assert.rejects(ai.extractOperations({ context: CONTEXT }), (err) => err instanceof PlatformError && err.code === "invalid_request" && /image ou colle le texte/.test(err.message));
});

test("extractOperations : images, lots selon la limite, progression", async () => {
  const { ai, mock } = await mockAi();
  assert.deepEqual(ai.limits.images.mediaTypes, ["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const one = await ai.extractOperations({ images: [png()], context: CONTEXT });
  assert.equal(one.items.length, 1);
  assert.equal(mock.sampleCalls[0].images.length, 1);
  assert.match(mock.sampleCalls[0].prompt, /l'image jointe/);

  // Cinq images quand la vue en accepte deux par appel : trois appels, le texte seulement dans le premier.
  const strict = globalThis.__createMockClaude({ persist: false });
  strict.mock.sampleLimits.images.maxCount = 2;
  const sample = await strict.claude.use("sample");
  const batched = createAi(sample, await sample.limits());
  assert.equal(batched.limits.images.maxCount, 2);
  const progress = [];
  const many = await batched.extractOperations({
    images: [png(), png(), png(), png(), png()], text: "note jointe", context: CONTEXT,
    onProgress: (p) => progress.push(p.done + "/" + p.total),
  });
  assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
  assert.deepEqual(strict.mock.sampleCalls.map((c) => c.images.length), [2, 2, 1]);
  assert.deepEqual(strict.mock.sampleCalls.map((c) => c.prompt.includes("note jointe")), [true, false, false]);
  assert.match(strict.mock.sampleCalls[1].prompt, /partie 2 sur 3/);
  assert.equal(many.items.length, 5);
  assert.match(many.notes, /3 parties/);

  // Limites absentes : pas d'analyse d'images. PDF : à convertir d'abord. Type non accepté sans canvas : refusé.
  const textOnly = createAi(sample, null);
  assert.equal(textOnly.limits.images, null);
  assert.equal(textOnly.limits.tools, null);
  await assert.rejects(textOnly.extractOperations({ images: [png()], context: CONTEXT }), (err) => err.code === "images_unavailable" && /Colle le texte/.test(err.message));
  await assert.rejects(ai.extractOperations({ images: [new Blob(["%PDF"], { type: "application/pdf" })] }), (err) => err.code === "pdf_not_image" && /PDF/.test(err.message));
  await assert.rejects(ai.extractOperations({ images: [new Blob(["x"], { type: "image/heic" })], imageEnv: null }), (err) => err.code === "image_rejected");
  await assert.rejects(ai.extractOperations({ images: Array.from({ length: 30 }, () => png()) }), (err) => err.code === "too_many_images");
});

test("extractOperations : repli sans sample.json, réponse coupée, réponse inexploitable", async () => {
  const calls = [];
  const plain = async (input, options) => { calls.push({ input, options }); return { text: 'Bien sûr :\n```json\n{"items":[{"date":"2026-11-02","amount":"-12.00","currency":"EUR","label":"Canva"}],"notes":""}\n```', truncated: false }; };
  let ai = createAi(plain, null);
  let result = await ai.extractOperations({ text: "Canva 12,00 €", context: CONTEXT });
  assert.deepEqual([result.items[0].amountCents, result.items[0].currency], [-1200, "EUR"]);
  assert.equal(typeof calls[0].input, "string");

  // json absent du runtime (capability_removed) : on repasse par le texte.
  const older = async () => ({ text: '{"items":[{"date":"2026-11-02","amount":"-5.00"}]}', truncated: false });
  older.json = async () => { throw { code: "capability_removed", message: "json is not in this runtime" }; };
  result = await createAi(older, null).extractOperations({ text: "x", context: CONTEXT });
  assert.equal(result.items[0].amountCents, -500);

  // Réponse coupée par la limite de longueur : on garde les lignes complètes et on le dit.
  const cut = async () => { throw new Error("jamais appelé"); };
  cut.json = async () => { throw { code: "invalid_json", message: "cut short", text: '{"items":[{"date":"2026-11-01","amount":"-1.00"},{"date":"2026-11-02","amount":"-2.00"},{"date":"2026-11-0' }; };
  result = await createAi(cut, null).extractOperations({ text: "relevé", context: CONTEXT });
  assert.deepEqual(result.items.map((i) => i.amountCents), [-100, -200]);
  assert.match(result.notes, /coupée/);

  const garbage = async () => ({ text: "Désolé, je ne vois rien.", truncated: false });
  await assert.rejects(createAi(garbage, null).extractOperations({ text: "x" }), (err) => err.code === "invalid_json" && /saisis l'opération à la main/.test(err.message) && err.text === "Désolé, je ne vois rien.");
});

test("messages d'erreur en français", async () => {
  const cases = [
    ["not_granted", /autorisé/], ["sampling_disabled", /pas disponible pour ce compte/], ["session_expired", /Reconnecte-toi/],
    ["image_rejected", /capture d'écran/], ["refused", /Reformule/], ["empty_completion", /rien répondu/],
    ["prompt_too_large", /trop long/], ["upstream_error", /Réessaie dans un instant/], ["cancelled", /annulée/],
  ];
  for (const [code, pattern] of cases) {
    const err = aiError({ code, message: "english detail" });
    assert.ok(err instanceof PlatformError);
    assert.equal(err.code, code);
    assert.match(err.message, pattern);
    assert.equal(err.detail, "english detail");
  }
  assert.equal(aiError({ code: "rate_limited" }).message, "Trop de demandes à Claude en même temps. Attends un instant puis réessaie.");
  const usage = aiError({ code: "rate_limited", reason: "usage_limit", text: "début de réponse" });
  assert.match(usage.message, /limite d'utilisation/);
  assert.equal(usage.reason, "usage_limit");
  assert.equal(usage.text, "début de réponse");
  assert.equal(aiError({ code: "capability_disabled" }).code, "unavailable");
  assert.equal(aiError({ code: "not_declared" }).code, "unavailable");
  assert.equal(aiError({ code: "code_futur" }).code, "upstream_error");
  assert.equal(aiError(new Error("boom")).code, "upstream_error");
  assert.equal(aiError({ code: "queue_overflow" }).code, "invalid_request");

  const { ai, mock } = await mockAi();
  mock.sampleConsent = "denied";
  await assert.rejects(ai.extractOperations({ text: "x" }), (err) => err.code === "not_granted" && /autorisé/.test(err.message));
  await assert.rejects(ai.chat([{ role: "user", content: "Bonjour" }]), (err) => err.code === "not_granted");
  mock.sampleConsent = "granted";
  mock.sampleHandler = async () => { throw { code: "rate_limited", message: "usage", reason: "usage_limit" }; };
  await assert.rejects(ai.chat([{ role: "user", content: "Bonjour" }]), (err) => err.code === "rate_limited" && /limite d'utilisation/.test(err.message));
});

test("chat : flux, consignes, outils, annulation", async () => {
  const { ai, mock } = await mockAi();
  const seen = [];
  const answer = await ai.chat(
    [{ role: "system", content: "Réponds en français avec les chiffres des outils." }, { role: "user", content: "Où en est la pub ?" }],
    { onText: (text, delta) => seen.push([text, delta]) },
  );
  assert.ok(answer.includes("Où en est la pub ?"));
  assert.ok(seen.length >= 1);
  assert.equal(seen[seen.length - 1][0], answer);
  assert.equal(seen.map((s) => s[1]).join(""), answer);
  const call = mock.sampleCalls[0];
  assert.deepEqual(call.input.map((t) => t.role), ["user", "user"], "pas de rôle system : il devient un tour user");
  assert.equal(call.options.cache, false);
  assert.equal(call.kind, "text");

  // Outils de la page : exécutés ici, résultat renvoyé au modèle.
  let received = null;
  const tools = [{ name: "resume_periode", description: "Résumé chiffré de la période.", inputSchema: { type: "object", properties: {} }, execute: async (input) => { received = input; return { profitCents: 120000 }; } }];
  const withTools = await ai.chat([{ role: "user", content: "Quel est mon bénéfice ?" }], { tools, modelTier: "quick" });
  assert.deepEqual(received, {});
  assert.match(withTools, /resume_periode/);
  assert.match(withTools, /120000/);
  const sent = mock.sampleCalls[1].options;
  assert.equal(sent.modelTier, "quick");
  assert.deepEqual(Object.keys(sent.tools[0]).sort(), ["description", "execute", "inputSchema", "name"]);
  assert.deepEqual(await sent.tools[0].execute("pas un objet", {}), { profitCents: 120000 }, "une entrée invalide devient {}");
  const huge = [{ name: "liste", description: "Liste.", execute: () => "x".repeat(40000) }];
  await ai.chat([{ role: "user", content: "Liste tout" }], { tools: huge });
  await assert.rejects(Promise.resolve().then(() => mock.sampleCalls[2].options.tools[0].execute({}, {})), /Result too large/);

  // Vue sans outils : refus clair plutôt que des chiffres inventés.
  const noTools = createAi(await globalThis.__createMockClaude({ persist: false }).claude.use("sample"), { maxPromptBytes: 262144 });
  await assert.rejects(noTools.chat([{ role: "user", content: "x" }], { tools }), (err) => err.code === "tools_unavailable" && /chiffres/.test(err.message));
  assert.equal(typeof await noTools.chat([{ role: "user", content: "x" }]), "string");

  await assert.rejects(ai.chat([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), (err) => err.code === "invalid_request" && /question/.test(err.message));
  await assert.rejects(ai.chat([]), (err) => err.code === "invalid_request");
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(ai.chat([{ role: "user", content: "Stop" }], { signal: ctl.signal }), (err) => err.code === "cancelled");
});

test("toTurns : garde les consignes et la dernière question, retire les plus vieux échanges", () => {
  const messages = [{ role: "system", content: "Consignes" }, { role: "assistant", content: "ignoré ? non, gardé après system" }];
  for (let i = 0; i < 20; i++) messages.push({ role: i % 2 ? "assistant" : "user", content: "m" + i + " " + "x".repeat(1000) });
  messages.push({ role: "user", content: "Dernière question" });
  const turns = toTurns(messages, 26000);
  assert.equal(turns[0].content, "Consignes");
  assert.equal(turns[turns.length - 1].content, "Dernière question");
  assert.ok(turns.length < messages.length);
  assert.ok(turns.reduce((n, t) => n + t.content.length, 0) <= 26000 - 16384);
  assert.deepEqual(toTurns([{ role: "assistant", content: "bonjour" }, { role: "user", content: " salut " }, { role: "user", content: "" }]), [{ role: "user", content: "salut" }]);
  assert.throws(() => toTurns([{ role: "user", content: "x".repeat(30000) }], 20000), (err) => err.code === "prompt_too_large");
});

test("images : passage direct, conversion, découpe des captures très hautes", async () => {
  assert.deepEqual(planTiles(1170, 2532), [{ x: 0, y: 0, w: 1170, h: 2532 }], "capture d'écran normale : entière");
  const tiles = planTiles(1170, 9000);
  assert.ok(tiles.length >= 5 && tiles.length <= 10);
  assert.equal(tiles[0].y, 0);
  assert.equal(tiles[tiles.length - 1].y + tiles[tiles.length - 1].h, 9000, "la dernière tuile va jusqu'en bas");
  for (let i = 1; i < tiles.length; i++) assert.ok(tiles[i].y < tiles[i - 1].y + tiles[i - 1].h, "les tuiles se chevauchent");
  assert.equal(planTiles(1000, 100000).length, 10);

  const limits = { maxCount: 5, maxInputBytes: 1000, mediaTypes: ["image/png", "image/jpeg"] };
  const encoded = [];
  const env = (width, height) => ({
    decode: async () => ({ width, height, close() {} }),
    encode: async (bitmap, crop, w, h, quality) => { encoded.push({ crop, w, h, quality }); return { size: Math.round(w * h * quality / 1000), type: "image/jpeg" }; },
  });
  const small = png(500);
  assert.deepEqual(await prepareImages([small], limits, env(800, 600)), [small], "image conforme : envoyée telle quelle");
  assert.equal(encoded.length, 0);

  // Trop lourde : convertie, puis réduite jusqu'à passer sous la limite.
  const heavy = await prepareImages([png(5000)], limits, env(4000, 3000));
  assert.equal(heavy.length, 1);
  assert.ok(heavy[0].size <= 1000);
  assert.ok(encoded.length >= 2, "plusieurs essais de plus en plus petits");
  assert.ok(encoded[encoded.length - 1].w < encoded[0].w);
  assert.ok(Math.max(encoded[0].w, encoded[0].h) <= 2000);

  // Type non accepté par la plateforme mais lisible par le navigateur : converti.
  encoded.length = 0;
  const converted = await prepareImages([new Blob(["x"], { type: "image/bmp" })], limits, env(400, 300));
  assert.equal(converted[0].type, "image/jpeg");
  assert.deepEqual(encoded[0].crop, { x: 0, y: 0, w: 400, h: 300 });

  // Très haute : découpée.
  encoded.length = 0;
  const sliced = await prepareImages([png(500)], { ...limits, maxInputBytes: 10 ** 9 }, env(1000, 8000));
  assert.ok(sliced.length >= 4);
  assert.equal(encoded.length, sliced.length);

  // Illisible ici : envoyée telle quelle si son type est accepté, refusée sinon.
  const unreadable = { decode: async () => { throw new Error("décodage impossible"); }, encode: async () => null };
  assert.deepEqual(await prepareImages([small], limits, unreadable), [small]);
  await assert.rejects(prepareImages([new Blob(["x"], { type: "image/heic" })], limits, unreadable), (err) => err.code === "image_rejected");
  await assert.rejects(prepareImages([new Blob([], { type: "image/png" })], limits, null), (err) => err.code === "image_rejected");
  await assert.rejects(prepareImages([png(5000)], limits, null), (err) => err.code === "image_rejected", "trop lourde et pas de canvas");
  assert.deepEqual(await prepareImages([small], limits, null), [small]);
});
