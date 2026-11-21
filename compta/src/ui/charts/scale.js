// Calculs purs des graphiques (aucun DOM) : graduations, échelles, tracés. Testés dans tests/unit/ui-charts.test.mjs.

/** Nombre fini, sinon null. */
export function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** [min, max] d'une liste en ignorant les valeurs absentes. [0, 0] si la liste est vide. */
export function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (num(v) === null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? [0, 0] : [min, max];
}

/**
 * Domaine d'un graphique à barres : contient toujours zéro (les barres partent de la ligne de base).
 * @param {Array<Array<number|null>>} rows une ligne par position, une valeur par série
 * @param {"grouped"|"stacked"} mode en "stacked", les positifs s'empilent vers le haut et les négatifs vers le bas
 */
export function barDomain(rows, mode = "grouped") {
  let min = 0;
  let max = 0;
  for (const row of rows) {
    if (mode === "stacked") {
      let pos = 0;
      let neg = 0;
      for (const v of row) {
        if (num(v) === null) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (pos > max) max = pos;
      if (neg < min) min = neg;
    } else {
      for (const v of row) {
        if (num(v) === null) continue;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
  }
  return [min, max];
}

function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Graduations rondes couvrant [min, max]. Zéro est toujours une graduation quand le domaine le contient.
 * @param {number} min
 * @param {number} max
 * @param {number} [count] nombre d'intervalles visé (4 par défaut)
 * @returns {{ min: number, max: number, step: number, ticks: number[] }}
 */
export function niceTicks(min, max, count = 4) {
  let lo = num(min) === null ? 0 : min;
  let hi = num(max) === null ? 0 : max;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else if (lo > 0) lo = 0;
    else hi = 0;
  }
  const step = niceStep((hi - lo) / Math.max(1, count));
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  const n = Math.round((end - start) / step);
  for (let i = 0; i <= n; i++) {
    // On repart du début à chaque fois pour ne pas accumuler d'erreur d'arrondi.
    const t = start + i * step;
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : Number(t.toPrecision(12)));
  }
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

/** Échelle linéaire : valeur du domaine -> position en pixels. */
export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  if (!span) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * Tracé d'une barre verticale : bout arrondi côté valeur, carré côté ligne de base.
 * @param {number} x bord gauche
 * @param {number} yBase ordonnée de la ligne de base (ou du segment précédent)
 * @param {number} yEnd ordonnée du bout de la barre (au-dessus ou au-dessous de yBase)
 * @param {number} width largeur
 * @param {number} [radius] rayon du bout (0 pour un segment intérieur d'une pile)
 */
export function barPath(x, yBase, yEnd, width, radius = 4) {
  const h = Math.abs(yEnd - yBase);
  const r = Math.max(0, Math.min(radius, width / 2, h));
  const x1 = x + width;
  if (h === 0 || width <= 0) return "";
  if (!r) return `M${round(x)} ${round(yBase)}V${round(yEnd)}H${round(x1)}V${round(yBase)}Z`;
  const dir = yEnd < yBase ? 1 : -1; // 1 : la barre monte
  const yr = yEnd + dir * r;
  const sweep = dir === 1 ? 1 : 0;
  return (
    `M${round(x)} ${round(yBase)}V${round(yr)}` +
    `A${round(r)} ${round(r)} 0 0 ${sweep} ${round(x + r)} ${round(yEnd)}` +
    `H${round(x1 - r)}` +
    `A${round(r)} ${round(r)} 0 0 ${sweep} ${round(x1)} ${round(yr)}` +
    `V${round(yBase)}Z`
  );
}

/**
 * Tracés d'une courbe : un morceau par suite de points présents (une valeur absente coupe la ligne).
 * @param {Array<{ x: number, y: number }|null>} points
 * @returns {string[]} attributs "d", un par morceau d'au moins deux points
 */
export function linePaths(points) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) out.push("M" + run.map((p) => `${round(p.x)} ${round(p.y)}`).join("L"));
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else flush();
  }
  flush();
  return out;
}

/** Largeur approximative d'un texte (en px) pour réserver la place des étiquettes d'axe sans mesurer le DOM. */
export function textWidth(text, fontSize = 11) {
  let units = 0;
  for (const ch of String(text == null ? "" : text)) {
    if (/[\s .,:;'|il1!]/.test(ch)) units += 0.3;
    else if (/[A-ZMW@%mw]/.test(ch)) units += 0.72;
    else units += 0.56;
  }
  return units * fontSize;
}

/** Coupe un libellé trop long pour une largeur donnée (points de suspension). */
export function fitLabel(text, maxWidth, fontSize = 11) {
  const s = String(text == null ? "" : text);
  if (textWidth(s, fontSize) <= maxWidth) return s;
  const chars = Array.from(s);
  let keep = chars.length;
  while (keep > 1 && textWidth(chars.slice(0, keep).join("") + "…", fontSize) > maxWidth) keep -= 1;
  return chars.slice(0, keep).join("").trimEnd() + "…";
}

/**
 * Une étiquette sur combien afficher sous l'axe pour qu'elles ne se chevauchent pas.
 * @param {string[]} labels
 * @param {number} band largeur disponible par position
 * @param {number} [fontSize]
 * @param {number} [maxWidth] largeur maximale d'une étiquette avant coupe
 */
export function labelStep(labels, band, fontSize = 11, maxWidth = 72) {
  if (!labels.length || band <= 0) return 1;
  let widest = 0;
  for (const l of labels) widest = Math.max(widest, Math.min(maxWidth, textWidth(l, fontSize)));
  return Math.max(1, Math.ceil((widest + 8) / band));
}

/**
 * Parts d'un tout pour une barre segmentée : seules les valeurs strictement positives comptent.
 * @param {Array<number|null>} values
 * @returns {{ total: number, shares: number[] }} parts entre 0 et 1 (0 pour une valeur nulle, négative ou absente)
 */
export function shares(values) {
  let total = 0;
  for (const v of values) if (num(v) !== null && v > 0) total += v;
  return { total, shares: values.map((v) => (total > 0 && num(v) !== null && v > 0 ? v / total : 0)) };
}

/**
 * Pourcentages entiers dont la somme fait exactement 100 (méthode du plus fort reste).
 * @param {number[]} parts parts entre 0 et 1
 */
export function roundShares(parts) {
  const raw = parts.map((p) => p * 100);
  const floors = raw.map((r) => Math.floor(r + 1e-9));
  const sum = raw.reduce((a, b) => a + b, 0);
  let missing = Math.round(sum) - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - floors[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    floors[i] += 1;
    missing -= 1;
  }
  return floors;
}
