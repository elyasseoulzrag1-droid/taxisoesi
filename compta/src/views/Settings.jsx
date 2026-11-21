// Réglages : entreprise, associés, comptes et cartes, partage du bénéfice, sauvegarde.
import { useState } from "preact/hooks";
import { useBook, useCanWrite, usePlatform } from "../app/state.js";
import { saveConfigPatch, upsertPartner, upsertAccount, upsertShareRule, removeEntity, exportFile } from "../app/actions.js";
import { listPartners, listAccounts, listShareRules, partnerLabel, ACCOUNT_KINDS, PARTNER_ROLES } from "../core/model.js";
import { CURRENCY_CODES } from "../core/money.js";
import { todayISO } from "../core/dates.js";
import { Button, Card, Section, List, ListItem, Modal, Field, TextInput, DateInput, Select, Banner, Avatar, Badge, EmptyState, MoneyInput, confirmDialog, toast, fmtDate, fmtNumber } from "../ui/index.js";

const currencyOptions = CURRENCY_CODES.map((code) => ({ value: code, label: code }));

function ownerOptions(config) {
  return [
    { value: "business", label: "L'entreprise" },
    ...listPartners(config).map((p) => ({ value: p.id, label: "Perso : " + p.name })),
    { value: "unknown", label: "Je ne sais pas encore" },
  ];
}

function ownerName(config, owner) {
  if (owner === "business") return "Compte de l'entreprise";
  if (owner === "unknown") return "À attribuer";
  return "Compte perso de " + partnerLabel(config, owner);
}

function PartnerModal({ partner, order, onClose }) {
  const [name, setName] = useState(partner.name || "");
  const [role, setRole] = useState(partner.role || "partner");
  const [joinedOn, setJoinedOn] = useState(partner.joinedOn || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!name.trim()) {
      setError("Indique un prénom ou un nom.");
      return;
    }
    setBusy(true);
    const res = await upsertPartner({ ...partner, name: name.trim(), role, joinedOn: joinedOn || null, order: partner.order != null ? partner.order : order, archived: !!partner.archived });
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error);
  }
  return (
    <Modal
      title={partner.id ? "Modifier l'associé" : "Nouvel associé"}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div class="stack">
        <Field label="Prénom ou nom" required error={error || undefined}>
          <TextInput value={name} onChange={setName} autoFocus maxLength={40} />
        </Field>
        <Field label="Rôle">
          <Select value={role} onChange={setRole} options={PARTNER_ROLES.map((r) => ({ value: r.id, label: r.label }))} />
        </Field>
        <Field label="Arrivé le" optional hint="Sert seulement à l'affichage. Le partage se règle plus bas.">
          <DateInput value={joinedOn} onChange={setJoinedOn} max={todayISO()} />
        </Field>
      </div>
    </Modal>
  );
}

