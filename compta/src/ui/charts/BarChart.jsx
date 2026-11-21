// Barres verticales : groupées ou empilées, valeurs positives et négatives, étiquettes en abscisse.
import { markColor } from "../tone.js";
import { useMeasure } from "../util.js";
import { ChartEmpty, ChartFrame, ChartLegend, ChartLive, ChartTable, ChartTip, defaultFormat, useChartTip } from "./common.jsx";
import { barDomain, barPath, fitLabel, labelStep, linear, num, textWidth, axisScale } from "./scale.js";

const FONT = 11;
const GAP = 2; // espace de 2 px (couleur de la surface) entre deux marques qui se touchent
const MAX_BAR = 24;

/** Lit l'étiquette d'une ligne de données. */
export function readLabel(row, x, index) {
  const raw = typeof x === "function" ? x(row, index) : row == null ? "" : row[x];
  return raw == null ? "" : String(raw);
}

/** Lit la valeur d'une série dans une ligne de données (null si absente). */
export function readValue(row, serie) {
  const raw = typeof serie.value === "function" ? serie.value(row) : row == null ? null : row[serie.key];
  return num(raw);
}

/**
 * @param {{
 *   data: object[], series: Array<{ key: string, label: string, color?: string, tone?: string, value?: (row: object) => number }>,
 *   x?: string|((row: object, index: number) => string), mode?: "grouped"|"stacked",
 *   format?: (value: number) => string, formatAxis?: (value: number) => string,
 *   colorBySign?: boolean, height?: number, title?: string, sub?: string, xTitle?: string,
 *   legend?: boolean, table?: boolean, emptyText?: string, class?: string
 * }} props
 * - `data` : une ligne par position sur l'axe (un mois, une semaine...). `x` : clé ou fonction donnant l'étiquette ("label" par défaut).
 * - `series` : une entrée par série ; la valeur est lue dans `row[key]` (ou par `value(row)`).
 *   Couleur : `color` (CSS), sinon `tone` ("in", "out", "accent", "neutral"), sinon la palette dans l'ordre des séries.
 * - `mode` : "grouped" (barres côte à côte) ou "stacked" (empilées ; les négatifs partent vers le bas).
 * - `colorBySign` : avec une seule série, vert au-dessus de zéro et rouge en dessous (bénéfice ou perte par mois).
 * - `format` : valeur -> texte (ex. centimes -> "1 234 $"). `formatAxis` : version courte pour les graduations.
 * - `xTitle` : nom de la première colonne de la vue tableau ("Période" par défaut).
 */
