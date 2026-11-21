// Confirmation dans la page : alert / confirm / prompt du navigateur ne s'affichent pas dans un Artifact.
import { Button } from "./Button.jsx";
import { Modal } from "./Modal.jsx";
import { createHostStore, useHostItems } from "./host.js";

const store = createHostStore();
let seq = 0;

/**
 * Demande une confirmation et renvoie une promesse : true si la personne confirme, false sinon
 * (bouton Annuler, Échap, clic en dehors). Ne rejette jamais.
 * @param {{ title: string, message?: import("preact").ComponentChildren, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 * @example
 *   if (await confirmDialog({ title: "Supprimer cette opération ?", message: "Tu ne pourras pas revenir en arrière.", confirmLabel: "Supprimer", danger: true })) { ... }
 */
export function confirmDialog(options = {}) {
  return new Promise((resolve) => {
    seq += 1;
    store.set([...store.get(), { id: seq, options, resolve }]);
    store.ensureHost(ConfirmHost);
  });
}

function settle(entry, value) {
  store.set(store.get().filter((e) => e !== entry));
  entry.resolve(value);
}

/** À rendre une seule fois, à la racine de l'appli : affiche les demandes de confirmDialog(). */
export function ConfirmHost() {
  const items = useHostItems(store);
  const entry = items[0];
  if (!entry) return null;
  const { title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false } = entry.options;
  const lines = typeof message === "string" ? message.split("\n").filter((l) => l.trim()) : null;
  return (
    <Modal
      key={entry.id}
      size="sm"
      title={title || "Tu confirmes ?"}
      onClose={() => settle(entry, false)}
      class="confirm"
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(entry, false)} data-autofocus={danger ? "" : undefined}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => settle(entry, true)} data-autofocus={danger ? undefined : ""}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {lines ? (
        <div class="stack stack-sm">
          {lines.map((line) => (
            <p class="muted">{line}</p>
          ))}
        </div>
      ) : (
        message
      )}
    </Modal>
  );
}
