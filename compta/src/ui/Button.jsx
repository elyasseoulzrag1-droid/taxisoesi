// Boutons : Button, IconButton, et l'indicateur d'attente Spinner.
import { Icon } from "./Icon.jsx";
import { cx } from "./util.js";

/**
 * Indicateur d'attente. Avec `label`, il est annoncé aux lecteurs d'écran ; sinon il est décoratif.
 * @param {{ size?: number, label?: string, class?: string }} props
 */
export function Spinner({ size = 18, label, class: className }) {
  return (
    <span
      class={cx("spinner", className)}
      style={{ width: size + "px", height: size + "px" }}
      role={label ? "status" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    />
  );
}

function renderIcon(icon, size) {
  if (!icon) return null;
  return typeof icon === "string" ? <Icon name={icon} size={size} /> : icon;
}

/**
 * Bouton d'action.
 * @param {{
 *   variant?: "primary"|"secondary"|"ghost"|"danger", size?: "sm"|"md",
 *   icon?: string|import("preact").ComponentChildren, iconRight?: string|import("preact").ComponentChildren,
 *   loading?: boolean, full?: boolean, disabled?: boolean, type?: "button"|"submit",
 *   onClick?: (event: MouseEvent) => void, class?: string, children?: import("preact").ComponentChildren
 * }} props
 * `loading` affiche l'indicateur d'attente et bloque le bouton (aria-busy) sans changer sa largeur.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  full = false,
  disabled = false,
  type = "button",
  class: className,
  children,
  ...rest
}) {
  const iconSize = size === "sm" ? 16 : 18;
  return (
    <button
      type={type}
      class={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", full && "btn-full", loading && "is-loading", className)}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : renderIcon(icon, iconSize)}
      {children != null && children !== false ? <span class="btn-label">{children}</span> : null}
      {renderIcon(iconRight, iconSize)}
    </button>
  );
}

/**
 * Bouton réduit à une icône. `label` est obligatoire : c'est le nom lu par les lecteurs d'écran (et l'infobulle).
 * @param {{
 *   icon: string, label: string, variant?: "ghost"|"secondary"|"primary"|"danger", size?: "sm"|"md",
 *   disabled?: boolean, pressed?: boolean, onClick?: (event: MouseEvent) => void, class?: string
 * }} props
 */
export function IconButton({ icon, label, variant = "ghost", size = "md", pressed, class: className, type = "button", ...rest }) {
  return (
    <button
      type={type}
      class={cx("icon-btn", `btn-${variant}`, size === "sm" && "icon-btn-sm", className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed == null ? undefined : pressed ? "true" : "false"}
      {...rest}
    >
      {typeof icon === "string" ? <Icon name={icon} size={size === "sm" ? 18 : 20} /> : icon}
    </button>
  );
}
