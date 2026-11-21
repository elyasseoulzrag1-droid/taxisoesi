// Une barre à 100 % découpée en parts, avec sa légende (qui a mis quoi, répartition de la pub par plateforme).
import { markColor } from "../tone.js";
import { cx, useMeasure } from "../util.js";
import { ChartEmpty, ChartFrame, ChartLegend, ChartTable, ChartTip, defaultFormat, useChartTip } from "./common.jsx";
import { num, roundShares, shares, textWidth } from "./scale.js";

const GAP = 2;

/**
 * @param {{
 *   segments: Array<{ key?: string, label: string, value: number, color?: string, tone?: string }>,
 *   format?: (value: number) => string, variant?: "tall"|"thin", legend?: boolean, title?: string, sub?: string,
 *   labelTitle?: string, valueTitle?: string, table?: boolean, emptyText?: string, class?: string
 * }} props
 * - `segments` : les parts, dans un ordre stable (la couleur suit l'entité, pas son rang). Six au plus : regroupe le reste dans "Autres".
 *   Seules les valeurs strictement positives sont dessinées (une part nulle ou négative reste dans la légende et le tableau).
 * - `variant` : "tall" (28 px, le pourcentage est écrit dans chaque part quand il tient) ou "thin" (8 px, sans texte,
 *   à poser à côté de chiffres déjà visibles).
 * - La légende donne le nom et le montant de chaque part ; survol, toucher ou focus donnent nom, montant et part.
 */
export function SplitBar({
  segments = [],
  format = defaultFormat,
  variant = "tall",
  legend = true,
  title,
  sub,
  labelTitle = "Part",
  valueTitle = "Montant",
  table = true,
  emptyText,
  class: className,
}) {
  const { ref: rootRef, attach, width } = useMeasure();
  const list = (segments || []).filter((s) => s && num(s.value) !== null);
  const tipState = useChartTip(rootRef, list.length);
  const parts = shares(list.map((s) => s.value));

  if (!list.length || parts.total <= 0) {
    return (
      <ChartFrame title={title} sub={sub} class={className}>
        <ChartEmpty height={72} text={emptyText} />
      </ChartFrame>
    );
  }

  const pcts = roundShares(parts.shares);
  const colors = list.map((s, i) => markColor(s, i));
  const drawn = list.map((s, i) => ({ s, i })).filter(({ i }) => parts.shares[i] > 0);
  const usable = Math.max(0, width - GAP * (drawn.length - 1));
  const tall = variant !== "thin";
  const active = tipState.tip;
  const activeSeg = active ? list[active.index] : null;
  const describe = (i) => `${list[i].label} : ${format(list[i].value)} (${pcts[i]}\u00a0%)`;
  const aim = (event, i) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const seg = event.currentTarget.getBoundingClientRect();
    tipState.show(i, seg.left + seg.width / 2 - rect.left, seg.top - rect.top);
  };

  return (
    <ChartFrame
      title={title}
      sub={sub}
      class={className}
      table={
        table ? (
          <ChartTable
            columns={[labelTitle, valueTitle, "Part"]}
            rows={list.map((s, i) => [s.label, format(s.value), parts.shares[i] > 0 ? pcts[i] + "\u00a0%" : "·"])}
            caption={title}
          />
        ) : null
      }
    >
      <div class="chart-plot" ref={attach}>
        <div class={cx("splitbar", tall ? "splitbar-tall" : "splitbar-thin")} role="list" aria-label={title || "Répartition"}>
          {drawn.map(({ s, i }) => {
            const text = pcts[i] + "\u00a0%";
            const px = usable * parts.shares[i];
            const fits = tall && px >= textWidth(text, 12) + 14;
            return (
              <div
                class={cx("splitbar-seg", active && active.index !== i && "is-dim")}
                role="listitem"
                tabIndex={0}
                aria-label={describe(i)}
                style={{ flexGrow: parts.shares[i], background: colors[i].fill, color: colors[i].ink }}
                onPointerMove={(event) => aim(event, i)}
                onPointerDown={(event) => aim(event, i)}
                onPointerLeave={tipState.leave}
                onFocus={(event) => aim(event, i)}
                onBlur={tipState.hide}
              >
                {fits ? <span class="splitbar-text num">{text}</span> : null}
              </div>
            );
          })}
        </div>
        {active && activeSeg ? (
          <ChartTip
            x={active.x}
            y={active.y}
            width={width}
            title={activeSeg.label}
            rows={[{ value: format(activeSeg.value), label: pcts[active.index] + "\u00a0% du total", color: colors[active.index].fill }]}
          />
        ) : null}
      </div>
      {legend ? (
        <ChartLegend
          class="splitbar-legend"
          items={list.map((s, i) => ({ label: s.label, color: colors[i].fill, value: format(s.value) + (tall ? "" : " · " + pcts[i] + "\u00a0%") }))}
        />
      ) : null}
    </ChartFrame>
  );
}
