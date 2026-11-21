import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, hashString, slugify } from "../../src/core/ids.js";

// Un identifiant sert de clé de document et de segment de chemin : lettres minuscules, chiffres et "_" seulement.
const PATH_SAFE = /^[a-z0-9_]+$/;

test("newId : caractères sûrs pour un chemin, préfixe, longueur", () => {
  for (const prefix of ["", "op", "acc", "rule", "p"]) {
    for (let i = 0; i < 200; i++) {
      const id = newId(prefix);
      assert.match(id, PATH_SAFE);
      if (prefix) assert.ok(id.startsWith(prefix + "_"), id);
      else assert.ok(!id.includes("_"), id);
      const body = prefix ? id.slice(prefix.length + 1) : id;
      assert.equal(body.length, 16, id);
      assert.match(body, /^[a-z0-9]{16}$/);
    }
  }
  assert.match(newId(), /^[a-z0-9]{16}$/);
});

test("newId : pas de doublon sur 100 000 tirages rapprochés", () => {
  const seen = new Set();
  for (let i = 0; i < 100000; i++) seen.add(newId("op"));
  assert.equal(seen.size, 100000);
});

test("newId : triable par date de création", async () => {
  const first = newId("op");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = newId("op");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const third = newId("op");
  assert.ok(first < second, `${first} < ${second}`);
  assert.ok(second < third, `${second} < ${third}`);
  assert.deepEqual([third, first, second].sort(), [first, second, third]);
});

test("newId : l'horodatage est lisible au début de l'identifiant", () => {
  const before = Date.now();
  const id = newId();
  const after = Date.now();
  const stamp = parseInt(id.slice(0, 8), 36);
  assert.ok(stamp >= before && stamp <= after, `${before} <= ${stamp} <= ${after}`);
});

test("hashString : stable, 16 chiffres hexadécimaux", () => {
  // Ces empreintes sont stockées (lignes de relevé ignorées) : elles ne doivent jamais changer.
  const pinned = [
    ["", "811c9dc501000193"],
    ["a", "e40c292cefafc426"],
    ["StarringYou", "e8e1510e68c166dd"],
    ["2026-11-21|FACEBK *X|-9477", "dbbc11d69b271127"],
  ];
  for (const [input, expected] of pinned) assert.equal(hashString(input), expected, JSON.stringify(input));
  for (const input of ["", "a", "é", "Klaviyo, abonnement octobre", "😀 film", "x".repeat(5000)]) {
    const hash = hashString(input);
    assert.match(hash, /^[0-9a-f]{16}$/);
    assert.equal(hashString(input), hash);
  }
});

test("hashString : accepte autre chose qu'une chaîne", () => {
  assert.equal(hashString(123), hashString("123"));
  assert.equal(hashString(null), hashString("null"));
  assert.equal(hashString(undefined), hashString("undefined"));
});

test("hashString : des entrées proches donnent des empreintes différentes", () => {
  assert.notEqual(hashString("ab"), hashString("ba"));
  assert.notEqual(hashString("2026-11-21|X|-9477"), hashString("2026-11-21|X|-9478"));
  assert.notEqual(hashString("2026-11-21|X|-9477"), hashString("2026-11-22|X|-9477"));
  assert.notEqual(hashString("a"), hashString("A"));
  assert.notEqual(hashString("a"), hashString("a "));
  const seen = new Set();
  for (let day = 1; day <= 28; day++) {
    for (let n = 0; n < 500; n++) seen.add(hashString(`2026-11-${String(day).padStart(2, "0")}|CARTE X${n} PARIS|${-100 - n}`));
  }
  assert.equal(seen.size, 28 * 500);
});

test("slugify : identifiant lisible et sûr", () => {
  const table = [
    ["Carte Visa 0562", "carte_visa_0562"],
    ["  Compte pro  ", "compte_pro"],
    ["Été à Zürich", "ete_a_zurich"],
    ["Revolut (EUR)", "revolut_eur"],
    ["Pub Meta / Instagram", "pub_meta_instagram"],
    ["a--b__c", "a_b_c"],
    ["__déjà__", "deja"],
    ["ALLCAPS", "allcaps"],
    ["compte.perso@banque", "compte_perso_banque"],
    ["123", "123"],
    ["", "x"],
    ["---", "x"],
    ["!!!", "x"],
    ["日本語", "x"],
    [null, "null"],
    [42, "42"],
  ];
  for (const [input, expected] of table) assert.equal(slugify(input), expected, JSON.stringify(input));
});

test("slugify : longueur maximale, jamais de \"_\" au bord", () => {
  assert.equal(slugify("a".repeat(100)).length, 40);
  assert.equal(slugify("a".repeat(100), 10), "a".repeat(10));
  assert.equal(slugify("aaaa bbbb", 5), "aaaa");
  assert.equal(slugify("aaaa bbbb", 6), "aaaa_b");
  assert.equal(slugify("ab cd ef", 3), "ab");
  const samples = ["Carte Visa 0562", "Compte courant de l'entreprise chez Revolut Business en dollars", "x y z", "été - hiver", "a".repeat(39) + " b"];
  for (const s of samples) {
    for (const max of [1, 2, 3, 5, 8, 13, 40]) {
      const slug = slugify(s, max);
      assert.match(slug, /^[a-z0-9]+(?:_[a-z0-9]+)*$/, `${s} / ${max} -> ${slug}`);
      assert.ok(slug.length <= max && slug.length >= 1);
    }
  }
});
