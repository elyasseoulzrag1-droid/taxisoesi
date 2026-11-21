// Journal : toutes les opérations, avec recherche et filtres.
import { useState } from "preact/hooks";
import { useApp, useBook, useCanWrite, usePeriod, setUi } from "../app/state.js";
import { openOpForm } from "../app/actions.js";
import { filterOps } from "../core/ledger.js";
import { listAccounts, listPartners } from "../core/model.js";
import { Button, Card, Chip, EmptyState, SearchInput, Select, fmtMoney, plural } from "../ui/index.js";
import { OpList } from "./shared/OpRow.jsx";

const QUICK = [
  { id: "all", label: "Tout", filter: {} },
  { id: "out", label: "Dépenses", filter: { kind: "pl", sign: "out" } },
  { id: "in", label: "Encaissements", filter: { kind: "pl", sign: "in" } },
  { id: "transfer", label: "Apports et mouvements", filter: { kind: "transfer" } },
  { id: "review", label: "À vérifier", filter: { needsReview: true } },
  { id: "uncat", label: "Non classées", filter: { uncategorized: true } },
];

function quickFromFilter(f) {
  if (f.needsReview) return "review";
  if (f.uncategorized) return "uncat";
  return "all";
}

export default function Operations() {
  const book = useBook();
  const period = usePeriod();
  const canWrite = useCanWrite();
  const preset = useApp((s) => s.ui.opFilter);
  const [quick, setQuick] = useState(() => quickFromFilter(preset || {}));
  const [text, setText] = useState("");
  const [accountId, setAccountId] = useState("");
  const [payer, setPayer] = useState("");
  const { config, base } = book;

  const quickFilter = (QUICK.find((q) => q.id === quick) || QUICK[0]).filter;
  const filter = { from: period.from, to: period.to, ...quickFilter };
  if (text.trim()) filter.text = text.trim();
  if (accountId) filter.accountId = accountId;
  if (payer) filter.partnerId = payer;
  const ops = filterOps(book, filter);

  let inCents = 0;
  let outCents = 0;
  for (const op of ops) {
    if (op.kind !== "pl") continue;
    if (op.baseCents >= 0) inCents += op.baseCents;
    else outCents -= op.baseCents;
  }

  const accountOptions = [{ value: "", label: "Tous les comptes" }, ...listAccounts(config, { includeArchived: true }).map((a) => ({ value: a.id, label: a.name }))];
  const payerOptions = [
    { value: "", label: "Payé par : tout le monde" },
    { value: "business", label: "L'entreprise" },
    ...listPartners(config, { includeArchived: true }).map((p) => ({ value: p.id, label: p.name })),
    { value: "unknown", label: "À attribuer" },
  ];

  return (
    <div class="page stack-lg">
      <header class="page-head">
        <div class="page-head-text">
          <h1 class="page-title">Opérations</h1>
          <p class="page-sub">{period.label}</p>
        </div>
        {canWrite ? (
          <div class="page-actions">
            <Button variant="primary" icon="plus" onClick={() => openOpForm({})}>
              Nouvelle opération
            </Button>
          </div>
        ) : null}
      </header>

      <div class="stack">
        <SearchInput value={text} onChange={setText} placeholder="Rechercher un libellé, un montant, un fournisseur" />
        <div class="row row-wrap gap-1">
          {QUICK.map((q) => (
            <Chip
              key={q.id}
              selected={quick === q.id}
              onClick={() => {
                setQuick(q.id);
                setUi({ opFilter: {} });
              }}
            >
              {q.label}
            </Chip>
          ))}
        </div>
        <div class="grid-2">
          <Select size="sm" value={accountId} onChange={setAccountId} options={accountOptions} aria-label="Filtrer par compte" />
          <Select size="sm" value={payer} onChange={setPayer} options={payerOptions} aria-label="Filtrer par payeur" />
        </div>
      </div>

      {ops.length ? (
        <>
          <p class="ops-totals muted text-sm">
            {plural(ops.length, "opération", "opérations")} · entrées <strong class="num t-in">{fmtMoney(inCents, base)}</strong> · sorties{" "}
            <strong class="num t-out">{fmtMoney(outCents, base)}</strong> · net <strong class="num">{fmtMoney(inCents - outCents, base, { sign: true })}</strong>
          </p>
          <Card pad={false}>
            <OpList ops={ops} config={config} base={base} onOpen={canWrite ? (op) => openOpForm(op) : undefined} />
          </Card>
        </>
      ) : (
        <EmptyState
          icon="list"
          title={book.ops.length ? "Aucune opération ne correspond" : "Aucune opération pour l'instant"}
          text={book.ops.length ? "Change la période en haut de l'écran ou retire un filtre." : "Chaque dépense, chaque virement Shopify et chaque apport d'un associé apparaîtra ici."}
          action={
            canWrite ? (
              <Button variant="primary" icon="plus" onClick={() => openOpForm({})}>
                Ajouter une opération
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}
