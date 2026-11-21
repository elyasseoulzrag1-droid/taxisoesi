// Affichage d'une opération sur une ligne, et liste d'opérations regroupées par mois.
import { useState } from "preact/hooks";
import { accountLabel, categoryLabel, partnerLabel } from "../../core/model.js";
import { monthLabel } from "../../core/dates.js";
import { Badge, Button, Money, fmtDate, fmtMoney, cx } from "../../ui/index.js";

const NATURE = {
  contribution: "Apport",
  withdrawal: "Remboursement ou retrait",
  settlement: "Règlement entre associés",
  internal: "Virement interne",
};

/** Texte court qui dit à qui appartient le compte utilisé. */
export function ownerText(config, ownerId) {
  if (ownerId === "business") return "Entreprise";
  if (ownerId === "unknown" || !ownerId) return "À attribuer";
  return partnerLabel(config, ownerId);
}

/** Ligne de détail sous le libellé : catégorie et compte, ou sens du mouvement. */
export function opDetail(op, config) {
  if (op.kind === "transfer") {
    return `${NATURE[op.nature] || "Mouvement"} : ${accountLabel(config, op.fromAccountId)} vers ${accountLabel(config, op.toAccountId)}`;
  }
  const cats = op.lines.length > 1 ? "Plusieurs catégories" : categoryLabel(config, op.lines[0] ? op.lines[0].categoryId : null);
  return `${cats} · ${accountLabel(config, op.accountId)} (${ownerText(config, op.ownerId)})`;
}

/**
 * @param {{ op: object, config: object, base: string, onOpen?: (op: object) => void }} props
 */
export function OpRow({ op, config, base, onOpen }) {
  const transfer = op.kind === "transfer";
  const native = op.currency !== base;
  const body = (
    <>
      <span class="oprow-main">
        <span class="oprow-label">{op.label || op.party || "Sans libellé"}</span>
        <span class="oprow-detail">
          {fmtDate(op.date, "auto")} · {opDetail(op, config)}
        </span>
        {op.needsReview || op.estimated || op.reconciled || (op.attachments && op.attachments.length) ? (
          <span class="oprow-flags">
            {op.needsReview ? <Badge tone="warn">À vérifier</Badge> : null}
            {op.estimated ? <Badge tone="info">Estimé</Badge> : null}
            {op.reconciled ? <Badge tone="in">Pointée</Badge> : null}
            {op.attachments && op.attachments.length ? <Badge icon="paperclip">Justificatif</Badge> : null}
          </span>
        ) : null}
      </span>
      <span class="oprow-amount">
        <Money cents={op.amountCents} currency={op.currency} tone={transfer ? "none" : "auto"} sign={!transfer} />
        {native ? <span class="oprow-base">{fmtMoney(op.baseCents, base, { approx: op.fxEstimated })}</span> : null}
      </span>
    </>
  );
  if (!onOpen) return <div class="oprow">{body}</div>;
  return (
    <button type="button" class="oprow oprow-button" onClick={() => onOpen(op)}>
      {body}
    </button>
  );
}

/**
 * Liste regroupée par mois, affichée par paquets pour rester fluide.
 * @param {{ ops: object[], config: object, base: string, onOpen?: (op: object) => void, pageSize?: number }} props
 */
export function OpList({ ops, config, base, onOpen, pageSize = 80 }) {
  const [shown, setShown] = useState(pageSize);
  const visible = ops.slice(0, shown);
  const groups = [];
  for (const op of visible) {
    const last = groups[groups.length - 1];
    if (last && last.month === op.month) last.ops.push(op);
    else groups.push({ month: op.month, ops: [op] });
  }
  return (
    <div class="oplist">
      {groups.map((group) => (
        <section class="oplist-group" key={group.month}>
          <h3 class="oplist-month overline">{monthLabel(group.month)}</h3>
          <div class={cx("oplist-rows")}>
            {group.ops.map((op) => (
              <OpRow key={op.id} op={op} config={config} base={base} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
      {ops.length > shown ? (
        <Button variant="secondary" full onClick={() => setShown(shown + pageSize)}>
          Afficher plus ({ops.length - shown} restantes)
        </Button>
      ) : null}
    </div>
  );
}
