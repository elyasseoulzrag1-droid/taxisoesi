// Onglets : une rangée de titres (défilable si elle déborde) et le panneau de l'onglet actif.
import { useRef } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { cx, useStableId } from "./util.js";

/**
 * @param {{
 *   tabs: Array<{ id: string, label: string, icon?: string, count?: number|string }>,
 *   value: string, onChange: (id: string) => void, label?: string, class?: string,
 *   children?: import("preact").ComponentChildren
 * }} props
 * - `value` : identifiant de l'onglet actif. `children` : le contenu de l'onglet actif (rendu dans le panneau relié à l'onglet).
 * - `label` : nom de la rangée pour les lecteurs d'écran. Flèches gauche / droite, Début et Fin au clavier.
 */
export function Tabs({ tabs = [], value, onChange, label, class: className, children }) {
  const base = useStableId("tabs");
  const listRef = useRef(null);
  const current = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );
  const go = (index) => {
    const tab = tabs[index];
    if (!tab) return;
    if (onChange && tab.id !== value) onChange(tab.id);
    const buttons = listRef.current ? listRef.current.querySelectorAll('[role="tab"]') : [];
    if (buttons[index]) {
      buttons[index].focus();
      if (buttons[index].scrollIntoView) buttons[index].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };
  const onKeyDown = (event) => {
    if (!tabs.length) return;
    if (event.key === "ArrowRight") go((current + 1) % tabs.length);
    else if (event.key === "ArrowLeft") go((current - 1 + tabs.length) % tabs.length);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(tabs.length - 1);
    else return;
    event.preventDefault();
  };
  const active = tabs[current];
  return (
    <div class={cx("tabs", className)}>
      <div class="tabs-list" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => {
          const selected = i === current;
          return (
            <button
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              class={cx("tab", selected && "is-on")}
              aria-selected={selected ? "true" : "false"}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange && tab.id !== value && onChange(tab.id)}
            >
              {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
              <span>{tab.label}</span>
              {tab.count != null && tab.count !== "" ? <span class="tab-count num">{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children != null ? (
        <div class="tabs-panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={active ? `${base}-tab-${active.id}` : undefined} tabIndex={0}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
