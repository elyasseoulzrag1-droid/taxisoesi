// Champs de formulaire. Tous sont contrôlés : `value` + `onChange(valeur)` (la valeur, pas l'événement).
import { createContext } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { cx, useStableId } from "./util.js";

// Un Field transmet à son champ l'identifiant, la description et l'état d'erreur.
const FieldContext = createContext(null);

/**
 * Attributs d'accessibilité fournis par le Field parent (ou déduits des props du champ).
 * Un Field ne nomme qu'un seul champ : le premier champ rendu dedans prend son identifiant,
 * les suivants (ex. le choix de devise à côté d'un montant) gardent le leur.
 */
export function useFieldProps({ id, invalid, describedBy } = {}) {
  const field = useContext(FieldContext);
  const ownId = useStableId("f");
  const owner = field ? field.owner : null;
  let linked = false;
  if (field && id) linked = id === field.id;
  else if (owner && (owner.current === null || owner.current === ownId)) {
    owner.current = ownId;
    linked = true;
  }
  useEffect(
    () => () => {
      if (owner && owner.current === ownId) owner.current = null;
    },
    [owner, ownId],
  );
  return {
    id: id || (linked ? field.id : ownId),
    "aria-describedby": describedBy || (linked && field.describedBy) || undefined,
    "aria-invalid": invalid || (linked && field.invalid) ? "true" : undefined,
    "aria-required": linked && field.required ? "true" : undefined,
  };
}

/**
 * Habillage d'un champ : libellé relié au champ, aide, message d'erreur.
 * @param {{
 *   label?: import("preact").ComponentChildren, hint?: import("preact").ComponentChildren, error?: import("preact").ComponentChildren,
 *   htmlFor?: string, required?: boolean, optional?: boolean, class?: string, children?: import("preact").ComponentChildren
 * }} props
 * Sans `htmlFor`, un identifiant stable est créé et transmis au champ du kit placé dedans.
 * Avec `htmlFor`, donne le même `id` au champ. `error` remplace `hint` et marque le champ comme invalide.
 */
