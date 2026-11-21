// Formulaire d'une opération : dépense, encaissement, ou mouvement entre comptes (apport, remboursement).
import { useState } from "preact/hooks";
import { useBook, useCanWrite, usePlatform } from "../app/state.js";
import { saveOp, removeOps, uploadAttachment } from "../app/actions.js";
import { navigate } from "../app/router.js";
import { accountOwner, listAccounts, listCategories, partnerLabel, groupLabel, isMonthClosed } from "../core/model.js";
import { suggestCategory } from "../core/rules.js";
import { todayISO, monthOf, monthLabel } from "../core/dates.js";
import { Modal, Button, Field, TextInput, TextArea, DateInput, Select, Segmented, Toggle, MoneyInput, Banner, Chip, confirmDialog, toast, fmtFileSize } from "../ui/index.js";

const LAST_ACCOUNT_KEY = "sy-compta:last-account";

function lastAccount() {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY) || "";
  } catch {
    return "";
  }
}

function rememberAccount(id) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Sans importance.
  }
}

function ownerSentence(config, accountId, type) {
  if (!accountId) return null;
  const owner = accountOwner(config, accountId);
  if (owner === "business") return type === "in" ? "Reçu sur un compte de l'entreprise." : "Payé par l'entreprise.";
  if (owner === "unknown") return "Ce compte n'est attribué à personne : indique à qui il appartient dans Réglages pour que le calcul des associés soit juste.";
  const name = partnerLabel(config, owner);
  return type === "in"
    ? `Reçu sur un compte perso de ${name} : ${name} doit ce montant à l'entreprise (il diminue ce qu'il doit récupérer).`
    : `Payé avec l'argent de ${name} : l'entreprise lui doit ce montant.`;
}

function transferSentence(config, fromId, toId) {
  if (!fromId || !toId) return null;
  if (fromId === toId) return "Choisis deux comptes différents.";
  const from = accountOwner(config, fromId);
  const to = accountOwner(config, toId);
  if (from === to) return from === "business" ? "Virement interne entre deux comptes de l'entreprise : aucun effet sur les associés." : "Mouvement entre deux comptes du même propriétaire : aucun effet sur le calcul.";
  if (to === "business") return `Apport de ${partnerLabel(config, from)} à l'entreprise : compte dans ce qu'il a mis.`;
  if (from === "business") return `Remboursement ou retrait vers ${partnerLabel(config, to)} : compte dans ce qu'il a déjà récupéré.`;
  return `Règlement entre associés : ${partnerLabel(config, from)} verse à ${partnerLabel(config, to)}.`;
}

/**
 * @param {{ initial: object, onClose: () => void }} props
 * `initial` : opération existante (avec id) à modifier, ou valeurs de départ pour une création.
 */
