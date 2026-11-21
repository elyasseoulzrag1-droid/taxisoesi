// Tableau de données : un vrai <table> dans un conteneur défilant sur grand écran,
// des lignes empilées sur deux niveaux (titre et montant, puis détails) sur téléphone.
import { phoneSlots } from "./table-slots.js";
import { cx, useMediaQuery } from "./util.js";

const WIDE = "(min-width: 720px)";

function cellContent(column, row, index) {
  if (column.render) return column.render(row, index);
  const value = row == null ? null : row[column.key];
  return value == null ? "" : value;
}

function isBlank(node) {
  return node == null || node === false || node === "";
}

/**
 * @param {{
 *   columns: Array<{
 *     key: string, label: import("preact").ComponentChildren, align?: "left"|"right"|"center", width?: string,
 *     render?: (row: any, index: number) => import("preact").ComponentChildren,
 *     phone?: "title"|"amount"|"sub"|"aside"|"hide", phoneLabel?: boolean, class?: string
 *   }>,
 *   rows: any[], rowKey?: string|((row: any, index: number) => string), onRowClick?: (row: any) => void,
 *   empty?: import("preact").ComponentChildren, footer?: any, caption?: string, dense?: boolean,
 *   rowClass?: (row: any) => string|undefined, class?: string
 * }} props
 * - `columns[].render(row)` rend la cellule (sinon `row[key]`). `align: "right"` pour les montants (chiffres alignés).
 * - Sur téléphone chaque ligne tient sur deux niveaux : `phone: "title"` (en haut à gauche) et `phone: "amount"` (en haut à droite),
 *   puis `phone: "sub"` (détails, à la suite) et `phone: "aside"` (en bas à droite). `phone: "hide"` masque la colonne.
 *   Sans indication : la première colonne est le titre, la dernière colonne alignée à droite est le montant, le reste va en détails.
 *   `phoneLabel: true` fait précéder la valeur du nom de la colonne dans les détails ("Compte : Revolut").
 * - `onRowClick(row)` : la ligne devient cliquable (au clavier : Entrée ou Espace).
 * - `footer` : une ligne de total, rendue avec les mêmes colonnes (objet de même forme qu'une ligne).
 * - `empty` : contenu affiché quand `rows` est vide (en général un EmptyState).
 */
export function Table({ columns = [], rows = [], rowKey, onRowClick, empty, footer, caption, dense = false, rowClass, class: className }) {
  const wide = useMediaQuery(WIDE);
  const keyOf = (row, i) => (typeof rowKey === "function" ? rowKey(row, i) : rowKey && row ? row[rowKey] : i);
  if (!rows || !rows.length) {
    return <div class={cx("table-empty", className)}>{empty == null ? <p class="subtle">Rien à afficher pour le moment.</p> : empty}</div>;
  }

  if (wide) {
    const activate = (event, row) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onRowClick(row);
      }
    };
    return (
      <div class={cx("table-wrap scroll-x", className)}>
        <table class={cx("table", dense && "table-dense")}>
          {caption ? <caption class="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c) => (
                <th scope="col" class={cx(c.align === "right" && "is-num", c.align === "center" && "is-center", c.class)} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                class={cx(onRowClick && "is-clickable", rowClass && rowClass(row))}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => event.target === event.currentTarget && activate(event, row) : undefined}
              >
                {columns.map((c) => (
                  <td class={cx(c.align === "right" && "is-num num", c.align === "center" && "is-center", c.class)}>{cellContent(c, row, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? (
            <tfoot>
              <tr>
                {columns.map((c) => (
                  <td class={cx(c.align === "right" && "is-num num", c.align === "center" && "is-center", c.class)}>{cellContent(c, footer, -1)}</td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  }

  const slots = phoneSlots(columns);
  const stacked = (row, i, isFooter) => {
    const subs = slots.sub
      .map((c) => ({ c, node: cellContent(c, row, i) }))
      .filter((s) => !isBlank(s.node));
    const asides = slots.aside
      .map((c) => ({ c, node: cellContent(c, row, i) }))
      .filter((s) => !isBlank(s.node));
    const inner = (
      <>
        <span class="trow-line">
          <span class="trow-title">{slots.title ? cellContent(slots.title, row, i) : null}</span>
          {slots.amount ? <span class="trow-amount num">{cellContent(slots.amount, row, i)}</span> : null}
        </span>
        {subs.length || asides.length ? (
          <span class="trow-line trow-line-sub">
            <span class="trow-sub">
              <span class="trow-sub-in">
                {subs.map((s) => (
                  <span class="trow-sub-item">
                    <span class="trow-sub-value">
                      {s.c.phoneLabel ? <span class="trow-sub-label">{s.c.label} : </span> : null}
                      {s.node}
                    </span>
                  </span>
                ))}
              </span>
            </span>
            {asides.length ? (
              <span class="trow-aside">
                {asides.map((s) => (
                  <span class="trow-sub-item">{s.node}</span>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
      </>
    );
    const classes = cx("trow", isFooter && "trow-foot", !isFooter && rowClass && rowClass(row));
    if (onRowClick && !isFooter) {
      return (
        <li key={keyOf(row, i)}>
          <button type="button" class={cx(classes, "trow-action")} onClick={() => onRowClick(row)}>
            {inner}
          </button>
        </li>
      );
    }
    return (
      <li key={isFooter ? "__footer" : keyOf(row, i)} class={classes}>
        {inner}
      </li>
    );
  };
  return (
    <ul class={cx("table-stack", dense && "table-dense", className)} aria-label={caption}>
      {rows.map((row, i) => stacked(row, i, false))}
      {footer ? stacked(footer, -1, true) : null}
    </ul>
  );
}
