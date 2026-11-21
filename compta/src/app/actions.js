// Toutes les écritures passent par ici : contrôle des droits, validation, traçabilité, messages d'erreur.
// Chaque action renvoie { ok: true, ... } ou { ok: false, error } et ne lève jamais d'exception.
import { getState, setUi } from "./state.js";
import { validateOp, normalizeOp, isMonthClosed } from "../core/model.js";
import { newId } from "../core/ids.js";
import { monthOf, monthLabel } from "../core/dates.js";
import { formatMoney } from "../core/money.js";
import { toast } from "../ui/index.js";

/** Champs d'une opération réellement enregistrés (le reste est calculé à l'affichage). */
const OP_FIELDS = [
  "id", "kind", "date", "label",
  "accountId", "amountCents", "currency", "settledCents", "categoryId", "splits",
  "fromAccountId", "toAccountId", "toAmountCents",
  "party", "ref", "card", "note", "attachments",
  "source", "extId", "needsReview", "estimated", "reconciled", "bank", "meta", "demo",
  "createdAt", "createdBy", "updatedAt", "updatedBy",
];

const nowISO = () => new Date().toISOString();
const userId = () => {
  const p = getState().platform;
  return (p && p.user && p.user.id) || null;
};
const store = () => {
  const p = getState().platform;
  return p ? p.store : null;
};

function errorMessage(err) {
  if (err && typeof err.message === "string" && err.message) return err.message;
  return "L'enregistrement n'a pas abouti. Vérifie ta connexion puis réessaie.";
}

function fail(error, silent) {
  if (!silent) toast(error, { tone: "danger" });
  return { ok: false, error };
}

function writeGuard() {
  if (!store()) return "La base de données n'est pas disponible. Recharge la page.";
  if (!getState().canWrite) return "Tu es en lecture seule : tu ne peux pas modifier les données.";
  return null;
}

/** Ne garde que les champs enregistrables et retire les valeurs vides. */
export function toStoredOp(input) {
  const op = {};
  for (const key of OP_FIELDS) {
    const v = input[key];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (key === "meta" && typeof v === "object" && Object.keys(v).length === 0) continue;
    op[key] = v;
  }
  if (op.kind === "transfer") {
    delete op.accountId; delete op.categoryId; delete op.splits; delete op.settledCents;
  } else {
    delete op.fromAccountId; delete op.toAccountId; delete op.toAmountCents;
    if (op.splits) delete op.categoryId;
  }
  return op;
}

function describe(op) {
  const amount = formatMoney(op.amountCents, op.currency || "USD");
  return `${op.label || "Opération"} (${amount})`;
}

function audit(entry) {
  const s = store();
  if (!s) return;
  s.addAudit({ id: newId("au"), at: nowISO(), by: userId(), ...entry }).catch(() => {});
}

function prepare(draft, existing) {
  const now = nowISO();
  const base = toStoredOp({ ...draft, id: draft.id || newId("op") });
  if (existing) {
    base.createdAt = existing.createdAt || now;
    if (existing.createdBy) base.createdBy = existing.createdBy;
    base.updatedAt = now;
    const by = userId();
    if (by) base.updatedBy = by;
  } else {
    base.createdAt = base.createdAt || now;
    const by = userId();
    if (by && !base.createdBy) base.createdBy = by;
  }
  return normalizeOp(base);
}

/** Crée (pas d'id) ou modifie une opération. */
export async function saveOp(draft) {
  const blocked = writeGuard();
  if (blocked) return fail(blocked);
  const { data, book } = getState();
  const existing = draft.id ? book.byId.get(draft.id) : null;
  const op = prepare(draft, existing);
  if (!op) return { ok: false, error: "Cette opération est incomplète : il faut au moins une date et un montant.", problems: [] };
  const problems = validateOp(op, data.config);
  if (problems.length) return { ok: false, error: problems[0], problems };
  if (existing && isMonthClosed(data.config, monthOf(existing.date))) {
    return fail(`Le mois de ${monthLabel(monthOf(existing.date))} est clôturé. Rouvre-le dans Rapports pour modifier cette opération.`);
  }
  try {
    await store().putOps([op]);
  } catch (err) {
    return fail(errorMessage(err));
  }
  audit({ action: existing ? "update" : "create", opId: op.id, summary: (existing ? "Modification : " : "Ajout : ") + describe(op) });
  return { ok: true, op };
}

