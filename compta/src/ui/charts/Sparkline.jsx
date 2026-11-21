// Mini-courbe sans axes, pour accompagner un chiffre (tuile, ligne de tableau).
import { markColor } from "../tone.js";
import { cx } from "../util.js";
import { extent, linePaths, linear, num } from "./scale.js";

/**
 * @param {{
 *   values: Array<number|null>, width?: number, height?: number, tone?: string, color?: string,
 *   area?: boolean, dot?: boolean, label?: string, class?: string
 * }} props
 * - `values` : du plus ancien au plus récent ; une valeur absente coupe la ligne. Liste vide : rien n'est rendu.
 * - Par défaut la courbe est grise et le dernier point prend la couleur (`tone` ou `color`, "accent" par défaut).
 * - `label` : description pour les lecteurs d'écran ; sans elle la mini-courbe est décorative.
 */
export function Sparkline({ values = [], width = 72, height = 24, tone = "accent", color, area = false, dot = true, label, class: className }) {
  const clean = (values || []).map(num);
  const present = clean.filter((v) => v !== null);
  if (!present.length) return null;
  const pad = 4;
  const [min, max] = extent(present);
  const y = linear(min === max ? [min - 1, max + 1] : [min, max], [height - pad, pad]);
  const n = clean.length;
  const xAt = (i) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const points = clean.map((v, i) => (v === null ? null : { x: xAt(i), y: y(v) }));
  const paths = linePaths(points);
  const shown = points.filter(Boolean);
  const last = shown[shown.length - 1];
  const fill = markColor({ color, tone }).fill;
  const areaPath = area && shown.length >= 2 ? `${linePaths(shown)[0]}L${last.x} ${height}L${shown[0].x} ${height}Z` : null;
  return (
    <svg
      class={cx("sparkline", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {areaPath ? <path class="chart-area" d={areaPath} fill={fill} /> : null}
      {paths.map((d) => (
        <path class="sparkline-line" d={d} />
      ))}
      {dot && last ? <circle class="chart-dot" cx={last.x} cy={last.y} r="3" fill={fill} /> : null}
    </svg>
  );
}
