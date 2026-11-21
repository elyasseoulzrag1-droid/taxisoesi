// Tuile de chiffre en forme de billet de cinéma : un talon (la période), une ligne de perforation, le chiffre.
// La découpe est faite en CSS seulement (masque radial) : voir .stat dans components.css.
import { Icon } from "./Icon.jsx";
import { Sparkline } from "./charts/Sparkline.jsx";
import { normTone } from "./tone.js";
import { cx } from "./util.js";

/**
 * @param {{
 *   label: import("preact").ComponentChildren, value: import("preact").ComponentChildren, sub?: import("preact").ComponentChildren,
 *   tone?: "neutral"|"accent"|"in"|"out"|"warn"|"info", valueTone?: "none"|"in"|"out",
 *   trend?: { label: string, dir?: "up"|"down"|"flat", good?: boolean|null } | number[],
 *   stub?: string, icon?: string, onClick?: (event: MouseEvent) => void, class?: string
 * }} props
 * - `label` : ce que mesure le chiffre ("Ventes nettes"). `value` : le chiffre déjà mis en forme ("12 480 $").
 * - `sub` : une ligne d'explication sous le chiffre ("marge 31 %").
 * - `stub` : texte court du talon, écrit à la verticale, en général la période ("NOV. 2026"). Sans `stub`, `icon` s'y affiche.
 * - `tone` : teinte du talon. `valueTone` : colore le chiffre lui-même quand son signe est le message (bénéfice ou perte).
 * - `trend` : soit une évolution `{ label: "+12 %", dir: "up", good: true }` (la couleur dit si c'est une bonne nouvelle),
 *   soit une liste de nombres dessinée en mini-courbe.
 * - `onClick` : la tuile devient un bouton (ouvrir le détail).
 */
export function Stat({ label, value, sub, tone = "neutral", valueTone = "none", trend, stub, icon, onClick, class: className }) {
  const t = normTone(tone);
  const Tag = onClick ? "button" : "div";
  const isSeries = Array.isArray(trend);
  const dir = !isSeries && trend ? trend.dir || "flat" : null;
  const good = !isSeries && trend ? trend.good : null;
  return (
    <Tag class={cx("stat", onClick && "stat-action", className)} data-tone={t} type={onClick ? "button" : undefined} onClick={onClick}>
      <span class="stat-card">
        <span class="stat-stub" aria-hidden={stub ? undefined : "true"}>
          {stub ? <span class="stat-stub-text">{stub}</span> : icon ? <Icon name={icon} size={16} /> : null}
        </span>
        <span class="stat-body">
          <span class="stat-label">{label}</span>
          <span class={cx("stat-value", valueTone === "in" && "t-in", valueTone === "out" && "t-out")}>{value}</span>
          {sub || trend ? (
            <span class="stat-foot">
              {sub ? <span class="stat-sub">{sub}</span> : null}
              {isSeries ? <Sparkline values={trend} width={56} height={20} tone={t === "neutral" ? "accent" : t} class="stat-spark" /> : null}
              {!isSeries && trend ? (
                <span class="stat-trend" data-good={good == null ? "none" : good ? "yes" : "no"}>
                  {dir !== "flat" ? <Icon name={dir === "up" ? "arrow-up" : "arrow-down"} size={12} /> : null}
                  <span>{trend.label}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
    </Tag>
  );
}