/** Crée ou modifie plusieurs opérations d'un coup (imports, actions groupées). */
export async function saveOps(drafts, { source, summary } = {}) {
  const blocked = writeGuard();
  if (blocked) return fail(blocked);
  const { data, book } = getState();
  const ops = [];
  const rejected = [];
  for (const draft of drafts) {
    const existing = draft.id ? book.byId.get(draft.id) : null;
    const op = prepare(source && !draft.source ? { ...draft, source } : draft, existing);
    const problems = op ? validateOp(op, data.config) : ["Opération incomplète"];
    if (!op || problems.length) rejected.push({ draft, problems });
    else ops.push(op);
  }
  if (!ops.length) {
    const why = rejected.length ? rejected[0].problems[0] : "Rien à enregistrer.";
    return fail(why);
  }
  try {
    await store().putOps(ops);
  } catch (err) {
    return fail(errorMessage(err));
  }
  audit({ action: "import", count: ops.length, summary: summary || `${ops.length} opération(s) enregistrée(s)` });
  return { ok: true, ops, rejected };
}

export async function removeOps(ids) {
  const blocked = writeGuard();
  if (blocked) return fail(blocked);
  const { data, book } = getState();
  const targets = ids.map((id) => book.byId.get(id)).filter(Boolean);
  const locked = targets.find((op) => isMonthClosed(data.config, monthOf(op.date)));
  if (locked) return fail(`Le mois de ${monthLabel(monthOf(locked.date))} est clôturé : rouvre-le pour supprimer cette opération.`);
  if (!targets.length) return { ok: true, count: 0 };
  try {
    await store().deleteOps(targets.map((op) => op.id));
  } catch (err) {
    return fail(errorMessage(err));
  }
  audit({
    action: "delete",
    count: targets.length,
    opId: targets.length === 1 ? targets[0].id : undefined,
    summary: targets.length === 1 ? "Suppression : " + describe(targets[0]) : `Suppression de ${targets.length} opérations`,
  });
  return { ok: true, count: targets.length };
}

/** Modifie les réglages par fusion profonde (mettre null pour retirer une entrée d'une liste). */
export async function saveConfigPatch(patch, summary, { silent } = {}) {
  const blocked = writeGuard();
  if (blocked) return fail(blocked, silent);
  try {
    await store().saveConfig({ v: 1, ...patch });
  } catch (err) {
    return fail(errorMessage(err), silent);
  }
  if (summary) audit({ action: "config", summary });
  return { ok: true };
}

function upsert(mapName, prefix, entity, label) {
  const id = entity.id || newId(prefix);
  const value = { ...entity, id };
  return saveConfigPatch({ [mapName]: { [id]: value } }, `${label} : ${entity.name || entity.label || entity.contains || id}`).then((res) =>
    res.ok ? { ok: true, id, value } : res,
  );
}

export const upsertPartner = (partner) => upsert("partners", "pa", partner, "Associé");
export const upsertAccount = (account) => upsert("accounts", "ac", account, "Compte");
export const upsertCategory = (category) => upsert("categories", "cat", category, "Catégorie");
export const upsertRule = (rule) => upsert("rules", "ru", rule, "Règle de classement");
export const upsertRecurring = (item) => upsert("recurring", "re", item, "Abonnement");
export const upsertShareRule = (rule) => upsert("shareRules", "sr", rule, "Règle de partage du bénéfice");

