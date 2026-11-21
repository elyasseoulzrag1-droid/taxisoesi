// Composants d'affichage : étiquettes, cartes, sections, états vides, bandeaux, montants, dates, pastilles.
import { IconButton } from "./Button.jsx";
import { Icon } from "./Icon.jsx";
import { EMPTY, fmtDate, fmtMoney, initials } from "./format.js";
import { TONE_ICON, normTone, seriesColor, seriesInk } from "./tone.js";
import { clamp, cx } from "./util.js";

/**
 * Petite étiquette d'état ("À vérifier", "Pointée", "Estimé").
 * @param {{ tone?: "neutral"|"accent"|"in"|"out"|"warn"|"info", icon?: string, title?: string, class?: string, children?: import("preact").ComponentChildren }} props
 */
export function Badge({ tone = "neutral", icon, title, class: className, children }) {
  return (
    <span class={cx("badge", className)} data-tone={normTone(tone)} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      <span class="badge-text">{children}</span>
    </span>
  );
}

/**
 * Pastille cliquable : filtre rapide, suggestion, valeur sélectionnée que l'on peut retirer.
 * @param {{
 *   selected?: boolean, onClick?: (event: MouseEvent) => void, onRemove?: () => void, icon?: string,
 *   disabled?: boolean, removeLabel?: string, class?: string, children?: import("preact").ComponentChildren
 * }} props
 * Avec `onClick` : un bouton à bascule (aria-pressed quand `selected` est fourni). Avec `onRemove` : une croix pour retirer.
 */
