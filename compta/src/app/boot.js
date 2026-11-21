// Démarrage commun à l'appli et aux pages de développement : plateforme, navigation, abonnement aux données.
import { initPlatform } from "../platform/index.js";
import { applySnapshot, getState, setState } from "./state.js";
import { initRouter } from "./router.js";

let unsubscribe = null;

/**
 * Lance (ou relance) la plateforme. `beforeSubscribe(platform)` permet aux pages de dev
 * de préparer des données avant le premier affichage.
 */
export async function boot({ beforeSubscribe } = {}) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  setState({ phase: "boot" });
  let platform;
  try {
    platform = await initPlatform();
  } catch {
    platform = { mode: "unavailable", user: {}, store: null, files: null, exporter: null, ai: null };
  }
  setState({ platform });
  if (!platform.store || platform.mode === "unavailable") {
    setState({ phase: "unavailable" });
    return platform;
  }
  if (beforeSubscribe) {
    try { await beforeSubscribe(platform); } catch (err) { console.error(err); }
  }
  unsubscribe = platform.store.subscribe(applySnapshot);
  return platform;
}

export function startRouter() {
  initRouter();
  return getState().ui.route;
}
