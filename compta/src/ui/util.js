// Petits outils partagés par les composants du kit (aucune dépendance autre que preact).
import { createElement, render } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

/** Assemble des noms de classes en ignorant les valeurs vides : cx("btn", actif && "is-on"). */
export function cx(...parts) {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    out += (out ? " " : "") + p;
  }
  return out;
}

let autoId = 0;

/** Identifiant DOM stable pour la durée de vie du composant (lier un label à son champ). */
export function useStableId(prefix = "ui") {
  const ref = useRef(null);
  if (ref.current === null) {
    autoId += 1;
    ref.current = `${prefix}-${autoId}`;
  }
  return ref.current;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Éléments focalisables visibles dans un conteneur, dans l'ordre du document. */
export function focusableIn(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Suit une media query (false tant que le navigateur n'a pas répondu ou hors navigateur). */
export function useMediaQuery(query) {
  const read = () => {
    try {
      return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

/**
 * Mesure la largeur (en px) d'un élément et la suit avec ResizeObserver.
 * @returns {{ ref: { current: HTMLElement|null }, attach: (node: HTMLElement|null) => void, width: number }}
 *   `attach` se passe en `ref` à l'élément ; `width` vaut 0 tant que rien n'est mesuré.
 */
export function useMeasure() {
  const ref = useRef(null);
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  const attach = useCallback((node) => {
    ref.current = node;
    setEl(node);
  }, []);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, attach, width };
}

// Transmet le contexte Preact de l'arbre d'origine au contenu rendu ailleurs dans le document.
function ContextBridge(props) {
  this.getChildContext = () => props.context;
  return props.children;
}

/**
 * Rend ses enfants dans un conteneur accroché à <body> : une fenêtre ou un menu ne doit dépendre
 * ni du défilement ni de l'empilement de son parent (barre collante, tableau qui défile...).
 */
export function Portal({ children }, context) {
  const hostRef = useRef(null);
  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "ui-portal";
  }
  useLayoutEffect(() => {
    const host = hostRef.current;
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(createElement(ContextBridge, { context }, children), hostRef.current);
  });
  return null;
}

/** Nombre borné entre min et max. */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