export function Chip({ selected, onClick, onRemove, icon, disabled = false, removeLabel = "Retirer", class: className, children }) {
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span class="chip-text">{children}</span>
    </>
  );
  const classes = cx("chip", selected && "is-on", onRemove && "chip-removable", className);
  if (!onClick && !onRemove) return <span class={classes}>{content}</span>;
  return (
    <span class={classes}>
      {onClick ? (
        <button
          type="button"
          class="chip-main"
          disabled={disabled}
          aria-pressed={selected == null ? undefined : selected ? "true" : "false"}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <span class="chip-main">{content}</span>
      )}
      {onRemove ? (
        <button type="button" class="chip-remove" aria-label={removeLabel} disabled={disabled} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Surface de contenu. `onClick` en fait un bouton (toute la carte est cliquable).
 * @param {{ pad?: boolean|"sm"|"lg", flat?: boolean, onClick?: (event: MouseEvent) => void, class?: string, children?: import("preact").ComponentChildren }} props
 * `pad` : marge intérieure (true par défaut, false pour un contenu bord à bord comme un tableau). `flat` : sans ombre, fond discret.
 */
export function Card({ pad = true, flat = false, onClick, class: className, children, ...rest }) {
  const classes = cx("card", pad === "sm" && "card-pad-sm", pad === "lg" && "card-pad-lg", pad === true && "card-pad", flat && "card-flat", className);
  if (onClick) {
    return (
      <button type="button" class={cx(classes, "card-action")} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <div class={classes} {...rest}>
      {children}
    </div>
  );
}

/**
 * Bloc titré d'une page.
 * @param {{ title?: import("preact").ComponentChildren, sub?: import("preact").ComponentChildren, action?: import("preact").ComponentChildren, class?: string, children?: import("preact").ComponentChildren }} props
 * `action` : bouton ou lien aligné à droite du titre ("Tout voir").
 */
export function Section({ title, sub, action, class: className, children }) {
  return (
    <section class={cx("section", className)}>
      {title || action ? (
        <header class="section-head">
          <div class="section-heading">
            {title ? <h2 class="section-title">{title}</h2> : null}
            {sub ? <p class="section-sub">{sub}</p> : null}
          </div>
          {action ? <div class="section-action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * État vide d'une liste : dit ce qui apparaîtra ici et comment ajouter le premier élément.
 * @param {{ icon?: string, title: import("preact").ComponentChildren, text?: import("preact").ComponentChildren, action?: import("preact").ComponentChildren, compact?: boolean, class?: string }} props
 */
export function EmptyState({ icon = "ticket", title, text, action, compact = false, class: className }) {
  return (
    <div class={cx("empty", compact && "empty-compact", className)}>
      {icon ? (
        <span class="empty-icon" aria-hidden="true">
          <Icon name={icon} size={compact ? 20 : 24} />
        </span>
      ) : null}
      <div class="empty-body">
        <p class="empty-title">{title}</p>
        {text ? <p class="empty-text">{text}</p> : null}
        {action ? <div class="empty-action">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Bandeau d'information dans la page.
 * @param {{
 *   tone?: "info"|"warn"|"in"|"out"|"neutral"|"accent", title?: import("preact").ComponentChildren, icon?: string,
 *   action?: import("preact").ComponentChildren, onClose?: () => void, class?: string, children?: import("preact").ComponentChildren
 * }} props
 * `action` : bouton à droite (sous le texte sur téléphone). Un bandeau "out" est annoncé comme une alerte.
 */
export function Banner({ tone = "info", title, icon, action, onClose, class: className, children }) {
  const t = normTone(tone, "info");
  return (
    <div class={cx("banner", className)} data-tone={t} role={t === "out" ? "alert" : "status"}>
      <Icon name={icon || TONE_ICON[t]} size={18} class="banner-icon" />
      <div class="banner-body">
        {title ? <p class="banner-title">{title}</p> : null}
        {children ? <div class="banner-text">{children}</div> : null}
      </div>
      {action ? <div class="banner-action">{action}</div> : null}
      {onClose ? <IconButton icon="close" label="Masquer ce message" size="sm" class="banner-close" onClick={onClose} /> : null}
    </div>
  );
}

/**
 * Forme grise d'attente pendant un chargement.
 * @param {{ width?: number|string, height?: number|string, lines?: number, radius?: number|string, class?: string }} props
 * `lines` : rend plusieurs lignes de texte factices (la dernière plus courte).
 */
export function Skeleton({ width, height, lines, radius, class: className }) {
  const size = (v) => (typeof v === "number" ? v + "px" : v);
  if (lines && lines > 1) {
    return (
      <span class={cx("skeleton-lines", className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span class="skeleton" style={{ width: i === lines - 1 ? "62%" : "100%", height: size(height) || "0.85em" }} />
        ))}
      </span>
    );
  }
  return (
    <span
      class={cx("skeleton", className)}
      aria-hidden="true"
      style={{ width: size(width) || "100%", height: size(height) || "1em", borderRadius: radius == null ? undefined : size(radius) }}
    />
  );
}

/**
 * Barre de progression ou jauge.
 * @param {{ value: number, max?: number, tone?: "accent"|"in"|"out"|"warn"|"info"|"neutral", label?: string, showValue?: boolean, class?: string }} props
 * `label` : nom lu par les lecteurs d'écran. `showValue` : affiche le pourcentage à droite.
 */
export function ProgressBar({ value, max = 100, tone = "accent", label, showValue = false, class: className }) {
  const ratio = max > 0 && Number.isFinite(value) ? clamp(value / max, 0, 1) : 0;
  const pctValue = Math.round(ratio * 100);
  return (
    <div class={cx("progress", className)} data-tone={normTone(tone, "accent")}>
      <div
        class="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctValue}
      >
        <div class="progress-fill" style={{ width: pctValue + "%" }} />
      </div>
      {showValue ? <span class="progress-value num">{pctValue + " %"}</span> : null}
    </div>
  );
}

/**
 * Pastille de couleur d'un associé, d'un compte ou d'une plateforme.
 * @param {{ index?: number, color?: string, label?: string, size?: number, class?: string }} props
 * `index` : position stable de l'entité (0 pour le premier associé...) dans la palette des séries. `label` : texte lu par les lecteurs d'écran.
 */
export function PartnerDot({ index, color, label, size = 10, class: className }) {
  return (
    <span
      class={cx("dot", className)}
      style={{ background: color || seriesColor(index == null ? -1 : index), width: size + "px", height: size + "px" }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    />
  );
}

/**
 * Rond avec les initiales d'une personne, à la couleur de sa série.
 * @param {{ name: string, index?: number, color?: string, size?: "sm"|"md"|"lg", class?: string }} props
 */
export function Avatar({ name, index, color, size = "md", class: className }) {
  const i = index == null ? -1 : index;
  return (
    <span
      class={cx("avatar", `avatar-${size}`, className)}
      style={{ background: color || seriesColor(i), color: color ? "var(--on-fill)" : seriesInk(i) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/**
 * Montant mis en forme (chiffres alignés, moins typographique).
 * @param {{
 *   cents: number|null, currency?: string, sign?: boolean, tone?: "auto"|"none"|"in"|"out", approx?: boolean,
 *   round?: boolean, code?: boolean, class?: string
 * }} props
 * - `tone` : "none" (défaut, encre normale), "auto" (vert si positif, rouge si négatif, neutre à zéro), "in" ou "out" pour forcer.
 * - `sign` : affiche le "+" sur un montant positif. `approx` : préfixe "≈" (estimé par un taux de change), avec une infobulle.
 * - `round` : sans les centimes. `code` : ajoute le code devise. Un montant absent affiche un point discret.
 */
export function Money({ cents, currency = "USD", sign = false, tone = "none", approx = false, round = false, code = false, class: className }) {
  if (cents == null || !Number.isFinite(cents)) {
    return (
      <span class={cx("money num subtle", className)} aria-label="Pas de montant">
        {EMPTY}
      </span>
    );
  }
  const resolved = tone === "auto" ? (cents > 0 ? "in" : cents < 0 ? "out" : "none") : tone;
  return (
    <span
      class={cx("money num", resolved === "in" && "t-in", resolved === "out" && "t-out", className)}
      title={approx ? "Montant estimé avec le taux de change" : undefined}
    >
      {fmtMoney(cents, currency, { sign, round, code, approx })}
    </span>
  );
}

/**
 * Date mise en forme dans une balise <time>.
 * @param {{ date: string, style?: "moyen"|"long"|"court"|"jour"|"auto", class?: string }} props
 * `date` : "AAAA-MM-JJ". `style` : voir fmtDate ("auto" masque l'année en cours).
 */
export function DateText({ date, style = "moyen", class: className }) {
  const text = fmtDate(date, style);
  if (!text) return <span class={cx("subtle", className)}>{EMPTY}</span>;
  return (
    <time class={cx("date num", className)} dateTime={date}>
      {text}
    </time>
  );
}