export function BarChart({
  data = [],
  series = [],
  x = "label",
  mode = "grouped",
  format = defaultFormat,
  formatAxis,
  colorBySign = false,
  height = 220,
  title,
  sub,
  xTitle = "Période",
  legend = true,
  table = true,
  emptyText,
  class: className,
}) {
  const { ref: rootRef, attach, width } = useMeasure();
  const rows = (data || []).map((row, i) => ({ label: readLabel(row, x, i), values: series.map((s) => readValue(row, s)) }));
  const count = rows.length;
  const tipState = useChartTip(rootRef, count);
  const hasData = count > 0 && series.length > 0 && rows.some((r) => r.values.some((v) => v !== null));
  const stacked = mode === "stacked";
  const bySign = colorBySign && series.length === 1;
  const colors = series.map((s, j) => markColor(s, j).fill);
  const axisFormat = formatAxis || format;

  if (!hasData) {
    return (
      <ChartFrame title={title} sub={sub} class={className}>
        <ChartEmpty height={Math.min(height, 140)} text={emptyText} />
      </ChartFrame>
    );
  }

  const [dMin, dMax] = barDomain(
    rows.map((r) => r.values),
    mode,
  );
  const scale = axisScale(dMin, dMax, height < 190 ? 3 : 4);
  const axisInfo = { max: Math.max(Math.abs(scale.min), Math.abs(scale.max)), step: scale.step };
  const tickLabels = scale.ticks.map((t) => axisFormat(t, axisInfo));
  const left = Math.min(76, Math.ceil(Math.max(...tickLabels.map((t) => textWidth(t, FONT)))) + 10);
  const top = 10;
  const bottom = 26;
  const right = 6;
  const plotW = Math.max(0, width - left - right);
  const plotH = Math.max(40, height - top - bottom);
  const y = linear([scale.min, scale.max], [top + plotH, top]);
  const y0 = y(0);
  const band = count ? plotW / count : 0;
  const k = series.length;
  const barW = stacked
    ? Math.max(2, Math.min(MAX_BAR, band * 0.62))
    : Math.max(2, Math.min(MAX_BAR, (band * 0.76 - GAP * (k - 1)) / k));
  const groupW = stacked ? barW : k * barW + (k - 1) * GAP;
  const step = labelStep(
    rows.map((r) => r.label),
    band,
    FONT,
  );
  const labelMax = Math.max(24, band * step - 6);

  const bars = [];
  rows.forEach((row, i) => {
    const gx = left + i * band + (band - groupW) / 2;
    if (stacked) {
      let pos = 0;
      let neg = 0;
      const lastPos = row.values.reduce((acc, v, j) => (v !== null && v > 0 ? j : acc), -1);
      const lastNeg = row.values.reduce((acc, v, j) => (v !== null && v < 0 ? j : acc), -1);
      row.values.forEach((v, j) => {
        if (v === null || v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        let ya = y(from);
        const yb = y(to);
        // Espace de 2 px entre deux segments empilés (pas de contour).
        if (from !== 0 && Math.abs(yb - ya) > GAP + 1) ya += v > 0 ? -GAP : GAP;
        const outer = j === (v > 0 ? lastPos : lastNeg);
        bars.push({ i, j, d: barPath(gx, ya, yb, barW, outer ? 4 : 0), fill: colors[j] });
      });
    } else {
      row.values.forEach((v, j) => {
        if (v === null || v === 0) return;
        const bx = gx + j * (barW + GAP);
        const fill = bySign ? (v < 0 ? "var(--chart-out)" : "var(--chart-in)") : colors[j];
        bars.push({ i, j, d: barPath(bx, y0, y(v), barW, 4), fill });
      });
    }
  });

  const locate = (i) => {
    const row = rows[i];
    let topValue = 0;
    if (stacked) topValue = row.values.reduce((a, v) => (v !== null && v > 0 ? a + v : a), 0);
    else topValue = Math.max(0, ...row.values.filter((v) => v !== null));
    return { x: left + i * band + band / 2, y: y(topValue) };
  };
  const pointer = (event) => {
    if (!band) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = Math.floor((px - left) / band);
    if (i < 0 || i >= count) {
      if (event.pointerType === "mouse") tipState.hide();
      return;
    }
    const at = locate(i);
    tipState.show(i, at.x, at.y);
  };

  const active = tipState.tip;
  const activeRow = active ? rows[active.index] : null;
  const total = (row) => row.values.reduce((a, v) => (v === null ? a : a + v), 0);
  const tipRows = activeRow
    ? series.map((s, j) => ({
        label: k > 1 ? s.label : undefined,
        value: activeRow.values[j] === null ? "·" : format(activeRow.values[j]),
        color: bySign ? (activeRow.values[j] < 0 ? "var(--chart-out)" : "var(--chart-in)") : colors[j],
      }))
    : [];
  if (activeRow && stacked && k > 1) tipRows.push({ label: "Total", value: format(total(activeRow)) });
  const liveText = activeRow
    ? activeRow.label + " : " + series.map((s, j) => `${s.label} ${activeRow.values[j] === null ? "aucune valeur" : format(activeRow.values[j])}`).join(", ")
    : "";

  const columns = [xTitle, ...series.map((s) => s.label)];
  if (stacked && k > 1) columns.push("Total");
  const tableRows = rows.map((row) => {
    const cells = [row.label, ...row.values.map((v) => (v === null ? "·" : format(v)))];
    if (stacked && k > 1) cells.push(format(total(row)));
    return cells;
  });
  const label = (title ? title + ". " : "") + `Graphique en barres, ${count} ${count > 1 ? "positions" : "position"}. Flèches gauche et droite pour lire les valeurs.`;

  return (
    <ChartFrame
      title={title}
      sub={sub}
      class={className}
      legend={legend && k > 1 ? <ChartLegend items={series.map((s, j) => ({ label: s.label, color: colors[j] }))} /> : null}
      table={table ? <ChartTable columns={columns} rows={tableRows} caption={title} /> : null}
    >
      <div
        class="chart-plot"
        ref={attach}
        style={{ height: height + "px" }}
        tabIndex={0}
        role="group"
        aria-label={label}
        onKeyDown={(event) => tipState.key(event, locate)}
        onBlur={tipState.hide}
      >
        {width > 0 ? (
          <svg
            class="chart-svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            onPointerMove={pointer}
            onPointerDown={pointer}
            onPointerLeave={tipState.leave}
          >
            {scale.ticks.map((t, ti) => (
              <g>
                <line class={t === 0 ? "chart-axis" : "chart-grid"} x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} />
                <text class="chart-tick" x={left - 6} y={y(t)} dy="0.32em" text-anchor="end">
                  {tickLabels[ti]}
                </text>
              </g>
            ))}
            {active ? <rect class="chart-band" x={left + active.index * band + 1} y={top} width={Math.max(0, band - 2)} height={plotH} rx="6" /> : null}
            {bars.map((b) => (
              <path d={b.d} fill={b.fill} class={active && active.index !== b.i ? "chart-mark is-dim" : "chart-mark"} />
            ))}
            {scale.min < 0 ? <line class="chart-axis" x1={left} x2={left + plotW} y1={y0} y2={y0} /> : null}
            {rows.map((row, i) =>
              (count - 1 - i) % step === 0 ? (
                <text class="chart-tick" x={left + i * band + band / 2} y={top + plotH + 16} text-anchor="middle">
                  {fitLabel(row.label, labelMax, FONT)}
                </text>
              ) : null,
            )}
          </svg>
        ) : null}
        {active && activeRow ? <ChartTip x={active.x} y={active.y} width={width} title={activeRow.label} rows={tipRows} /> : null}
        <ChartLive text={liveText} />
      </div>
    </ChartFrame>
  );
}
