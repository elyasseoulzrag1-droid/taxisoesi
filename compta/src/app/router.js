// Navigation par ancre simple ("#accueil") : la seule forme que la page hébergée laisse passer.
import { getState, setUi } from "./state.js";

export const ROUTES = [
  { id: "accueil", label: "Accueil", icon: "ticket" },
  { id: "operations", label: "Opérations", icon: "receipt" },
  { id: "ajouter", label: "Ajouter", icon: "plus" },
  { id: "associes", label: "Associés", icon: "users" },
  { id: "ventes", label: "Ventes", icon: "wallet", hint: "Virements Shopify, commandes, frais" },
  { id: "pub", label: "Pub", icon: "chart", hint: "Dépenses par régie et qui a payé" },
  { id: "rapports", label: "Rapports", icon: "download", hint: "Bénéfice par mois, trésorerie, exports" },
  { id: "assistant", label: "Assistant", icon: "sparkles", hint: "Pose une question sur tes chiffres" },
  { id: "reglages", label: "Réglages", icon: "settings", hint: "Associés, comptes, catégories, partage" },
  { id: "plus", label: "Plus", icon: "more" },
];

const IDS = new Set(ROUTES.map((r) => r.id));

function routeFromHash() {
  let hash = "";
  try {
    hash = (window.location.hash || "").replace(/^#/, "");
  } catch {
    hash = "";
  }
  return IDS.has(hash) ? hash : "accueil";
}

function sync() {
  const route = routeFromHash();
  if (getState().ui.route !== route) setUi({ route });
}

export function initRouter() {
  window.addEventListener("hashchange", sync);
  sync();
}

/**
 * Change de page. `uiPatch` permet de passer un contexte à la page d'arrivée
 * (par exemple un filtre d'opérations), puisque l'ancre ne porte aucun paramètre.
 */
export function navigate(route, uiPatch) {
  const target = IDS.has(route) ? route : "accueil";
  setUi({ ...(uiPatch || {}), route: target });
  try {
    if (window.location.hash !== "#" + target) window.location.hash = target;
  } catch {
    // Ancre non modifiable ici : l'état suffit à afficher la page.
  }
  try {
    window.scrollTo(0, 0);
  } catch {
    // Sans importance.
  }
}
