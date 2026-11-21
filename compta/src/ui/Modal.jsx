// Fenêtre modale : feuille qui monte du bas sur téléphone, boîte centrée sur grand écran.
// Gère le piège à focus, la touche Échap, le clic sur le fond, le blocage du défilement et un pied collant.
import { useLayoutEffect, useRef } from "preact/hooks";
import { IconButton } from "./Button.jsx";
import { Portal, cx, focusableIn, useStableId } from "./util.js";

// Pile des fenêtres ouvertes : seule celle du dessus réagit à Échap et retient le focus.
const openStack = [];
let lockCount = 0;

function lockScroll() {
  lockCount += 1;
  if (lockCount !== 1) return;
  const root = document.documentElement;
  // On compense la disparition de la barre de défilement pour éviter un saut de mise en page.
  const gap = window.innerWidth - root.clientWidth;
  if (gap > 0) document.body.style.paddingRight = gap + "px";
  root.classList.add("is-scroll-locked");
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount !== 0) return;
  document.documentElement.classList.remove("is-scroll-locked");
  document.body.style.paddingRight = "";
}

function ModalPanel({ title, onClose, footer, size, dismissible, labelledBy, className, children }) {
  const panelRef = useRef(null);
  const id = useStableId("modal");
  const titleId = labelledBy || (title ? id + "-title" : undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;
  const pressedOnScrim = useRef(false);

  useLayoutEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    openStack.push(id);
    lockScroll();
    const wanted = panel.querySelector("[data-autofocus]");
    (wanted || panel).focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (event.key === "Escape") {
        if (dismissRef.current && closeRef.current) {
          event.stopPropagation();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableIn(panel);
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = openStack.indexOf(id);
      if (at >= 0) openStack.splice(at, 1);
      unlockScroll();
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [id]);

  return (
    <div class="modal-root" data-size={size}>
      <div
        class="modal-scrim"
        onPointerDown={(event) => {
          pressedOnScrim.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          // On ne ferme que si l'appui a commencé ET fini sur le fond (pas un glissé depuis un champ).
          if (pressedOnScrim.current && event.target === event.currentTarget && dismissible && onClose) onClose();
          pressedOnScrim.current = false;
        }}
      />
      <div
        ref={panelRef}
        class={cx("modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div class="modal-grip" aria-hidden="true" />
        {title || (dismissible && onClose) ? (
          <header class="modal-head">
            {title ? (
              <h2 class="modal-title" id={titleId}>
                {title}
              </h2>
            ) : (
              <span />
            )}
            {dismissible && onClose ? <IconButton icon="close" label="Fermer" onClick={onClose} class="modal-close" /> : null}
          </header>
        ) : null}
        <div class="modal-body">{children}</div>
        {footer ? <footer class="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * Fenêtre modale.
 * @param {{
 *   title?: import("preact").ComponentChildren, onClose?: () => void, footer?: import("preact").ComponentChildren,
 *   size?: "sm"|"md"|"lg", open?: boolean, dismissible?: boolean, labelledBy?: string, class?: string,
 *   children?: import("preact").ComponentChildren
 * }} props
 * - `open` (true par défaut) : false ne rend rien ; on peut aussi monter / démonter le composant.
 * - `footer` : zone d'actions collée en bas (les boutons y restent visibles quand le contenu défile).
 * - `dismissible` (true par défaut) : Échap, le clic sur le fond et la croix appellent `onClose`.
 * - Le focus va sur l'élément portant `data-autofocus`, sinon sur la fenêtre ; il revient au déclencheur à la fermeture.
 */
export function Modal({ open = true, title, onClose, footer, size = "md", dismissible = true, labelledBy, class: className, children }) {
  if (!open) return null;
  return (
    <Portal>
      <ModalPanel
        title={title}
        onClose={onClose}
        footer={footer}
        size={size}
        dismissible={dismissible}
        labelledBy={labelledBy}
        className={className}
      >
        {children}
      </ModalPanel>
    </Portal>
  );
}

/** Vrai si au moins une fenêtre modale est ouverte (utile pour suspendre un raccourci clavier). */
export function isModalOpen() {
  return openStack.length > 0;
}
