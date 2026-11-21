// Associés : combien chacun a mis, combien chacun a déjà récupéré, et ce qui lui revient.
import { useState } from "preact/hooks";
import { useBook, useCanWrite } from "../app/state.js";
import { navigate } from "../app/router.js";
import { openOpForm } from "../app/actions.js";
import { listPartners, listAccounts, partnerLabel } from "../core/model.js";
import { settlementPlan } from "../core/settlement.js";
import { todayISO } from "../core/dates.js";
import { Button, Card, Section, Table, Banner, EmptyState, Segmented, Avatar, Money, List, ListItem, Badge, fmtMoney, fmtDate, fmtNumber } from "../ui/index.js";

const ENTRY_LABEL = {
  advance: "Dépense payée avec son argent",
  collect: "Vente reçue sur son compte",
  contribution: "Apport",
  withdrawal: "Remboursement ou retrait",
  settlement: "Règlement entre associés",
};

function periodTitle(period) {
  const count = period.partnerCount;
  const who = count === 1 ? "seul" : `à ${count}`;
  if (period.to && period.startsOn) return `Du ${fmtDate(period.startsOn, "jour")} au ${fmtDate(period.to, "jour")}, ${who}`;
  if (period.to) return `Jusqu'au ${fmtDate(period.to, "jour")}, ${who}`;
  if (period.startsOn || period.from) return `Depuis le ${fmtDate(period.from || period.startsOn, "jour")}, ${who}`;
  return `Depuis le début, ${who}`;
}

function who(config, id) {
  return id === "business" ? "L'entreprise" : partnerLabel(config, id);
}

