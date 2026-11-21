// Courbes : une ou plusieurs séries dans le temps, repère vertical au survol, aplat léger pour une série seule.
import { markColor } from "../tone.js";
import { useMeasure } from "../util.js";
import { readLabel, readValue } from "./BarChart.jsx";
import { ChartEmpty, ChartFrame, ChartLegend, ChartLive, ChartTable, ChartTip, defaultFormat, useChartTip } from "./common.jsx";
import { extent, fitLabel, labelStep, linePaths, linear, textWidth, axisScale } from "./scale.js";

const FONT = 11;

/**
 * @param {{
 *   data: object[], series: Array<{ key: string, label: string, color?: string, tone?: string, value?: (row: object) => number }>,
 *   x?: string|((row: object, index: number) => string), format?: (value: number) => string, formatAxis?: (value: number) => string,
 *   area?: boolean, zero?: boolean, height?: number, title?: string, sub?: string, xTitle?: string,
 *   legend?: boolean, table?: boolean, emptyText?: string, class?: string
 * }} props
 * - Mêmes `data`, `series`, `x`, `format` que BarChart. Une valeur absente (null) coupe la ligne.
 * - `area` : aplat léger sous la courbe (réservé à une série seule). `zero` (true par défaut) : l'axe inclut zéro.
 * - Un seul point : il est dessiné comme un point isolé.
 */
export function LineChart({
  data = [],
  series = [],
  x = "label",
  format = defaultFormat,
  formatAxis,
  area = false,
  zero = true,
  height = 200,
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
  const colors = series.map((s, j) => markColor(s, j).fill);
  const axisFormat = formatAxis || format;

  if (!hasData) {
    return (
      <ChartFrame title={title} sub={sub} class={className}>
        <ChartEmpty height={Math.min(height, 140)} text={emptyText} />
      </ChartFrame>
    );
  }

  let [dMin, dMax] = extent(rows.flatMap((r) => r.values));
  if (zero) {
    dMin = Math.min(0, dMin);
    dMax = Math.max(0, dMax);
  }
  const scale = axisScale(dMin, dMax, height < 190 ? 3 : 4);
  const axisInfo = { max: Math.max(Math.abs(scale.min), Math.abs(scale.max)), step: scale.step };
  const tickLabels = scale.ticks.map((t) => axisFormat(t, axisInfo));
  const left = Math.min(76, Math.ceil(Math.max(...tickLabels.map((t) => textWidth(t, FONT)))) + 10);
  const top = 12;
  const bottom = 26;
  const right = 12;
  const plotW = Math.max(0, width - left - right);
  const plotH = Math.max(40, height - top - bottom);
  const y = linear([scale.min, scale.max], [top + plotH, top]);
  const xAt = (i) => (count === 1 ? left + plotW / 2 : left + (i * plotW) / (count - 1));
  const gap = count > 1 ? plotW / (count - 1) : plotW;
  const step = labelStep(
    rows.map((r) => r.label),
    gap,
    FONT,
  );
  const labelMax = Math.max(24, gap * step - 6);
  const k = series.length;

  const lines = series.map((s, j) => {
    const points = rows.map((row, i) => (row.values[j] === null ? null : { x: xAt(i), y: y(row.values[j]) }));
    const present = points.filter(Boolean);
    return { points, present, paths: linePaths(points), last: present[present.length - 1] || null };
  });
  const baseY = y(Math.max(scale.min, Math.min(scale.max, 0)));
  const areaPath =
    area && k === 1 && lines[0].present.length >= 2
      ? `${linePaths(lines[0].present)[0]}L${lines[0].present[lines[0].present.length - 1].x} ${baseY}L${lines[0].present[0].x} ${baseY}Z`
      : null;

  const locate = (i) => {
    const ys = rows[i].values.filter((v) => v !== null).map((v) => y(v));
    return { x: xAt(i), y: ys.length ? Math.min(...ys) : top };
  };
  const pointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = count === 1 || !plotW ? 0 : Math.max(0, Math.min(count - 1, Math.round(((px - left) / plotW) * (count - 1))));
    const at = locate(i);
    tipState.show(i, at.x, at.y);
  };

  const active = tipState.tip;
  const activeRow = active ? rows[active.index] : null;
  const tipRows = activeRow
    ? series.map((s, j) => ({
        label: k > 1 ? s.label : undefined,
        value: activeRow.values[j] === null ? "·" : format(activeRow.values[j]),
        color: colors[j],
      }))
    : [];
  const liveText = activeRow
    ? activeRow.label + " : " + series.map((s, j) => `${s.label} ${activeRow.values[j] === null ? "aucune valeur" : format(activeRow.values[j])}`).join(", ")
    : "";
  const columns = [xTitle, ...series.map((s) => s.label)];
  const tableRows = rows.map((row) => [row.label, ...row.values.map((v) => (v === null ? "·" : format(v)))]);
  const label = (title ? title + ". " : "") + `Courbe, ${count} ${count > 1 ? "points" : "point"}. Flèches gauche et droite pour lire les valeurs.`;

  return (
    <ChartFrame
      title={title}
      sub={sub}
      class={className}
      legend={legend && k > 1 ? <ChartLegend shape="line" items={series.map((s, j) => ({ label: s.label, color: colors[j] }))} /> : null}
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
            {active ? <line class="chart-cross" x1={active.x} x2={active.x} y1={top} y2={top + plotH} /> : null}
            {areaPath ? <path class="chart-area" d={areaPath} fill={colors[0]} /> : null}
            {lines.map((line, j) => (
              <g>
                {line.paths.map((d) => (
                  <path class="chart-line" d={d} stroke={colors[j]} />
                ))}
                {/* Un point isolé (seul, ou entre deux valeurs absentes) reste visible. */}
                {line.points.map((p, i) =>
                  p && !line.points[i - 1] && !line.points[i + 1] ? <circle class="chart-dot" cx={p.x} cy={p.y} r="4" fill={colors[j]} /> : null,
                )}
                {line.last && !active ? <circle class="chart-dot" cx={line.last.x} cy={line.last.y} r="4" fill={colors[j]} /> : null}
                {active && line.points[active.index] ? (
                  <circle class="chart-dot" cx={line.points[active.index].x} cy={line.points[active.index].y} r="4.5" fill={colors[j]} />
                ) : null}
              </g>
            ))}
            {rows.map((row, i) =>
              (count - 1 - i) % step === 0 ? (
                <text
                  class="chart-tick"
                  x={xAt(i)}
                  y={top + plotH + 16}
                  text-anchor={count === 1 ? "middle" : i === 0 ? "start" : i === count - 1 ? "end" : "middle"}
                >
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
