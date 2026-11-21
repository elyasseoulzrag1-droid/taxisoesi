// Zone de dépôt de fichiers : on clique (ou on touche) pour choisir, ou on dépose depuis le bureau.
import { useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { splitByAccept } from "./accept.js";
import { cx, useStableId } from "./util.js";

/**
 * @param {{
 *   accept?: string, multiple?: boolean, onFiles: (files: File[], rejected: File[]) => void,
 *   label?: import("preact").ComponentChildren, hint?: import("preact").ComponentChildren, icon?: string,
 *   disabled?: boolean, compact?: boolean, capture?: string, id?: string, class?: string
 * }} props
 * - `onFiles(fichiers, refusés)` : les fichiers acceptés (selon `accept`), puis ceux qui ont été écartés.
 * - `accept` : comme l'attribut HTML (".csv,.txt", "image/*,application/pdf").
 * - `capture="environment"` propose directement l'appareil photo sur téléphone.
 * - `compact` : version sur une ligne, pour ajouter un justificatif dans un formulaire.
 */
export function FileDrop({
  accept,
  multiple = false,
  onFiles,
  label = "Choisir un fichier",
  hint,
  icon = "upload",
  disabled = false,
  compact = false,
  capture,
  id,
  class: className,
}) {
  const autoId = useStableId("file");
  const inputId = id || autoId;
  const inputRef = useRef(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const deliver = (list) => {
    const all = Array.from(list || []);
    if (!all.length || !onFiles) return;
    const { accepted, rejected } = splitByAccept(multiple ? all : all.slice(0, 1), accept);
    onFiles(accepted, rejected);
  };

  return (
    <label
      class={cx("filedrop", compact && "filedrop-compact", over && "is-over", disabled && "is-disabled", className)}
      for={inputId}
      onDragEnter={(event) => {
        if (disabled) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        if (!disabled && event.dataTransfer) deliver(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        class="filedrop-input"
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        aria-describedby={hint ? inputId + "-hint" : undefined}
        onChange={(event) => {
          deliver(event.currentTarget.files);
          // On vide le champ pour pouvoir rechoisir le même fichier.
          event.currentTarget.value = "";
        }}
      />
      <span class="filedrop-icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      <span class="filedrop-text">
        <span class="filedrop-label">{label}</span>
        {hint ? (
          <span class="filedrop-hint" id={inputId + "-hint"}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
