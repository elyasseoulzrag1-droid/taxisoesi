// Petit magasin partagé entre une fonction impérative (toast, confirmDialog) et son composant hôte.
// Si l'appli n'a rendu aucun hôte, on en monte un dans <body> : l'appel n'est jamais perdu.
import { createElement, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useStableId } from "./util.js";

/** Crée un magasin d'éléments en attente d'affichage. */
export function createHostStore() {
  let items = [];
  const listeners = new Set();
  const hosts = [];
  let fallbackPlanned = false;
  const notify = () => listeners.forEach((fn) => fn());
  return {
    get: () => items,
    set(next) {
      items = next;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    register(id) {
      hosts.push(id);
      notify();
      return () => {
        const at = hosts.indexOf(id);
        if (at >= 0) hosts.splice(at, 1);
        notify();
      };
    },
    // Un seul hôte affiche les éléments, même si plusieurs sont montés par erreur.
    isPrimary: (id) => hosts[0] === id,
    /** Monte un hôte de secours si aucun n'existe (après un tour d'événements, le temps que l'appli monte le sien). */
    ensureHost(Component) {
      if (typeof document === "undefined" || hosts.length > 0 || fallbackPlanned) return;
      fallbackPlanned = true;
      setTimeout(() => {
        fallbackPlanned = false;
        if (hosts.length > 0) return;
        const el = document.createElement("div");
        el.className = "ui-portal";
        document.body.appendChild(el);
        render(createElement(Component, null), el);
      }, 0);
    },
  };
}

/** Abonne un composant hôte au magasin. Renvoie les éléments à afficher (vide si un autre hôte s'en charge). */
export function useHostItems(store) {
  const id = useStableId("host");
  const [, force] = useState(0);
  useEffect(() => {
    const off = store.subscribe(() => force((n) => n + 1));
    const unregister = store.register(id);
    return () => {
      off();
      unregister();
    };
  }, [store, id]);
  return store.isPrimary(id) ? store.get() : [];
}
