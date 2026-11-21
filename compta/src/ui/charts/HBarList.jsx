// Barres horizontales classées : un libellé, un montant et une barre par ligne (catégories, plateformes pub).
import { markColor } from "../tone.js";
import { cx, useMeasure } from "../util.js";
import { ChartEmpty, ChartFrame, ChartTable, ChartTip, defaultFormat, useChartTip } from "./common.jsx";
import { num, roundShares, shares } from "./scale.js";

/**
 * @param {{
 *   items: Array<{ key?: string, label: string, value: number, sub?: string, color?: string, tone?: string }>,
 *   format?: (value: number) => string, tone?: string, sort?: boolean, limit?: number, otherLabel?: string,
 *   onSelect?: (item: object) => void, showShare?: boolean, title?: string, sub?: string,
 *   labelTitle?: string, valueTitle?: string, table?: boolean, emptyText?: string, class?: string
 * }} props
 * - `items` : une ligne par catégorie. La barre est proportionnelle à la valeur absolue ; une valeur négative
 *   garde son signe dans le texte et prend la couleur de sortie.
 * - Couleur : une seule teinte pour toute la liste (`tone`, sinon la première couleur de la palette) ;
 *   `color` ou `tone` sur un élément seulement quand la couleur identifie l'entité (une plateforme, un associé).
 * - `sort` (true par défaut) : du plus grand au plus petit. `limit` : au-delà, le reste est regroupé dans `otherLabel` ("Autres").
 * - `onSelect(item)` : rend chaque ligne cliquable (ex. ouvrir les opérations de la catégorie).
 * - `showShare` : affiche la part du total à côté du montant.
 */
export function HBarList({
  items = [],
  format = defaultFormat,
  tone,
  sort = true,
  limit,
  otherLabel = "Autres",
  onSelect,
  showShare = false,
  title,
  sub,
  labelTitle = "Libellé",
  valueTitle = "Montant",
  table = true,
  emptyText,
  class: className,
}) {
  const { ref: rootRef, attach, width } = useMeasure();
  let list = (items || []).filter((it) => it && num(it.value) !== null);
  if (sort) list = [...list].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (limit && list.length > limit) {
    const head = list.slice(0, limit - 1);
    const tail = list.slice(limit - 1);
    list = [...head, { key: "__other", label: otherLabel, value: tail.reduce((a, it) => a + it.value, 0), tone: "neutral", other: true }];
  }
  const tipState = useChartTip(rootRef, list.length);

  if (!list.length) {
    return (
      <ChartFrame title={title} sub={sub} class={className}>
        <ChartEmpty height={96} text={emptyText} />
      </ChartFrame>
    );
  }

  const max = Math.max(...list.map((it) => Math.abs(it.value)), 0);
  const parts = shares(list.map((it) => Math.abs(it.value)));
  const pcts = roundShares(parts.shares);
  const colorOf = (it, i) => {
    if (it.color || it.tone) return markColor(it, i).fill;
    if (it.value < 0) return "var(--chart-out)";
    return tone ? markColor({ tone }).fill : "var(--chart-1)";
  };
  const tableRows = list.map((it, i) => [it.label, format(it.value), pcts[i] + "\u00a0%"]);
  const active = tipState.tip;
  const activeItem = active ? list[active.index] : null;

  const rowContent = (it, i) => (
    <>
      <span class="hbar-head">
        <span class="hbar-label" title={it.label}>
          {it.label}
        </span>
        <span class="hbar-value num">
          {format(it.value)}
          {showShare ? <span class="hbar-share">{pcts[i] + "\u00a0%"}</span> : null}
        </span>
      </span>
      {it.sub ? <span class="hbar-sub">{it.sub}</span> : null}
      <span class="hbar-track" aria-hidden="true">
        <span class="hbar-fill" style={{ width: (max > 0 ? Math.max((Math.abs(it.value) / max) * 100, it.value ? 1.5 : 0) : 0) + "%", background: colorOf(it, i) }} />
      </span>
    </>
  );
  const hover = (event, i) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const row = event.currentTarget.getBoundingClientRect();
    tipState.show(i, (event.clientX || row.left + row.width / 2) - rect.left, row.top - rect.top);
  };

  return (
    <ChartFrame
      title={title}
      sub={sub}
      class={className}
      table={table ? <ChartTable columns={[labelTitle, valueTitle, "Part"]} rows={tableRows} caption={title} /> : null}
    >
      <div class="chart-plot" ref={attach}>
        <ol class="hbar-list">
          {list.map((it, i) => (
            <li class={cx("hbar-item", active && active.index !== i && "is-dim")}>
              {onSelect && !it.other ? (
                <button
                  type="button"
                  class="hbar-row hbar-row-action"
                  onClick={() => onSelect(it)}
                  onPointerMove={(event) => hover(event, i)}
                  onPointerLeave={tipState.leave}
                  onFocus={(event) => hover(event, i)}
                  onBlur={tipState.hide}
                >
                  {rowContent(it, i)}
                </button>
              ) : (
                <div class="hbar-row" onPointerMove={(event) => hover(event, i)} onPointerDown={(event) => hover(event, i)} onPointerLeave={tipState.leave}>
                  {rowContent(it, i)}
                </div>
              )}
            </li>
          ))}
        </ol>
        {active && activeItem ? (
          <ChartTip
            x={active.x}
            y={active.y}
            width={width}
            title={activeItem.label}
            rows={[{ value: format(activeItem.value), label: pcts[active.index] + "\u00a0% du total", color: colorOf(activeItem, active.index) }]}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}