/** Retire définitivement une entrée d'une liste des réglages (règle, abonnement, règle de partage). */
export function removeEntity(mapName, id, summary) {
  return saveConfigPatch({ [mapName]: { [id]: null } }, summary || "Suppression dans les réglages");
}

/** Archive ou réactive un associé, un compte ou une catégorie (on ne supprime pas ce qui est utilisé). */
export function archiveEntity(mapName, id, archived = true) {
  return saveConfigPatch({ [mapName]: { [id]: { archived } } }, archived ? "Archivage dans les réglages" : "Réactivation dans les réglages");
}

export function setBaseCurrency(code) {
  return saveConfigPatch({ business: { baseCurrency: code } }, `Devise d'affichage : ${code}`);
}

/** month = "AAAA-MM", ou null pour le taux par défaut de la devise. */
export function setFxRate(currency, month, rate) {
  const entry = month ? { months: { [month]: rate } } : { default: rate };
  return saveConfigPatch({ fx: { [currency]: entry } }, `Taux de change ${currency}${month ? " (" + monthLabel(month) + ")" : ""}`);
}

export function closeMonth(month) {
  return saveConfigPatch({ closed: { [month]: { at: nowISO(), by: userId() } } }, null).then((res) => {
    if (res.ok) audit({ action: "close", summary: `Clôture de ${monthLabel(month)}` });
    return res;
  });
}

export function reopenMonth(month) {
  return saveConfigPatch({ closed: { [month]: null } }, null).then((res) => {
    if (res.ok) audit({ action: "reopen", summary: `Réouverture de ${monthLabel(month)}` });
    return res;
  });
}

/** Enregistre des statistiques (commandes Shopify, performances pub) : { "AAAA-MM": patch }. */
export async function saveStats(statsByMonth, summary) {
  const blocked = writeGuard();
  if (blocked) return fail(blocked);
  const months = Object.keys(statsByMonth || {});
  if (!months.length) return { ok: true, months: 0 };
  try {
    for (const month of months) await store().putStats(month, statsByMonth[month]);
  } catch (err) {
    return fail(errorMessage(err));
  }
  audit({ action: "import", summary: summary || `Statistiques mises à jour (${months.length} mois)` });
  return { ok: true, months: months.length };
}

/** Envoie un justificatif et renvoie { ok, attachment: { id, name, type, size } }. */
export async function uploadAttachment(file) {
  const platform = getState().platform;
  if (!platform || !platform.files) return fail("L'ajout de justificatifs n'est pas disponible ici.");
  try {
    const attachment = await platform.files.upload(file, file.name);
    return { ok: true, attachment };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/** Propose un fichier à l'enregistrement (CSV, Excel, JSON). */
export async function exportFile(filename, data) {
  const platform = getState().platform;
  if (!platform || !platform.exporter) return fail("L'export de fichiers n'est pas disponible ici.");
  try {
    const status = await platform.exporter.save(filename, data);
    if (status === "declined") return { ok: false, error: "Export annulé." };
    toast("Fichier enregistré : " + filename, { tone: "success" });
    return { ok: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/** Supprime les opérations d'exemple. */
export async function removeDemoData() {
  const blocked = writeGuard();
  if (blocked) return fail(blocked);
  const ids = getState().data.ops.filter((op) => op.demo).map((op) => op.id);
  try {
    if (ids.length) await store().deleteOps(ids);
    await store().saveConfig({ demo: false });
  } catch (err) {
    return fail(errorMessage(err));
  }
  audit({ action: "delete", count: ids.length, summary: "Exemples effacés" });
  toast("Exemples effacés.", { tone: "success" });
  return { ok: true, count: ids.length };
}

/** Ouvre le formulaire d'opération (création avec valeurs pré-remplies, ou modification si `initial.id`). */
export function openOpForm(initial = {}) {
  setUi({ opForm: { initial } });
}

export function closeOpForm() {
  setUi({ opForm: null });
}
