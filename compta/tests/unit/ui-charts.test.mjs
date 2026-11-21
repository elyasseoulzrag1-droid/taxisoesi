// Calculs purs des graphiques (src/ui/charts/scale.js).
import test from "node:test";
import assert from "node:assert/strict";
import {
  axisScale,
  barDomain,
  barPath,
  extent,
  fitLabel,
  labelStep,
  linePaths,
  linear,
  niceTicks,
  num,
  roundShares,
  shares,
  textWidth,
} from "../../src/ui/charts/scale.js";

test("num et extent ignorent les valeurs absentes", () => {
  assert.equal(num(3), 3);
  assert.equal(num("3"), null);
  assert.equal(num(NaN), null);
  assert.equal(num(null), null);
  assert.deepEqual(extent([3, null, -2, undefined, 9]), [-2, 9]);
  assert.deepEqual(extent([]), [0, 0]);
  assert.deepEqual(extent([null, NaN]), [0, 0]);
  assert.deepEqual(extent([5]), [5, 5]);
});

test("barDomain contient toujours zéro, en groupé comme en empilé", () => {
  assert.deepEqual(barDomain([[5, 8], [3, null]], "grouped"), [0, 8]);
  assert.deepEqual(barDomain([[5, -8], [3, 2]], "grouped"), [-8, 5]);
  assert.deepEqual(barDomain([[5, 8], [3, 2]], "stacked"), [0, 13]);
  assert.deepEqual(barDomain([[5, -8, 2], [-3, -2, 1]], "stacked"), [-8, 7]);
  assert.deepEqual(barDomain([[-5], [-2]], "grouped"), [-5, 0]);
  assert.deepEqual(barDomain([], "stacked"), [0, 0]);
  assert.deepEqual(barDomain([[null, null]]), [0, 0]);
});

test("niceTicks : graduations rondes qui couvrent le domaine et passent par zéro", () => {
  const a = niceTicks(0, 445500, 4);
  assert.deepEqual(a.ticks, [0, 200000, 400000, 600000]);
  assert.equal(a.min, 0);
  assert.equal(a.max, 600000);
  const b = niceTicks(-82000, 445500, 4);
  assert.ok(b.ticks.includes(0), "zéro est une graduation");
  assert.ok(b.min <= -82000 && b.max >= 445500);
  assert.equal(b.ticks.filter((t) => Object.is(t, -0)).length, 0, "pas de zéro négatif");
  const c = niceTicks(0, 1842000, 4);
  assert.deepEqual(c.ticks, [0, 500000, 1000000, 1500000, 2000000]);
});

test("niceTicks : cas limites (point unique, valeurs négatives, bornes inversées, petits nombres)", () => {
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.25, 0.5, 0.75, 1]);
  const single = niceTicks(750, 750);
  assert.equal(single.min, 0);
  assert.ok(single.max >= 750);
  const negative = niceTicks(-300, -300);
  assert.equal(negative.max, 0);
  assert.ok(negative.min <= -300);
  assert.deepEqual(niceTicks(10, 0).ticks, niceTicks(0, 10).ticks);
  const small = niceTicks(0, 0.3, 3);
  assert.deepEqual(small.ticks, [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(niceTicks(null, undefined).ticks, [0, 0.25, 0.5, 0.75, 1]);
  for (const [lo, hi] of [[0, 7], [-13, 29], [1234, 98765], [-0.5, 0.2], [0, 1e9]]) {
    const s = niceTicks(lo, hi, 4);
    assert.ok(s.min <= lo && s.max >= hi, `couvre [${lo}, ${hi}]`);
    assert.ok(s.ticks.length >= 2 && s.ticks.length <= 8, `nombre de graduations raisonnable pour [${lo}, ${hi}]`);
    for (let i = 1; i < s.ticks.length; i++) assert.ok(Math.abs(s.ticks[i] - s.ticks[i - 1] - s.step) < s.step * 1e-6);
  }
});

test("axisScale : une seule graduation quand tout est à zéro", () => {
  assert.deepEqual(axisScale(0, 0).ticks, [0]);
  assert.deepEqual(axisScale(null, 0).ticks, [0]);
  assert.deepEqual(axisScale(0, 445500, 4).ticks, [0, 200000, 400000, 600000]);
});

