// Accueil : où en est l'entreprise, en un coup d'oeil.
import { useBook, useCanWrite, usePeriod } from "../app/state.js";
import { navigate } from "../app/router.js";
import { openOpForm } from "../app/actions.js";
import { summarize } from "../core/ledger.js";
import { listPartners, groupLabel } from "../core/model.js";
import { Button, Card, Section, Stat, EmptyState, List, ListItem, Avatar, HBarList, fmtMoney, fmtRatio, fmtPct, plural } from "../ui/index.js";
import { OpRow } from "./shared/OpRow.jsx";

function todoItems(book) {
  const t = book.todo;
  const items = [];
  if (t.unknownOwnerAccountIds.length) {
    items.push({
      icon: "user-plus",
      title: `${plural(t.unknownOwnerAccountIds.length, "compte", "comptes")} à attribuer`,
      sub: "Dis à qui appartient chaque compte ou carte : sans ça, le calcul des associés est incomplet.",
      go: () => navigate("reglages"),
    });
  }
  if (book.checks.shareProblems.length) {
    items.push({
      icon: "percent",
      title: "Partage du bénéfice à corriger",
      sub: "Les pourcentages d'une période ne font pas 100.",
      go: () => navigate("reglages"),
    });
  }
  if (t.needsReview) {
    items.push({
      icon: "eye",
      title: `${plural(t.needsReview, "opération", "opérations")} à vérifier`,
      sub: "Importées ou lues automatiquement : confirme le montant et la catégorie.",
      go: () => navigate("operations", { opFilter: { needsReview: true } }),
    });
  }
  if (t.uncategorized) {
    items.push({
      icon: "tag",
      title: `${plural(t.uncategorized, "opération", "opérations")} sans catégorie`,
      sub: "Classe-les pour que les dépenses par poste soient justes.",
      go: () => navigate("operations", { opFilter: { uncategorized: true } }),
    });
  }
  return items;
}

export default function Dashboard() {
  const book = useBook();
  const period = usePeriod();
  const canWrite = useCanWrite();
  const { config, base } = book;
  const s = summarize(book, period);
  const partners = listPartners(config);
  const todo = todoItems(book);

  if (!book.ops.length) {
    return (
      <div class="page stack-lg">
        <header class="page-head">
          <div class="page-head-text">
            <h1 class="page-title">Le box-office de {config.business.name}</h1>
            <p class="page-sub">Ventes, dépenses, bénéfice, et ce que chaque associé a mis et doit récupérer.</p>
          </div>
        </header>
        {todo.length ? <TodoCard items={todo} /> : null}
        <EmptyState
          icon="ticket"
          title="Aucune opération pour l'instant"
          text="Ajoute tes dépenses, tes virements Shopify et les apports de chaque associé : les chiffres et le partage se calculent tout seuls."
          action={
            canWrite ? (
              <Button variant="primary" icon="plus" onClick={() => openOpForm({})}>
                Ajouter une opération
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  const groups = Object.entries(s.byGroup)
    .filter(([id, cents]) => id !== "sales" && cents < 0)
    .map(([id, cents]) => ({ label: groupLabel(id), value: -cents }))
    .sort((a, b) => b.value - a.value);

  return (
    <div class="page stack-lg">
      <header class="page-head">
        <div class="page-head-text">
          <h1 class="page-title">Le box-office de {config.business.name}</h1>
          <p class="page-sub">{period.label}</p>
        </div>
      </header>

      {todo.length ? <TodoCard items={todo} /> : null}

      <div class="grid-kpi">
        <Stat label="Ventes nettes" value={fmtMoney(s.salesCents, base, { round: true })} sub={s.refundsCents ? `dont ${fmtMoney(s.refundsCents, base, { round: true })} remboursés` : "après remboursements"} icon="store" tone="in" />
        <Stat label="Dépenses" value={fmtMoney(s.expenseCents, base, { round: true })} sub={`dont pub ${fmtMoney(s.adSpendCents, base, { round: true })}`} icon="arrow-out" tone="out" />
        <Stat
          label={s.profitCents < 0 ? "Perte" : "Bénéfice"}
          value={fmtMoney(s.profitCents, base, { round: true })}
          valueTone={s.profitCents < 0 ? "out" : "in"}
          sub={s.marginPct != null ? `marge ${fmtPct(s.marginPct)}` : "ventes moins dépenses"}
          icon="coins"
          tone="accent"
        />
        <Stat
          label="Pub"
          value={fmtMoney(s.adSpendCents, base, { round: true })}
          sub={s.merRatio != null ? `${fmtRatio(s.merRatio)} de ventes pour 1 de pub` : "aucune dépense pub"}
          icon="megaphone"
          tone="info"
        />
      </div>

      <Section title="Associés" sub="Depuis le début, toutes périodes confondues" action={<Button size="sm" variant="ghost" iconRight="chevron-right" onClick={() => navigate("associes")}>Le détail</Button>}>
        <Card pad={false}>
          <List label="Soldes des associés">
            <ListItem
              icon="bank"
              tone="accent"
              title="Trésorerie de l'entreprise"
              sub="Somme des comptes de l'entreprise"
              trailing={<strong class="num">{fmtMoney(book.businessCashCents, base, { approx: book.businessCashApprox })}</strong>}
            />
            {partners.map((p, i) => {
              const pos = book.partners[p.id];
              if (!pos) return null;
              const put = pos.contributedCents + pos.advancedCents + Math.max(0, -pos.settledCents);
              return (
                <ListItem
                  key={p.id}
                  lead={<Avatar name={p.name} index={i} size="sm" />}
                  title={p.name}
                  sub={`A mis ${fmtMoney(put, base, { round: true })} · reste à récupérer ${fmtMoney(pos.netCents, base, { round: true })}`}
                  trailing={
                    <span class="dash-equity">
                      <strong class="num">{fmtMoney(pos.equityCents, base, { round: true })}</strong>
                      <span class="subtle text-xs">lui revient</span>
                    </span>
                  }
                  onClick={() => navigate("associes")}
                />
              );
            })}
          </List>
        </Card>
      </Section>

      {groups.length ? (
        <Section title="Où part l'argent" sub={period.label}>
          <Card>
            <HBarList items={groups} format={(v) => fmtMoney(v, base, { round: true })} />
          </Card>
        </Section>
      ) : null}

      <Section title="Dernières opérations" action={<Button size="sm" variant="ghost" iconRight="chevron-right" onClick={() => navigate("operations")}>Tout voir</Button>}>
        <Card pad={false}>
          <div class="oplist-rows">
            {book.ops.slice(0, 6).map((op) => (
              <OpRow key={op.id} op={op} config={config} base={base} onOpen={canWrite ? (o) => openOpForm(o) : undefined} />
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}

function TodoCard({ items }) {
  return (
    <Section title="À faire">
      <Card pad={false}>
        <List label="À faire">
          {items.map((item) => (
            <ListItem key={item.title} icon={item.icon} tone="warn" title={item.title} sub={item.sub} onClick={item.go} />
          ))}
        </List>
      </Card>
    </Section>
  );
}