export default function Partners() {
  const book = useBook();
  const canWrite = useCanWrite();
  const [mode, setMode] = useState("all");
  const { config, base } = book;
  const partners = listPartners(config);
  const money = (cents, opts) => fmtMoney(cents, base, opts);

  if (!partners.length) {
    return (
      <div class="page stack-lg">
        <header class="page-head">
          <div class="page-head-text">
            <h1 class="page-title">Associés</h1>
          </div>
        </header>
        <EmptyState
          icon="users"
          title="Aucun associé pour l'instant"
          text="Ajoute les associés et le partage du bénéfice dans Réglages : cette page calculera ce que chacun a mis et ce qui lui revient."
          action={
            <Button variant="primary" onClick={() => navigate("reglages")}>
              Ouvrir les réglages
            </Button>
          }
        />
      </div>
    );
  }

  const rows = partners.map((p, index) => {
    const pos = book.partners[p.id];
    return {
      id: p.id,
      index,
      name: p.name,
      put: pos.contributedCents + pos.advancedCents,
      got: pos.collectedCents + pos.withdrawnCents,
      net: pos.netCents - 0,
      settled: pos.settledCents,
      share: pos.profitShareCents,
      total: pos.equityCents,
      pct: pos.sharePct,
      pos,
    };
  });
  const total = rows.reduce(
    (t, r) => ({ put: t.put + r.put, got: t.got + r.got, net: t.net + r.net, share: t.share + r.share, total: t.total + r.total }),
    { put: 0, got: 0, net: 0, share: 0, total: 0 },
  );
  const plan = settlementPlan(book, { mode });
  const businessAccounts = listAccounts(config, { owner: "business" });
  const unknown = book.partners.unknown;

  const columns = [
    {
      key: "name",
      label: "Associé",
      phone: "title",
      render: (r) =>
        r.footer ? (
          <strong>Total</strong>
        ) : (
          <span class="row gap-1">
            <Avatar name={r.name} index={r.index} size="sm" />
            <span>
              {r.name} {r.pct ? <span class="subtle">({fmtNumber(r.pct)} %)</span> : null}
            </span>
          </span>
        ),
    },
    { key: "put", label: "A mis", align: "right", phone: "sub", phoneLabel: true, render: (r) => <Money cents={r.put} currency={base} /> },
    { key: "got", label: "A déjà récupéré", align: "right", phone: "sub", phoneLabel: true, render: (r) => <Money cents={r.got} currency={base} /> },
    { key: "net", label: "Reste à récupérer", align: "right", phone: "sub", phoneLabel: true, render: (r) => <Money cents={r.net} currency={base} tone="auto" /> },
    { key: "share", label: "Part du bénéfice", align: "right", phone: "sub", phoneLabel: true, render: (r) => <Money cents={r.share} currency={base} tone="auto" sign /> },
    { key: "total", label: "Total qui lui revient", align: "right", phone: "amount", render: (r) => <strong><Money cents={r.total} currency={base} tone="auto" /></strong> },
  ];

  return (
    <div class="page stack-lg">
      <header class="page-head">
        <div class="page-head-text">
          <h1 class="page-title">Associés</h1>
          <p class="page-sub">Ce que chacun a mis, ce qu'il a déjà récupéré, et ce qui lui revient. Depuis le début.</p>
        </div>
        {canWrite && businessAccounts.length ? (
          <div class="page-actions">
            <Button icon="arrow-in" onClick={() => openOpForm({ _type: "transfer", kind: "transfer", toAccountId: businessAccounts[0].id, label: "Apport de trésorerie", date: todayISO() })}>
              Enregistrer un apport
            </Button>
            <Button icon="arrow-out" onClick={() => openOpForm({ _type: "transfer", kind: "transfer", fromAccountId: businessAccounts[0].id, label: "Remboursement", date: todayISO() })}>
              Enregistrer un remboursement
            </Button>
          </div>
        ) : null}
      </header>

      {unknown ? (
        <Banner
          tone="warn"
          title="Des paiements ne sont attribués à personne"
          action={
            <Button size="sm" onClick={() => navigate("reglages")}>
              Attribuer les comptes
            </Button>
          }
        >
          {money(Math.abs(unknown.netCents))} passent par des comptes ou cartes dont on ne sait pas à qui ils appartiennent. Tant que ce n'est pas réglé, le calcul ci-dessous est incomplet.
        </Banner>
      ) : null}
      {book.checks.shareProblems.length ? (
        <Banner tone="warn" title="Le partage ne fait pas 100 %" action={<Button size="sm" onClick={() => navigate("reglages")}>Corriger</Button>}>
          Une partie du bénéfice n'est attribuée à personne sur au moins une période.
        </Banner>
      ) : null}

      <Section title="Le compte de chacun">
        <Card pad={false}>
          <Table columns={columns} rows={rows} rowKey="id" footer={{ footer: true, ...total }} caption="Ce que chaque associé a mis et ce qui lui revient" />
        </Card>
        <p class="muted text-sm">
          Trésorerie de l'entreprise aujourd'hui : <strong class="num">{money(book.businessCashCents, { approx: book.businessCashApprox })}</strong>
        </p>
      </Section>

      <Section title="Partage du bénéfice" sub="Le partage porte sur le bénéfice (ventes moins toutes les dépenses), jamais sur le chiffre d'affaires. Chaque opération suit la règle en vigueur à sa date.">
        <div class="stack">
          {book.sharePeriods.map((period) => (
            <Card key={period.index}>
              <div class="stack-sm">
                <div class="row-between row-wrap gap-1">
                  <strong>{periodTitle(period)}</strong>
                  <Badge tone={period.profitCents < 0 ? "out" : "in"}>
                    {period.profitCents < 0 ? "Perte" : "Bénéfice"} : {money(period.profitCents)}
                  </Badge>
                </div>
                <ul class="share-lines">
                  {partners
                    .filter((p) => period.shares[p.id] > 0)
                    .map((p) => (
                      <li key={p.id}>
                        <span>
                          {p.name} <span class="subtle">({fmtNumber(period.shares[p.id], 2)} %)</span>
                        </span>
                        <Money cents={period.perPartner[p.id] || 0} currency={base} tone="auto" sign />
                      </li>
                    ))}
                </ul>
                {period.sharesTotal !== 100 && period.partnerCount > 0 ? <p class="t-warn text-sm">Les pourcentages de cette période font {fmtNumber(period.sharesTotal, 2)} % au lieu de 100.</p> : null}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Qui doit verser quoi à qui" sub="La liste la plus courte de paiements pour remettre les compteurs à zéro. Tout solder : avances et part du bénéfice. Avances seules : on rembourse ce que chacun a mis, sans toucher au bénéfice.">
        <div class="stack">
          <Segmented
            label="Type de règlement"
            value={mode}
            onChange={setMode}
            options={[
              { value: "all", label: "Tout solder" },
              { value: "nets", label: "Avances seules" },
            ]}
          />
          <Card pad={false}>
            {plan.payments.length ? (
              <List label="Paiements à faire">
                {plan.payments.map((pay, i) => (
                  <ListItem
                    key={i}
                    icon="swap"
                    tone="accent"
                    title={`${who(config, pay.from)} verse ${money(pay.cents)} à ${who(config, pay.to)}`}
                    chevron={false}
                  />
                ))}
              </List>
            ) : (
              <EmptyState compact icon="check-circle" title="Tout est à l'équilibre" text="Personne ne doit rien à personne." />
            )}
          </Card>
          {plan.shortfallCents > 0 ? (
            <p class="t-warn text-sm">
              Il manque {money(plan.shortfallCents)} dans la trésorerie de l'entreprise pour tout payer : ce montant reste dû aux associés.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Le détail par associé">
        <div class="stack">
          {rows.map((r) => (
            <details class="partner-detail" key={r.id}>
              <summary>
                <span class="row gap-1">
                  <Avatar name={r.name} index={r.index} size="sm" />
                  <strong>{r.name}</strong>
                </span>
                <span class="subtle text-sm">{r.pos.entries.length} mouvement(s)</span>
              </summary>
              <dl class="partner-breakdown">
                <dt>Apports à l'entreprise</dt>
                <dd><Money cents={r.pos.contributedCents} currency={base} /></dd>
                <dt>Dépenses payées avec son argent</dt>
                <dd><Money cents={r.pos.advancedCents} currency={base} /></dd>
                <dt>Ventes reçues sur son compte</dt>
                <dd><Money cents={-r.pos.collectedCents} currency={base} /></dd>
                <dt>Remboursements et retraits</dt>
                <dd><Money cents={-r.pos.withdrawnCents} currency={base} /></dd>
                {r.pos.settledCents ? (
                  <>
                    <dt>Règlements entre associés</dt>
                    <dd><Money cents={-r.pos.settledCents} currency={base} /></dd>
                  </>
                ) : null}
                <dt class="strong">Reste à récupérer</dt>
                <dd class="strong"><Money cents={r.pos.netCents} currency={base} tone="auto" /></dd>
                <dt>Part du bénéfice</dt>
                <dd><Money cents={r.pos.profitShareCents} currency={base} tone="auto" sign /></dd>
                <dt class="strong">Total qui lui revient</dt>
                <dd class="strong"><Money cents={r.pos.equityCents} currency={base} tone="auto" /></dd>
              </dl>
              {r.pos.entries.length ? (
                <div class="scroll-x">
                  <table class="partner-entries">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mouvement</th>
                        <th class="num">Effet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.pos.entries
                        .slice()
                        .reverse()
                        .slice(0, 60)
                        .map((entry) => (
                          <tr key={entry.op.id}>
                            <td class="nowrap">{fmtDate(entry.op.date, "jour")}</td>
                            <td>
                              {entry.op.label || entry.op.party || "Sans libellé"}
                              <span class="subtle text-xs"> · {ENTRY_LABEL[entry.type] || "Mouvement"}</span>
                            </td>
                            <td class="num"><Money cents={entry.effectCents} currency={base} tone="auto" sign /></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </details>
          ))}
        </div>
      </Section>

      <Section title="Comment c'est calculé">
        <Card>
          <div class="stack-sm text-sm">
            <p><strong>A mis</strong> : l'argent versé à l'entreprise (apports) et les dépenses de l'entreprise payées avec son argent ou sa carte perso.</p>
            <p><strong>A déjà récupéré</strong> : les ventes arrivées sur son compte perso et les remboursements ou retraits reçus de l'entreprise.</p>
            <p><strong>Reste à récupérer</strong> : ce qu'il a mis, moins ce qu'il a déjà récupéré. Si le chiffre est négatif, c'est lui qui doit de l'argent à l'entreprise.</p>
            <p><strong>Part du bénéfice</strong> : le bénéfice (ou la perte) de chaque période, multiplié par son pourcentage sur cette période.</p>
            <p><strong>Total qui lui revient</strong> : reste à récupérer plus part du bénéfice.</p>
          </div>
        </Card>
      </Section>
    </div>
  );
}
