// Champ de montant : la saisie reste libre ("12", "12,5", "1 234.56"), l'appelant reçoit des centimes entiers.
import { useRef, useState } from "preact/hooks";
import { CURRENCY_CODES } from "../core/money.js";
import { useFieldProps } from "./fields.jsx";
import { centsToText, currencyInText, currencySymbol, textToCents } from "./money-input.js";
import { cx } from "./util.js";

/**
 * @param {{
 *   cents: number|null, onChange: (cents: number|null) => void,
 *   currency?: string, onCurrency?: (code: string) => void, currencies?: string[],
 *   sign?: "out"|"in"|null, id?: string, placeholder?: string, disabled?: boolean, invalid?: boolean,
 *   autoFocus?: boolean, label?: string, class?: string
 * }} props
 * - `cents` : valeur stockée, entier signé en centimes (null = champ vide). `onChange` reçoit null si le texte n'est pas un montant.
 * - `sign` : "out" pour un formulaire "Dépense" (on tape 12,50, l'appelant reçoit -1250), "in" pour un encaissement
 *   (12,50 -> 1250), null pour un montant signé libre. Un petit signe coloré rappelle le sens.
 * - `currency` : code affiché à droite. Avec `onCurrency`, c'est une liste déroulante (`currencies` pour limiter les choix) ;
 *   taper "12 €" ou "$12" change aussi la devise.
 * - Le texte est remis en forme ("12,50") quand on quitte le champ.
 */
export function MoneyInput({
  cents,
  onChange,
  currency = "USD",
  onCurrency,
  currencies,
  sign = null,
  id,
  placeholder = "0,00",
  disabled = false,
  invalid,
  autoFocus,
  label,
  class: className,
  describedBy,
  ...rest
}) {
  const a11y = useFieldProps({ id, invalid, describedBy });
  const [text, setText] = useState(() => centsToText(cents, sign));
  // On ne réécrit le texte que si `cents` (ou le mode) change pour une valeur différente de ce qui est tapé :
  // la saisie en cours n'est jamais écrasée, même si l'appelant met un instant à renvoyer la nouvelle valeur.
  const seen = useRef({ cents, sign });
  if (seen.current.cents !== cents || seen.current.sign !== sign) {
    seen.current = { cents, sign };
    const wanted = cents == null || !Number.isFinite(cents) ? null : cents === 0 ? 0 : cents;
    if (textToCents(text, sign) !== wanted) setText(centsToText(cents, sign));
  }

  const handleInput = (event) => {
    const value = event.currentTarget.value;
    setText(value);
    const next = textToCents(value, sign);
    if (onChange && next !== cents) onChange(next);
    if (onCurrency) {
      const code = currencyInText(value);
      if (code && code !== currency && (!currencies || currencies.includes(code))) onCurrency(code);
    }
  };

  const handleBlur = () => {
    const next = textToCents(text, sign);
    setText(next == null ? "" : centsToText(next, sign));
  };

  const codes = currencies && currencies.length ? currencies : CURRENCY_CODES;
  const options = codes.includes(currency) ? codes : [currency, ...codes];

  return (
    <div class={cx("money-input", sign && `money-input-${sign}`, disabled && "is-disabled", className)}>
      {sign ? (
        <span class="money-input-sign" aria-hidden="true">
          {sign === "out" ? "−" : "+"}
        </span>
      ) : null}
      <input
        class="money-input-field num"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellcheck={false}
        enterKeyHint="done"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        aria-label={label}
        data-autofocus={autoFocus ? "" : undefined}
        onInput={handleInput}
        onBlur={handleBlur}
        {...a11y}
        {...rest}
      />
      {onCurrency ? (
        <select
          class="money-input-currency"
          aria-label="Devise"
          value={currency}
          disabled={disabled}
          onChange={(event) => onCurrency(event.currentTarget.value)}
        >
          {options.map((code) => (
            <option value={code} selected={code === currency}>
              {code}
            </option>
          ))}
        </select>
      ) : (
        <span class="money-input-unit" title={currency}>
          {currencySymbol(currency)}
        </span>
      )}
    </div>
  );
}