export default function OpForm({ initial = {}, onClose }) {
  const book = useBook();
  const canWrite = useCanWrite();
  const platform = usePlatform();
  const { config, base } = book;
  const editing = !!initial.id;
  const accounts = listAccounts(config);
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.name,
    group: a.owner === "business" ? "Comptes de l'entreprise" : a.owner === "unknown" ? "À attribuer" : "Comptes perso de " + partnerLabel(config, a.owner),
  }));
  const accountCurrency = (id) => (config.accounts[id] ? config.accounts[id].currency : base);
  const defaultAccount = initial.accountId || (accounts.some((a) => a.id === lastAccount()) ? lastAccount() : accounts[0] ? accounts[0].id : "");

  const initialType = initial.kind === "transfer" ? "transfer" : initial.amountCents > 0 ? "in" : "out";
  const [type, setType] = useState(initial._type || initialType);
  const [amountCents, setAmountCents] = useState(initial.amountCents != null ? initial.amountCents : null);
  const [currency, setCurrency] = useState(initial.currency || accountCurrency(initial.kind === "transfer" ? initial.fromAccountId : defaultAccount));
  const [date, setDate] = useState(initial.date || todayISO());
  const [label, setLabel] = useState(initial.label || "");
  const [accountId, setAccountId] = useState(defaultAccount);
  const [categoryId, setCategoryId] = useState(initial.categoryId || "");
  const [party, setParty] = useState(initial.party || "");
  const [note, setNote] = useState(initial.note || "");
  const [needsReview, setNeedsReview] = useState(!!initial.needsReview);
  const [settledCents, setSettledCents] = useState(initial.settledCents != null ? initial.settledCents : null);
  const [fromAccountId, setFromAccountId] = useState(initial.fromAccountId || "");
  const [toAccountId, setToAccountId] = useState(initial.toAccountId || "");
  const [toAmountCents, setToAmountCents] = useState(initial.toAmountCents != null ? initial.toAmountCents : null);
  const [attachments, setAttachments] = useState(initial.attachments || []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const hasSplits = Array.isArray(initial.splits) && initial.splits.length > 0;
  const closed = editing && isMonthClosed(config, monthOf(initial.date));
  const locked = !canWrite || closed;
  const isTransfer = type === "transfer";
  const sign = type === "in" ? 1 : -1;

  const categories = listCategories(config, { kind: type === "in" ? "income" : "expense" });
  const categoryOptions = [{ value: "", label: "Non classée" }, ...categories.map((c) => ({ value: c.id, label: c.name, group: groupLabel(c.group) }))];
  const suggestion = !isTransfer && !categoryId && (label || party) ? suggestCategory(config, { label, party, amountCents: sign * Math.abs(amountCents || 0) }) : null;
  const suggested = suggestion && categories.find((c) => c.id === suggestion.categoryId);

  const accCur = accountCurrency(accountId);
  const showSettled = !isTransfer && accountId && currency !== accCur;
  const toCur = accountCurrency(toAccountId);
  const showToAmount = isTransfer && toAccountId && currency !== toCur;

  function changeType(next) {
    setType(next);
    setError("");
    if (next !== "transfer" && categoryId) {
      const kind = next === "in" ? "income" : "expense";
      if (!listCategories(config, { kind }).some((c) => c.id === categoryId)) setCategoryId("");
    }
  }

  function changeAccount(id) {
    setAccountId(id);
    if (!editing && amountCents == null) setCurrency(accountCurrency(id));
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    const added = [];
    for (const file of files) {
      const res = await uploadAttachment(file);
      if (res.ok) added.push(res.attachment);
    }
    setUploading(false);
    if (added.length) setAttachments((list) => [...list, ...added]);
  }

  function buildDraft() {
    const abs = Math.abs(amountCents || 0);
    const common = { id: initial.id, date, label: label.trim(), note: note.trim(), attachments, source: initial.source || "manual", extId: initial.extId, meta: initial.meta, reconciled: initial.reconciled, bank: initial.bank, estimated: initial.estimated, demo: initial.demo, ref: initial.ref, card: initial.card };
    if (isTransfer) {
      return { ...common, kind: "transfer", fromAccountId, toAccountId, amountCents: abs, currency, toAmountCents: showToAmount && toAmountCents ? Math.abs(toAmountCents) : undefined, needsReview };
    }
    const draft = { ...common, kind: "pl", accountId, amountCents: sign * abs, currency, party: party.trim(), needsReview };
    if (hasSplits && initial.amountCents === draft.amountCents) draft.splits = initial.splits;
    else draft.categoryId = categoryId || null;
    if (showSettled && settledCents) draft.settledCents = sign * Math.abs(settledCents);
    return draft;
  }

  async function submit(again) {
    setError("");
    if (!amountCents) {
      setError("Indique un montant.");
      return;
    }
    setBusy(true);
    const res = await saveOp(buildDraft());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!isTransfer && accountId) rememberAccount(accountId);
    toast(editing ? "Opération modifiée." : "Opération ajoutée.", { tone: "success" });
    if (again) {
      setAmountCents(null);
      setLabel("");
      setParty("");
      setNote("");
      setSettledCents(null);
      setToAmountCents(null);
      setAttachments([]);
    } else {
      onClose();
    }
  }

  async function remove() {
    const yes = await confirmDialog({ title: "Supprimer cette opération ?", message: "Elle disparaîtra des chiffres et du calcul des associés.", confirmLabel: "Supprimer", danger: true });
    if (!yes) return;
    setBusy(true);
    const res = await removeOps([initial.id]);
    setBusy(false);
    if (res.ok) {
      toast("Opération supprimée.", { tone: "success" });
      onClose();
    }
  }

  const sentence = isTransfer ? transferSentence(config, fromAccountId, toAccountId) : ownerSentence(config, accountId, type);
  const noAccount = accounts.length === 0;

  const footer = locked ? (
    <Button variant="secondary" onClick={onClose}>
      Fermer
    </Button>
  ) : (
    <>
      {editing ? (
        <Button variant="ghost" icon="trash" onClick={remove} disabled={busy}>
          Supprimer
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => submit(true)} disabled={busy || noAccount}>
          Enregistrer et nouvelle
        </Button>
      )}
      <Button variant="primary" onClick={() => submit(false)} loading={busy} disabled={noAccount}>
        Enregistrer
      </Button>
    </>
  );

  return (
    <Modal title={editing ? "Modifier l'opération" : "Nouvelle opération"} onClose={onClose} footer={footer} size="md">
      <div class="stack">
        {closed ? <Banner tone="warn">Le mois de {monthLabel(monthOf(initial.date))} est clôturé : rouvre-le pour modifier cette opération.</Banner> : null}
        {noAccount ? (
          <Banner
            tone="warn"
            action={
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  navigate("reglages");
                }}
              >
                Ouvrir les réglages
              </Button>
            }
          >
            Ajoute d'abord un compte (par exemple ton Revolut ou le compte Slash) dans Réglages.
          </Banner>
        ) : null}
        <Segmented
          full
          label="Type d'opération"
          value={type}
          onChange={changeType}
          disabled={locked || (editing && initial.kind === "transfer") || (editing && initial.kind === "pl" && false)}
          options={
            editing
              ? initial.kind === "transfer"
                ? [{ value: "transfer", label: "Mouvement entre comptes" }]
                : [
                    { value: "out", label: "Dépense" },
                    { value: "in", label: "Encaissement" },
                  ]
              : [
                  { value: "out", label: "Dépense" },
                  { value: "in", label: "Encaissement" },
                  { value: "transfer", label: "Apport, remboursement" },
                ]
          }
        />

        <Field label="Montant" required>
          <MoneyInput cents={amountCents} onChange={setAmountCents} currency={currency} onCurrency={setCurrency} sign={isTransfer ? null : type} disabled={locked} autoFocus={!editing} />
        </Field>

        <Field label="Date" required>
          <DateInput value={date} onChange={setDate} disabled={locked} max={todayISO()} />
        </Field>

        {isTransfer ? (
          <>
            <Field label="Depuis le compte" required hint="Pour un apport : le compte perso de l'associé qui met l'argent.">
              <Select value={fromAccountId} onChange={setFromAccountId} options={accountOptions} placeholder="Choisir un compte" disabled={locked} />
            </Field>
            <Field label="Vers le compte" required hint="Pour un apport : le compte de l'entreprise qui reçoit l'argent.">
              <Select value={toAccountId} onChange={setToAccountId} options={accountOptions} placeholder="Choisir un compte" disabled={locked} />
            </Field>
            {showToAmount ? (
              <Field label={`Montant reçu en ${toCur}`} optional hint="Si tu le connais : sinon il est estimé avec le taux du mois.">
                <MoneyInput cents={toAmountCents} onChange={setToAmountCents} currency={toCur} disabled={locked} />
              </Field>
            ) : null}
          </>
        ) : (
          <>
            <Field label={type === "in" ? "Reçu sur" : "Payé avec"} required>
              <Select value={accountId} onChange={changeAccount} options={accountOptions} placeholder="Choisir un compte" disabled={locked} />
            </Field>
            {showSettled ? (
              <Field label={`Montant réellement ${type === "in" ? "reçu" : "débité"} en ${accCur}`} optional hint="Celui du relevé du compte. Sinon il est estimé avec le taux du mois.">
                <MoneyInput cents={settledCents} onChange={setSettledCents} currency={accCur} sign={type} disabled={locked} />
              </Field>
            ) : null}
            {hasSplits ? (
              <Banner tone="info">Cette opération est répartie sur plusieurs catégories (ventes, frais, remboursements). La répartition est conservée tant que le montant ne change pas.</Banner>
            ) : (
              <Field label="Catégorie">
                <Select value={categoryId} onChange={setCategoryId} options={categoryOptions} disabled={locked} />
                {suggested && !locked ? (
                  <div class="row gap-1 opform-suggest">
                    <Chip icon="sparkles" onClick={() => setCategoryId(suggested.id)}>
                      {suggested.name}
                    </Chip>
                  </div>
                ) : null}
              </Field>
            )}
          </>
        )}

        {sentence ? <p class="opform-sentence">{sentence}</p> : null}

        <Field label="Libellé" hint={isTransfer ? "Par exemple : Apport de trésorerie." : "Par exemple : Meta Ads, prélèvement du 12."}>
          <TextInput value={label} onChange={setLabel} disabled={locked} maxLength={140} />
        </Field>

        {!isTransfer ? (
          <Field label={type === "in" ? "Payé par" : "Fournisseur"} optional>
            <TextInput value={party} onChange={setParty} disabled={locked} maxLength={80} />
          </Field>
        ) : null}

        <Field label="Note" optional>
          <TextArea value={note} onChange={setNote} rows={2} disabled={locked} maxLength={500} />
        </Field>

        <div class="stack-sm">
          <span class="field-label">Justificatifs</span>
          {attachments.length ? (
            <ul class="opform-files">
              {attachments.map((file) => (
                <li key={file.id}>
                  <span class="truncate">
                    {file.name || "Fichier"} <span class="subtle">({fmtFileSize(file.size)})</span>
                  </span>
                  {!locked ? (
                    <Button size="sm" variant="ghost" onClick={() => setAttachments((list) => list.filter((f) => f.id !== file.id))}>
                      Retirer
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p class="subtle text-sm">Aucun justificatif.</p>
          )}
          {!locked && platform && platform.files ? (
            <label class="opform-upload">
              <input type="file" id="opform-file" multiple accept={platform.files.accept} onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} disabled={uploading} />
              <span>{uploading ? "Envoi en cours..." : "Ajouter un reçu (photo, capture ou PDF)"}</span>
            </label>
          ) : null}
        </div>

        {!locked ? <Toggle checked={needsReview} onChange={setNeedsReview} label="À vérifier" hint="Coche si tu n'es pas sûr du montant ou de la catégorie." /> : null}

        {error ? <Banner tone="out">{error}</Banner> : null}
      </div>
    </Modal>
  );
}
