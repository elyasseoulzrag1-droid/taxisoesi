// Menu d'actions qui se déroule sous un bouton (les trois points d'une ligne, "Exporter"...).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, IconButton } from "./Button.jsx";
import { Icon } from "./Icon.jsx";
import { Portal, clamp, cx, useStableId } from "./util.js";

function MenuList({ id, items, align, anchor, onClose }) {
  const ref = useRef(null);
  const enabled = items.map((it, i) => (it && !it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);

  // Le menu est en position fixe, calé sous le bouton, et ne sort jamais de l'écran.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return undefined;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const left = clamp(align === "start" ? a.left : a.right - w, 8, Math.max(8, vw - w - 8));
      const below = a.bottom + 6;
      const top = below + h <= vh - 8 ? below : Math.max(8, a.top - h - 6);
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.visibility = "visible";
    };
    place();
    const first = el.querySelector('[role="menuitem"]:not([disabled])');
    if (first) first.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (event) => {
      const el = ref.current;
      if (el && !el.contains(event.target) && !(anchor && anchor.contains(event.target))) onClose(false);
    };
    const onScroll = (event) => {
      const el = ref.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  const onKeyDown = (event) => {
    const buttons = ref.current ? Array.from(ref.current.querySelectorAll('[role="menuitem"]:not([disabled])')) : [];
    const at = buttons.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = buttons[(at + 1) % buttons.length];
    else if (event.key === "ArrowUp") next = buttons[(at - 1 + buttons.length) % buttons.length];
    else if (event.key === "Home") next = buttons[0];
    else if (event.key === "End") next = buttons[buttons.length - 1];
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    } else if (event.key === "Tab") {
      onClose(false);
      return;
    } else return;
    event.preventDefault();
    if (next) next.focus();
  };

  return (
    <div class="menu" role="menu" id={id} ref={ref} style={{ visibility: "hidden" }} onKeyDown={onKeyDown} data-owns-keys="">
      {items.map((item, i) => {
        if (!item) return null;
        if (item.separator) return <div class="menu-sep" role="separator" />;
        return (
          <button
            type="button"
            role="menuitem"
            class={cx("menu-item", item.danger && "is-danger")}
            disabled={item.disabled}
            tabIndex={enabled[0] === i ? 0 : -1}
            onClick={() => {
              onClose(true);
              if (item.onSelect) item.onSelect();
            }}
          >
            {item.icon ? <Icon name={item.icon} size={18} /> : null}
            <span class="menu-item-label">{item.label}</span>
            {item.hint ? <span class="menu-item-hint">{item.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Menu déroulant d'actions.
 * @param {{
 *   items: Array<{ label: string, icon?: string, onSelect?: () => void, danger?: boolean, disabled?: boolean, hint?: string } | { separator: true } | null>,
 *   label?: string, icon?: string, text?: import("preact").ComponentChildren, variant?: "ghost"|"secondary"|"primary",
 *   size?: "sm"|"md", align?: "start"|"end", disabled?: boolean, class?: string
 * }} props
 * - `label` : nom du bouton pour les lecteurs d'écran ("Autres actions" par défaut). `icon` : "more" par défaut.
 * - `text` : si présent, le déclencheur est un bouton avec ce texte (et un chevron) au lieu d'une icône seule.
 * - `align` : bord du bouton sur lequel le menu s'aligne ("end" par défaut).
 * - Clavier : flèches haut / bas, Début, Fin, Entrée ; Échap ferme et rend le focus au bouton.
 */
export function Menu({ items = [], label = "Autres actions", icon = "more", text, variant, size = "md", align = "end", disabled = false, class: className }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const id = useStableId("menu");
  const close = useRef((refocus) => {
    setOpen(false);
    if (refocus && wrapRef.current) {
      const trigger = wrapRef.current.querySelector("button");
      if (trigger) trigger.focus({ preventScroll: true });
    }
  }).current;
  const triggerProps = {
    "aria-haspopup": "menu",
    "aria-expanded": open ? "true" : "false",
    "aria-controls": open ? id : undefined,
    disabled,
    onClick: (event) => {
      // Le bouton peut se trouver dans une ligne ou une carte cliquable : le clic ne doit pas l'ouvrir.
      event.stopPropagation();
      setOpen((v) => !v);
    },
    onKeyDown: (event) => {
      if (event.key === "ArrowDown" && !open) {
        event.preventDefault();
        setOpen(true);
      }
    },
  };
  return (
    <span class={cx("menu-wrap", className)} ref={wrapRef}>
      {text != null ? (
        <Button variant={variant || "secondary"} size={size} iconRight="chevron-down" icon={icon === "more" ? undefined : icon} {...triggerProps}>
          {text}
        </Button>
      ) : (
        <IconButton icon={icon} label={label} variant={variant || "ghost"} size={size} {...triggerProps} />
      )}
      {open ? (
        <Portal>
          <MenuList id={id} items={items} align={align} anchor={wrapRef.current} onClose={close} />
        </Portal>
      ) : null}
    </span>
  );
}