test("linear : échelle directe, inversée et domaine nul", () => {
  const y = linear([0, 100], [200, 0]);
  assert.equal(y(0), 200);
  assert.equal(y(100), 0);
  assert.equal(y(25), 150);
  assert.equal(linear([5, 5], [0, 10])(5), 5, "domaine nul : milieu de la plage");
});

test("barPath : bout arrondi côté valeur, carré côté ligne de base", () => {
  const up = barPath(10, 100, 40, 20, 4);
  assert.match(up, /^M10 100V44A4 4 0 0 1 14 40H26A4 4 0 0 1 30 44V100Z$/);
  const down = barPath(10, 100, 160, 20, 4);
  assert.match(down, /^M10 100V156A4 4 0 0 0 14 160H26A4 4 0 0 0 30 156V100Z$/);
  assert.equal(barPath(10, 100, 40, 20, 0), "M10 100V40H30V100Z", "segment intérieur d'une pile : pas d'arrondi");
  assert.equal(barPath(10, 100, 100, 20), "", "hauteur nulle : rien");
  assert.equal(barPath(10, 100, 40, 0), "", "largeur nulle : rien");
  const tiny = barPath(0, 100, 98, 20, 4);
  assert.match(tiny, /A2 2 /, "le rayon ne dépasse jamais la hauteur de la barre");
  const thin = barPath(0, 100, 40, 2, 4);
  assert.match(thin, /A1 1 /, "ni la moitié de sa largeur");
});

test("linePaths : une valeur absente coupe la ligne, un point seul ne trace rien", () => {
  const p = (x, y) => ({ x, y });
  assert.deepEqual(linePaths([p(0, 1), p(10, 2), p(20, 3)]), ["M0 1L10 2L20 3"]);
  assert.deepEqual(linePaths([p(0, 1), p(10, 2), null, p(30, 4), p(40, 5)]), ["M0 1L10 2", "M30 4L40 5"]);
  assert.deepEqual(linePaths([p(0, 1), null, p(20, 3)]), []);
  assert.deepEqual(linePaths([p(5, 5)]), []);
  assert.deepEqual(linePaths([]), []);
});

test("textWidth, fitLabel et labelStep gèrent les libellés longs", () => {
  assert.ok(textWidth("MMMM", 11) > textWidth("iiii", 11));
  assert.equal(textWidth("", 11), 0);
  assert.equal(textWidth(null), 0);
  const long = "Production des films (outils IA et rendu vidéo)";
  const cut = fitLabel(long, 80, 11);
  assert.ok(cut.endsWith("…"));
  assert.ok(cut.length < long.length);
  assert.ok(textWidth(cut, 11) <= 80);
  assert.equal(fitLabel("nov.", 80, 11), "nov.");
  assert.ok(fitLabel(long, 1, 11).length >= 2, "garde au moins un caractère");
  assert.equal(labelStep(["sept.", "oct.", "nov."], 100), 1);
  assert.ok(labelStep(Array(30).fill("21 nov."), 10) >= 4);
  assert.equal(labelStep([], 10), 1);
  assert.equal(labelStep(["a"], 0), 1);
});

test("shares : seules les valeurs strictement positives comptent", () => {
  const s = shares([300, 100, 0, -50, null]);
  assert.equal(s.total, 400);
  assert.deepEqual(s.shares, [0.75, 0.25, 0, 0, 0]);
  assert.deepEqual(shares([]).shares, []);
  assert.deepEqual(shares([0, -1]), { total: 0, shares: [0, 0] });
});

test("roundShares : des pourcentages entiers qui font exactement 100", () => {
  assert.deepEqual(roundShares([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
  assert.deepEqual(roundShares([0.4, 0.4, 0.2]), [40, 40, 20]);
  assert.deepEqual(roundShares([0.5488, 0.2987, 0.1369, 0.0156]), [55, 30, 14, 1]);
  assert.deepEqual(roundShares([1]), [100]);
  assert.deepEqual(roundShares([0, 0]), [0, 0]);
  for (const list of [[0.123, 0.456, 0.421], [0.001, 0.999], [0.2, 0.2, 0.2, 0.2, 0.2], [0.335, 0.335, 0.33]]) {
    assert.equal(roundShares(list).reduce((a, b) => a + b, 0), 100);
  }
});
