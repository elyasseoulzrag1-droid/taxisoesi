// Notifications brèves ("Opération enregistrée"). Annoncées poliment aux lecteurs d'écran.
import { useEffect } from "preact/hooks";
import { IconButton } from "./Button.jsx";
import { Icon } from "./Icon.jsx";
import { createHostStore, useHostItems } from "./host.js";
import { TONE_ICON, normTone } from "./tone.js";
import { Portal } from "./util.js";

const store = createHostStore();
let seq = 0;
const MAX_VISIBLE = 3;

/**
 * Affiche une notification en bas de l'écran.
 * @param {import("preact").ComponentChildren} message texte court, en français
 * @param {{ tone?: "info"|"in"|"out"|"warn"|"neutral"|"success"|"error", duration?: number, action?: { label: string, onClick: () => void } }} [options]
 *   tone : "in" (ou "success") pour une réussite, "out" (ou "error") pour un échec, "warn", "info" (défaut).
 *   duration : en millisecondes (4 500 par défaut, 8 000 pour une erreur) ; 0 pour laisser la notification jusqu'à sa fermeture.
 *   action : un bouton dans la notification, par exemple "Annuler".
 * @returns {number} identifiant, à passer à dismissToast()
 */
export function toast(message, options = {}) {
  seq += 1;
  const tone = normTone(options.tone, "info");
  const duration = options.duration == null ? (tone === "out" ? 8000 : 4500) : options.duration;
  const entry = { id: seq, message, tone, duration, action: options.action || null };
  store.set([...store.get(), entry].slice(-MAX_VISIBLE));
  store.ensureHost(ToastHost);
  return entry.id;
}

/** Ferme une notification (ou toutes, sans argument). */
export function dismissToast(id) {
  store.set(id == null ? [] : store.get().filter((t) => t.id !== id));
}

function ToastItem({ entry }) {
  useEffect(() => {
    if (!entry.duration) return undefined;
    const timer = setTimeout(() => dismissToast(entry.id), entry.duration);
    return () => clearTimeout(timer);
  }, [entry.id, entry.duration]);
  return (
    <div class="toast" data-tone={entry.tone}>
      <Icon name={TONE_ICON[entry.tone]} size={18} class="toast-icon" />
      <div class="toast-text">{entry.message}</div>
      {entry.action ? (
        <button
          type="button"
          class="toast-action"
          onClick={() => {
            dismissToast(entry.id);
            entry.action.onClick();
          }}
        >
          {entry.action.label}
        </button>
      ) : null}
      <IconButton icon="close" label="Fermer la notification" size="sm" class="toast-close" onClick={() => dismissToast(entry.id)} />
    </div>
  );
}

/** À rendre une seule fois, à la racine de l'appli : zone où apparaissent les notifications de toast(). */
export function ToastHost() {
  const items = useHostItems(store);
  // La zone reste dans la page même vide : c'est ce qui permet l'annonce aux lecteurs d'écran.
  return (
    <Portal>
      <div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
        {items.map((entry) => (
          <ToastItem key={entry.id} entry={entry} />
        ))}
      </div>
    </Portal>
  );
}
