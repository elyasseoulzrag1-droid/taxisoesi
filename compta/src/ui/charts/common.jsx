// Pièces communes aux graphiques : infobulle, légende, vue tableau, état vide, survol au doigt et au clavier.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { clamp, cx } from "../util.js";

/** Mise en forme par défaut d'une valeur quand l'appelant ne passe pas `format`. */
export function defaultFormat(value) {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value).replace(/ /g, " ");
}

/**
 * État de l'infobulle d'un graphique : quel élément est actif et où placer la bulle.
 * Souris : la bulle suit le survol et disparaît en sortant. Doigt : elle reste jusqu'à un appui ailleurs.
 * Clavier : flèches gauche / droite pour parcourir, Échap pour fermer.
 * @param {import("preact").RefObject<HTMLElement>} rootRef conteneur du graphique
 * @param {number} count nombre d'éléments parcourables
 */
export function useChartTip(rootRef, count) {
  const [tip, setTip] = useState(null);
  const tipRef = useRef(tip);
  tipRef.current = tip;

  useEffect(() => {
    if (!tip) return undefined;
    const onDown = (event) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target)) setTip(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [!!tip, rootRef]);

  const show = (index, x, y) => {
    const prev = tipRef.current;
    if (prev && prev.index === index && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5) return;
    setTip({ index, x, y });
  };
  const hide = () => {
    if (tipRef.current) setTip(null);
  };

  return {
    tip: tip && tip.index < count ? tip : null,
    show,
    hide,
    /** À brancher sur onPointerLeave : ne ferme que pour une souris. */
    leave(event) {
      if (event.pointerType === "mouse") hide();
    },
    /**
     * À brancher sur onKeyDown du conteneur focalisable.
     * @param {KeyboardEvent} event
     * @param {(index: number) => { x: number, y: number }} locate position de la bulle pour un élément
     */
    key(event, locate) {
      if (!count) return;
      const current = tipRef.current ? tipRef.current.index : -1;
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(count - 1, current + 1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current < 0 ? count - 1 : Math.max(0, current - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = count - 1;
      else if (event.key === "Escape") {
        hide();
        return;
      }
      if (next === null) return;
      event.preventDefault();
      const at = locate(next);
      show(next, at.x, at.y);
    },
  };
}

/**
 * Infobulle. Les valeurs passent avant les noms ; chaque ligne est repérée par un trait de la couleur de sa série.
 * @param {{ x: number, y: number, width: number, title?: string, rows: Array<{ label?: string, value: string, color?: string }> }} props
 * x, y : point visé, en px dans le conteneur. width : largeur du conteneur (la bulle n'en sort pas).
 */
export function ChartTip({ x, y, width, title, rows }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = clamp(x - w / 2, 0, Math.max(0, width - w)) + "px";
    el.style.top = Math.max(-8, y - h - 10) + "px";
    el.style.visibility = "visible";
  });
  return (
    <div class="chart-tip" ref={ref} style={{ visibility: "hidden" }}>
      {title ? <div class="chart-tip-title">{title}</div> : null}
      {rows.map((row) => (
        <div class="chart-tip-row">
          {row.color ? <span class="chart-tip-key" style={{ background: row.color }} /> : null}
          <span class="chart-tip-value num">{row.value}</span>
          {row.label ? <span class="chart-tip-label">{row.label}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Zone annoncée aux lecteurs d'écran quand on parcourt le graphique au clavier.
 * @param {{ text: string }} props
 */
export function ChartLive({ text }) {
  return (
    <div class="sr-only" role="status" aria-live="polite">
      {text}
    </div>
  );
}

/**
 * Légende : toujours présente à partir de deux séries.
 * @param {{ items: Array<{ label: string, color: string, value?: string }>, shape?: "rect"|"line", class?: string }} props
 */
export function ChartLegend({ items, shape = "rect", class: className }) {
  if (!items || !items.length) return null;
  return (
    <ul class={cx("chart-legend", className)}>
      {items.map((item) => (
        <li class="chart-legend-item">
          <span class={cx("chart-swatch", shape === "line" && "chart-swatch-line")} style={{ background: item.color }} aria-hidden="true" />
          <span class="chart-legend-label">{item.label}</span>
          {item.value ? <span class="chart-legend-value num">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Vue tableau des mêmes données, repliée par défaut : chaque valeur reste lisible sans survol.
 * @param {{ columns: string[], rows: Array<Array<string>>, summary?: string, caption?: string }} props
 */
export function ChartTable({ columns, rows, summary = "Voir les chiffres", caption }) {
  if (!rows || !rows.length) return null;
  return (
    <details class="chart-details">
      <summary class="chart-details-summary">{summary}</summary>
      <div class="scroll-x">
        <table class="chart-table">
          {caption ? <caption class="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th scope="col" class={i > 0 ? "is-num" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th scope="row">{cell}</th>
                  ) : (
                    <td class="is-num num">{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * État vide d'un graphique (aucune donnée sur la période).
 * @param {{ height?: number, text?: string }} props
 */
export function ChartEmpty({ height = 120, text = "Pas encore de données sur cette période." }) {
  return (
    <div class="chart-empty" style={{ minHeight: height + "px" }}>
      <p>{text}</p>
    </div>
  );
}

/**
 * Cadre commun : titre facultatif, légende, zone de tracé, vue tableau.
 * @param {{ title?: string, sub?: string, legend?: any, table?: any, class?: string, children?: any }} props
 */
export function ChartFrame({ title, sub, legend, table, class: className, children }) {
  return (
    <figure class={cx("chart", className)}>
      {title || sub ? (
        <figcaption class="chart-caption">
          {title ? <span class="chart-title">{title}</span> : null}
          {sub ? <span class="chart-sub">{sub}</span> : null}
        </figcaption>
      ) : null}
      {legend}
      {children}
      {table}
    </figure>
  );
}