export function Field({ label, hint, error, htmlFor, required = false, optional = false, class: className, children }) {
  const autoId = useStableId("field");
  const owner = useRef(null);
  const id = htmlFor || autoId;
  const hintId = hint ? id + "-hint" : null;
  const errorId = error ? id + "-error" : null;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div class={cx("field", error && "has-error", className)}>
      {label ? (
        <label class="field-label" for={id}>
          {label}
          {required ? (
            <span class="field-req" aria-hidden="true">
              {" *"}
            </span>
          ) : null}
          {optional ? <span class="field-opt">{" (facultatif)"}</span> : null}
        </label>
      ) : null}
      <FieldContext.Provider value={{ id, describedBy, invalid: !!error, required, owner }}>{children}</FieldContext.Provider>
      {error ? (
        <p class="field-error" id={errorId} role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p class="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Champ texte sur une ligne.
 * @param {{
 *   value: string, onChange: (value: string) => void, type?: string, placeholder?: string, id?: string, name?: string,
 *   disabled?: boolean, readOnly?: boolean, invalid?: boolean, inputMode?: string, autoComplete?: string, maxLength?: number,
 *   prefix?: import("preact").ComponentChildren, suffix?: import("preact").ComponentChildren, autoFocus?: boolean,
 *   onEnter?: () => void, onBlur?: (event: FocusEvent) => void, class?: string
 * }} props
 * `prefix` / `suffix` : petit texte ou icône collé dans le champ (ex. "$", "%"). `autoFocus` : prend le focus à l'ouverture d'une Modal.
 */
export function TextInput({
  value,
  onChange,
  type = "text",
  id,
  invalid,
  prefix,
  suffix,
  autoFocus,
  onEnter,
  class: className,
  describedBy,
  ...rest
}) {
  const a11y = useFieldProps({ id, invalid, describedBy });
  const input = (
    <input
      class={cx("input", !prefix && !suffix && className)}
      type={type}
      value={value == null ? "" : value}
      onInput={(event) => onChange && onChange(event.currentTarget.value)}
      onKeyDown={onEnter ? (event) => event.key === "Enter" && onEnter() : undefined}
      data-autofocus={autoFocus ? "" : undefined}
      {...a11y}
      {...rest}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div class={cx("input-wrap", className)}>
      {prefix ? <span class="input-affix">{prefix}</span> : null}
      {input}
      {suffix ? <span class="input-affix">{suffix}</span> : null}
    </div>
  );
}

/**
 * Champ texte sur plusieurs lignes.
 * @param {{ value: string, onChange: (value: string) => void, rows?: number, placeholder?: string, id?: string, disabled?: boolean, invalid?: boolean, maxLength?: number, class?: string }} props
 */
export function TextArea({ value, onChange, rows = 3, id, invalid, autoFocus, class: className, describedBy, ...rest }) {
  const a11y = useFieldProps({ id, invalid, describedBy });
  return (
    <textarea
      class={cx("input textarea", className)}
      rows={rows}
      value={value == null ? "" : value}
      onInput={(event) => onChange && onChange(event.currentTarget.value)}
      data-autofocus={autoFocus ? "" : undefined}
      {...a11y}
      {...rest}
    />
  );
}

/**
 * Sélecteur de date natif. La valeur est une chaîne "AAAA-MM-JJ" ("" quand le champ est vide).
 * @param {{ value: string, onChange: (iso: string) => void, min?: string, max?: string, id?: string, disabled?: boolean, invalid?: boolean, class?: string }} props
 */
export function DateInput({ value, onChange, id, invalid, class: className, describedBy, ...rest }) {
  const a11y = useFieldProps({ id, invalid, describedBy });
  return (
    <input
      class={cx("input input-date", className)}
      type="date"
      value={value || ""}
      onInput={(event) => onChange && onChange(event.currentTarget.value || "")}
      {...a11y}
      {...rest}
    />
  );
}

/**
 * Liste déroulante native.
 * @param {{
 *   value: any, onChange: (value: any) => void,
 *   options: Array<{ value: any, label: string, group?: string, disabled?: boolean }>,
 *   placeholder?: string, id?: string, disabled?: boolean, invalid?: boolean, size?: "sm"|"md", class?: string
 * }} props
 * Les options qui portent le même `group` sont réunies sous un intertitre, dans l'ordre d'apparition.
 * `placeholder` s'affiche tant que `value` ne correspond à aucune option. `onChange` reçoit la valeur d'origine (pas forcément une chaîne).
 */
export function Select({ value, onChange, options = [], placeholder, id, invalid, size, class: className, describedBy, ...rest }) {
  const a11y = useFieldProps({ id, invalid, describedBy });
  const index = options.findIndex((o) => o.value === value);
  // On regroupe en gardant l'ordre de première apparition de chaque groupe.
  const blocks = [];
  const byGroup = new Map();
  options.forEach((option, i) => {
    const item = { option, i };
    if (!option.group) {
      blocks.push({ item });
      return;
    }
    let block = byGroup.get(option.group);
    if (!block) {
      block = { group: option.group, items: [] };
      byGroup.set(option.group, block);
      blocks.push(block);
    }
    block.items.push(item);
  });
  const renderOption = ({ option, i }) => (
    <option value={String(i)} disabled={option.disabled} selected={i === index}>
      {option.label}
    </option>
  );
  return (
    <div class={cx("select-wrap", size === "sm" && "select-sm", className)}>
      <select
        class={cx("input select", index < 0 && "is-placeholder")}
        value={index < 0 ? "" : String(index)}
        onChange={(event) => {
          const picked = options[Number(event.currentTarget.value)];
          if (picked && onChange) onChange(picked.value);
        }}
        {...a11y}
        {...rest}
      >
        {index < 0 || placeholder ? (
          <option value="" disabled={index >= 0} selected={index < 0}>
            {placeholder || "Choisir"}
          </option>
        ) : null}
        {blocks.map((block) =>
          block.item ? renderOption(block.item) : <optgroup label={block.group}>{block.items.map(renderOption)}</optgroup>,
        )}
      </select>
      <Icon name="chevron-down" size={18} class="select-caret" />
    </div>
  );
}

/**
 * Choix exclusif entre quelques options, présenté comme une rangée de boutons.
 * @param {{
 *   value: any, onChange: (value: any) => void, options: Array<{ value: any, label: string, icon?: string }>,
 *   label?: string, size?: "sm"|"md", full?: boolean, disabled?: boolean, class?: string
 * }} props
 * `label` : nom du groupe pour les lecteurs d'écran. Flèches gauche / droite pour changer d'option au clavier.
 */
export function Segmented({ value, onChange, options = [], label, size = "md", full = false, disabled = false, class: className }) {
  const ref = useRef(null);
  const current = options.findIndex((o) => o.value === value);
  const move = (event) => {
    const dir = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!dir || !options.length) return;
    event.preventDefault();
    const next = (Math.max(current, 0) + dir + options.length) % options.length;
    if (onChange) onChange(options[next].value);
    const buttons = ref.current ? ref.current.querySelectorAll("button") : [];
    if (buttons[next]) buttons[next].focus();
  };
  return (
    <div
      ref={ref}
      class={cx("segmented", size === "sm" && "segmented-sm", full && "segmented-full", className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={move}
    >
      {options.map((option, i) => {
        const checked = i === current;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={checked ? "true" : "false"}
            tabIndex={checked || (current < 0 && i === 0) ? 0 : -1}
            class={cx("segmented-item", checked && "is-on")}
            disabled={disabled}
            onClick={() => !checked && onChange && onChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={16} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Interrupteur oui / non.
 * @param {{ checked: boolean, onChange: (checked: boolean) => void, label?: import("preact").ComponentChildren, hint?: import("preact").ComponentChildren, disabled?: boolean, id?: string, class?: string }} props
 */
export function Toggle({ checked, onChange, label, hint, disabled = false, id, class: className, ...rest }) {
  const autoId = useStableId("toggle");
  const inputId = id || autoId;
  return (
    <label class={cx("toggle", disabled && "is-disabled", className)} for={inputId}>
      <input
        id={inputId}
        class="toggle-input"
        type="checkbox"
        role="switch"
        checked={!!checked}
        disabled={disabled}
        aria-describedby={hint ? inputId + "-hint" : undefined}
        onChange={(event) => onChange && onChange(event.currentTarget.checked)}
        {...rest}
      />
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
      {label || hint ? (
        <span class="toggle-text">
          {label ? <span class="toggle-label">{label}</span> : null}
          {hint ? (
            <span class="toggle-hint" id={inputId + "-hint"}>
              {hint}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Case à cocher.
 * @param {{ checked: boolean, onChange: (checked: boolean) => void, label?: import("preact").ComponentChildren, indeterminate?: boolean, disabled?: boolean, id?: string, class?: string }} props
 * Sans `label` visible, passe `aria-label`.
 */
export function Checkbox({ checked, onChange, label, indeterminate = false, disabled = false, id, class: className, ...rest }) {
  const autoId = useStableId("check");
  const inputId = id || autoId;
  return (
    <label class={cx("checkbox", disabled && "is-disabled", className)} for={inputId}>
      <input
        id={inputId}
        class="checkbox-input"
        type="checkbox"
        checked={!!checked}
        indeterminate={indeterminate}
        disabled={disabled}
        onChange={(event) => onChange && onChange(event.currentTarget.checked)}
        {...rest}
      />
      <span class="checkbox-box" aria-hidden="true">
        <Icon name={indeterminate ? "minus" : "check"} size={14} />
      </span>
      {label ? <span class="checkbox-label">{label}</span> : null}
    </label>
  );
}

/**
 * Champ de recherche avec loupe et bouton pour effacer.
 * @param {{ value: string, onChange: (value: string) => void, placeholder?: string, label?: string, id?: string, class?: string }} props
 * `label` : nom du champ pour les lecteurs d'écran ("Rechercher" par défaut).
 */
export function SearchInput({ value, onChange, placeholder = "Rechercher", label = "Rechercher", id, class: className, ...rest }) {
  const ref = useRef(null);
  const a11y = useFieldProps({ id });
  return (
    <div class={cx("search", className)}>
      <Icon name="search" size={18} class="search-icon" />
      <input
        ref={ref}
        class="input search-input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value == null ? "" : value}
        placeholder={placeholder}
        aria-label={label}
        onInput={(event) => onChange && onChange(event.currentTarget.value)}
        {...a11y}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          class="search-clear"
          aria-label="Effacer la recherche"
          onClick={() => {
            if (onChange) onChange("");
            if (ref.current) ref.current.focus();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