function AccountModal({ account, config, order, onClose }) {
  const [name, setName] = useState(account.name || "");
  const [kind, setKind] = useState(account.kind || "bank");
  const [owner, setOwner] = useState(account.owner || "business");
  const [currency, setCurrency] = useState(account.currency || config.business.baseCurrency || "USD");
  const [cards, setCards] = useState((account.cards || []).join(", "));
  const [openingCents, setOpeningCents] = useState(account.openingCents || 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!name.trim()) {
      setError("Donne un nom à ce compte.");
      return;
    }
    const last4 = cards
      .split(/[\s,;]+/)
      .map((c) => c.replace(/\D/g, "").slice(-4))
      .filter((c) => c.length === 4);
    setBusy(true);
    const res = await upsertAccount({
      ...account,
      name: name.trim(),
      kind,
      owner,
      currency,
      cards: last4,
      openingCents: owner === "business" ? openingCents || 0 : 0,
      order: account.order != null ? account.order : order,
      archived: !!account.archived,
    });
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error);
  }
  return (
    <Modal
      title={account.id ? "Modifier le compte" : "Nouveau compte"}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div class="stack">
        <Field label="Nom du compte" required error={error || undefined} hint="Par exemple : Revolut perso, Slash, Carte de Sam.">
          <TextInput value={name} onChange={setName} autoFocus maxLength={50} />
        </Field>
        <Field label="À qui est l'argent de ce compte ?" hint="C'est ce qui permet de savoir qui a payé quoi.">
          <Select value={owner} onChange={setOwner} options={ownerOptions(config)} />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={setKind} options={ACCOUNT_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        </Field>
        <Field label="Devise du compte">
          <Select value={currency} onChange={setCurrency} options={currencyOptions} />
        </Field>
        <Field label="4 derniers chiffres des cartes" optional hint="Sépare-les par une virgule. Sert à retrouver le bon compte sur un reçu.">
          <TextInput value={cards} onChange={setCards} inputMode="numeric" placeholder="0562, 4410" />
        </Field>
        {owner === "business" ? (
          <Field label="Solde de départ" optional hint="Ce qu'il y avait sur le compte avant la première opération saisie.">
            <MoneyInput cents={openingCents} onChange={(c) => setOpeningCents(c || 0)} currency={currency} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function ShareRuleModal({ rule, config, onClose }) {
  const partners = listPartners(config);
  const [from, setFrom] = useState(rule.from || "");
  const [fromStart, setFromStart] = useState(rule.id ? rule.from == null : false);
  const [shares, setShares] = useState(() => {
    const out = {};
    for (const p of partners) out[p.id] = rule.shares && rule.shares[p.id] != null ? String(rule.shares[p.id]).replace(".", ",") : "";
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parse = (v) => {
    const n = Number(String(v || "").replace(",", ".").replace("%", "").trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const total = partners.reduce((sum, p) => sum + parse(shares[p.id]), 0);
  const rounded = Math.round(total * 100) / 100;
  function equal() {
    const chosen = partners.filter((p) => parse(shares[p.id]) > 0);
    const list = chosen.length ? chosen : partners;
    const each = Math.round((100 / list.length) * 100) / 100;
    const next = {};
    for (const p of partners) next[p.id] = list.includes(p) ? String(each).replace(".", ",") : "";
    setShares(next);
  }
  async function save() {
    if (!fromStart && !from) {
      setError("Indique la date à partir de laquelle ce partage s'applique.");
      return;
    }
    if (Math.abs(rounded - 100) > 0.011) {
      setError(`Le total fait ${fmtNumber(rounded, 2)} % : il doit faire 100.`);
      return;
    }
    const clean = {};
    for (const p of partners) if (parse(shares[p.id]) > 0) clean[p.id] = parse(shares[p.id]);
    setBusy(true);
    // On remplace la règle entière : les anciens pourcentages absents sont remis à zéro.
    const blank = {};
    for (const id of Object.keys((rule && rule.shares) || {})) if (!(id in clean)) blank[id] = null;
    const res = await upsertShareRule({ id: rule.id, from: fromStart ? null : from, shares: { ...blank, ...clean } });
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error);
  }
  return (
    <Modal
      title={rule.id ? "Modifier le partage" : "Nouveau partage du bénéfice"}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div class="stack">
        <Field label="S'applique à partir du" hint="Chaque opération suit le partage en vigueur à sa date.">
          <Select
            value={fromStart ? "start" : "date"}
            onChange={(v) => setFromStart(v === "start")}
            options={[
              { value: "start", label: "Depuis le tout début" },
              { value: "date", label: "À partir d'une date" },
            ]}
          />
        </Field>
        {!fromStart ? (
          <Field label="Date de début" required>
            <DateInput value={from} onChange={setFrom} />
          </Field>
        ) : null}
        {partners.map((p) => (
          <Field key={p.id} label={`Part de ${p.name}`}>
            <TextInput value={shares[p.id]} onChange={(v) => setShares({ ...shares, [p.id]: v })} inputMode="decimal" suffix="%" placeholder="0" />
          </Field>
        ))}
        <div class="row-between">
          <span class={Math.abs(rounded - 100) > 0.011 ? "t-warn" : "t-in"}>Total : {fmtNumber(rounded, 2)} %</span>
          <Button size="sm" variant="ghost" onClick={equal}>
            Parts égales
          </Button>
        </div>
        {error ? <Banner tone="out">{error}</Banner> : null}
      </div>
    </Modal>
  );
}

export default function Settings() {
  const book = useBook();
  const canWrite = useCanWrite();
  const platform = usePlatform();
  const { config } = book;
  const [modal, setModal] = useState(null);
  const [name, setName] = useState(config.business.name || "");
  const [startDate, setStartDate] = useState(config.business.startDate || "");
  const partners = listPartners(config, { includeArchived: true });
  const accounts = listAccounts(config, { includeArchived: true });
  const rules = listShareRules(config);
  const close = () => setModal(null);

  async function saveBusiness() {
    const res = await saveConfigPatch({ business: { name: name.trim() || "StarringYou", startDate: startDate || null } }, "Réglages de l'entreprise");
    if (res.ok) toast("Réglages enregistrés.", { tone: "success" });
  }

  async function removeRule(rule) {
    const yes = await confirmDialog({ title: "Supprimer ce partage ?", message: "Les opérations de cette période suivront le partage précédent.", confirmLabel: "Supprimer", danger: true });
    if (yes) removeEntity("shareRules", rule.id, "Suppression d'une règle de partage");
  }

  async function backup() {
    if (!platform || !platform.store) return;
    const dump = await platform.store.exportAll();
    exportFile(`compta-starringyou-${todayISO()}.json`, JSON.stringify(dump, null, 2));
  }

  return (
    <div class="page page-narrow stack-lg">
      <header class="page-head">
        <div class="page-head-text">
          <h1 class="page-title">Réglages</h1>
          <p class="page-sub">Les associés, les comptes et le partage du bénéfice : c'est ce qui rend les calculs justes.</p>
        </div>
      </header>

      {!canWrite ? <Banner tone="info">Tu es en lecture seule : tu peux consulter les réglages, pas les modifier.</Banner> : null}

      <Section title="Entreprise">
        <Card>
          <div class="stack">
            <Field label="Nom">
              <TextInput value={name} onChange={setName} disabled={!canWrite} maxLength={60} />
            </Field>
            <Field label="Date de lancement" optional>
              <DateInput value={startDate} onChange={setStartDate} disabled={!canWrite} max={todayISO()} />
            </Field>
            {canWrite ? (
              <div class="row-end">
                <Button onClick={saveBusiness}>Enregistrer</Button>
              </div>
            ) : null}
          </div>
        </Card>
      </Section>

      <Section
        title="Associés"
        action={
          canWrite ? (
            <Button size="sm" icon="plus" onClick={() => setModal({ type: "partner", value: {} })}>
              Ajouter
            </Button>
          ) : null
        }
      >
        <Card pad={false}>
          {partners.length ? (
            <List label="Associés">
              {partners.map((p, i) => (
                <ListItem
                  key={p.id}
                  lead={<Avatar name={p.name} index={i} size="sm" />}
                  title={p.name}
                  sub={[(PARTNER_ROLES.find((r) => r.id === p.role) || {}).label, p.joinedOn ? "arrivé le " + fmtDate(p.joinedOn) : null, p.archived ? "archivé" : null].filter(Boolean).join(" · ")}
                  onClick={canWrite ? () => setModal({ type: "partner", value: p }) : undefined}
                />
              ))}
            </List>
          ) : (
            <EmptyState compact icon="users" title="Aucun associé" text="Ajoute chaque personne qui met de l'argent ou touche une part du bénéfice." />
          )}
        </Card>
      </Section>

      <Section
        title="Partage du bénéfice"
        sub="Le partage porte sur le bénéfice (ventes moins dépenses), pas sur le chiffre d'affaires. Ajoute une ligne à chaque fois que la répartition change."
        action={
          canWrite && partners.length ? (
            <Button size="sm" icon="plus" onClick={() => setModal({ type: "rule", value: {} })}>
              Ajouter
            </Button>
          ) : null
        }
      >
        <Card pad={false}>
          {rules.length ? (
            <List label="Règles de partage">
              {rules.map((rule) => {
                const parts = Object.entries(rule.shares)
                  .filter(([, pct]) => pct > 0)
                  .map(([id, pct]) => `${partnerLabel(config, id)} ${fmtNumber(pct, 2)} %`);
                const total = Object.values(rule.shares).reduce((s, v) => s + (v || 0), 0);
                return (
                  <ListItem
                    key={rule.id}
                    icon="percent"
                    tone={Math.abs(total - 100) > 0.011 ? "warn" : "accent"}
                    title={rule.from ? "À partir du " + fmtDate(rule.from) : "Depuis le début"}
                    sub={parts.join(" · ") || "Aucune part"}
                    trailing={
                      canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRule(rule);
                          }}
                        >
                          Supprimer
                        </Button>
                      ) : null
                    }
                    chevron={false}
                    onClick={canWrite ? () => setModal({ type: "rule", value: rule }) : undefined}
                  />
                );
              })}
            </List>
          ) : (
            <EmptyState compact icon="percent" title="Aucun partage défini" text="Sans règle, le bénéfice est partagé à parts égales entre les associés." />
          )}
        </Card>
      </Section>

      <Section
        title="Comptes et cartes"
        sub="Pour chaque compte, indique à qui est l'argent : à l'entreprise, ou à un associé (compte ou carte perso)."
        action={
          canWrite ? (
            <Button size="sm" icon="plus" onClick={() => setModal({ type: "account", value: {} })}>
              Ajouter
            </Button>
          ) : null
        }
      >
        <Card pad={false}>
          {accounts.length ? (
            <List label="Comptes">
              {accounts.map((a) => (
                <ListItem
                  key={a.id}
                  icon={a.kind === "card" ? "wallet" : "bank"}
                  tone={a.owner === "unknown" ? "warn" : "neutral"}
                  title={a.name}
                  sub={[ownerName(config, a.owner), a.currency, a.cards && a.cards.length ? "cartes " + a.cards.join(", ") : null, a.archived ? "archivé" : null].filter(Boolean).join(" · ")}
                  trailing={a.owner === "unknown" ? <Badge tone="warn">À attribuer</Badge> : null}
                  onClick={canWrite ? () => setModal({ type: "account", value: a }) : undefined}
                />
              ))}
            </List>
          ) : (
            <EmptyState compact icon="bank" title="Aucun compte" text="Ajoute ton Revolut, le compte Slash et les cartes perso utilisées pour l'entreprise." />
          )}
        </Card>
      </Section>

      <Section title="Sauvegarde" sub="Un fichier avec toutes tes données, à garder de côté.">
        <Card>
          <div class="row row-wrap gap-3">
            <Button icon="download" onClick={backup} disabled={!platform || !platform.exporter}>
              Télécharger une sauvegarde
            </Button>
            {canWrite && partners.some((p) => !p.archived) ? (
              <span class="subtle text-sm">Pour retirer un associé ou un compte qui a déjà servi, ouvre-le puis archive-le.</span>
            ) : null}
          </div>
        </Card>
      </Section>

      {modal && modal.type === "partner" ? <PartnerModal partner={modal.value} order={partners.length} onClose={close} /> : null}
      {modal && modal.type === "account" ? <AccountModal account={modal.value} config={config} order={accounts.length} onClose={close} /> : null}
      {modal && modal.type === "rule" ? <ShareRuleModal rule={modal.value} config={config} onClose={close} /> : null}
    </div>
  );
}

