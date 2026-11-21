// Coquille de l'appli : barre du haut, navigation, états de chargement, et l'écran de la page courante.
import { useApp, setPeriod } from "../app/state.js";
import { navigate } from "../app/router.js";
import { boot } from "../app/boot.js";
import { openOpForm, closeOpForm, setBaseCurrency, removeDemoData } from "../app/actions.js";
import { listPeriods } from "../core/periods.js";
import { todayISO } from "../core/dates.js";
import { Icon, Button, Badge, Segmented, Select, Banner, EmptyState, Skeleton, ToastHost, ConfirmHost } from "../ui/index.js";

const NAV = [
  { id: "accueil", label: "Accueil", icon: "home" },
  { id: "operations", label: "Opérations", short: "Journal", icon: "list" },
  { id: "associes", label: "Associés", icon: "users" },
  { id: "ventes", label: "Ventes", icon: "store" },
  { id: "pub", label: "Pub", icon: "megaphone" },
  { id: "rapports", label: "Rapports", icon: "chart" },
  { id: "ajouter", label: "Importer", icon: "upload" },
  { id: "reglages", label: "Réglages", icon: "settings" },
];

function PeriodPicker() {
  const { periodId, config, customPeriod } = useApp((s) => ({
    periodId: s.ui.periodId,
    config: s.data.config,
    customPeriod: s.ui.customPeriod,
  }));
  const options = listPeriods(config, todayISO(), customPeriod)
    .filter((p) => p.kind !== "custom")
    .map((p) => ({ value: p.id, label: p.label }));
  const value = options.some((o) => o.value === periodId) ? periodId : "all";
  return <Select size="sm" value={value} onChange={(id) => setPeriod(id)} options={options} aria-label="Période affichée" class="shell-period" />;
}

function StatusBar() {
  const { mode, data, canWrite, phase } = useApp((s) => ({
    mode: s.platform ? s.platform.mode : null,
    data: s.data,
    canWrite: s.canWrite,
    phase: s.phase,
  }));
  if (phase !== "ready") return null;
  const items = [];
  if (!canWrite) items.push(<Badge icon="lock">Lecture seule</Badge>);
  if (mode === "local") items.push(<Badge icon="info">Mode local : données sur cet appareil uniquement</Badge>);
  if (data.stale) items.push(<Badge tone="warn" icon="alert">Hors connexion : données peut-être pas à jour</Badge>);
  if (data.config.demo) {
    items.push(
      <Badge tone="warn" icon="info">
        Données d'exemple
      </Badge>,
    );
    if (canWrite) {
      items.push(
        <Button size="sm" variant="ghost" onClick={() => removeDemoData()}>
          Effacer les exemples
        </Button>,
      );
    }
  }
  if (!items.length && !data.error) return null;
  return (
    <div class="app-status">
      {items}
      {data.error ? <Banner tone="out">{data.error.message}</Banner> : null}
    </div>
  );
}

/**
 * @param {{ views: Record<string, Function>, OpForm?: Function, Onboarding?: Function }} props
 * `views` associe un nom de page à son écran : seules les pages fournies apparaissent dans la navigation.
 */
export default function Shell({ views = {}, OpForm = null }) {
  const { phase, route, opForm, base, canWrite, todoCount } = useApp((s) => ({
    phase: s.phase,
    route: s.ui.route,
    opForm: s.ui.opForm,
    base: s.book.base,
    canWrite: s.canWrite,
    todoCount: s.book.todo.needsReview + s.book.todo.uncategorized,
  }));
  const nav = NAV.filter((item) => views[item.id]);
  const main = nav.filter((item) => ["accueil", "operations", "associes"].includes(item.id));
  const others = nav.filter((item) => !main.includes(item));
  const lastTab = others.length > 1 && views.plus ? { id: "plus", label: "Plus", icon: "menu" } : others[0];
  const View = views[route] || views.accueil;

  let content;
  if (phase === "boot") {
    content = (
      <div class="page stack" aria-busy="true">
        <Skeleton height={28} width="55%" />
        <div class="grid-kpi">
          <Skeleton height={104} />
          <Skeleton height={104} />
          <Skeleton height={104} />
          <Skeleton height={104} />
        </div>
        <Skeleton lines={5} />
      </div>
    );
  } else if (phase === "unavailable") {
    content = (
      <div class="page">
        <EmptyState
          icon="lock"
          title="Impossible d'ouvrir ta compta ici"
          text="Ouvre cette page depuis Claude, en étant connecté à ton compte, pour charger tes données."
          action={
            <Button variant="primary" icon="refresh" onClick={() => boot()}>
              Réessayer
            </Button>
          }
        />
      </div>
    );
  } else {
    content = View ? <View /> : null;
  }

  const tab = (item) => (
    <a
      class="app-tab"
      href={"#" + item.id}
      aria-current={route === item.id ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(item.id);
      }}
    >
      <Icon name={item.icon} size={22} />
      <span class="app-tab-label">{item.short || item.label}</span>
    </a>
  );

  return (
    <div class="app" data-phase={phase} data-route={route}>
      <header class="app-topbar">
        <div class="app-topbar-inner">
          <a
            class="app-brand"
            href="#accueil"
            onClick={(e) => {
              e.preventDefault();
              navigate("accueil");
            }}
          >
            <span class="app-brand-mark">
              <Icon name="ticket" size={18} />
            </span>
            <span class="app-brand-name">StarringYou</span>
          </a>
          <div class="app-topbar-tools">
            {phase === "ready" ? <PeriodPicker /> : null}
            {phase === "ready" ? (
              <Segmented
                size="sm"
                label="Devise d'affichage"
                value={base}
                disabled={!canWrite}
                onChange={(code) => setBaseCurrency(code)}
                options={[
                  { value: "USD", label: "$" },
                  { value: "EUR", label: "€" },
                ]}
              />
            ) : null}
          </div>
        </div>
      </header>
      <div class="app-body">
        <nav class="app-sidebar" aria-label="Pages">
          {canWrite ? (
            <Button variant="primary" icon="plus" full onClick={() => openOpForm({})}>
              Ajouter une opération
            </Button>
          ) : null}
          <p class="app-nav-label overline">Suivi</p>
          {nav.map((item) => (
            <a
              class="app-nav-item"
              href={"#" + item.id}
              aria-current={route === item.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.id);
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.id === "operations" && todoCount > 0 ? (
                <Badge tone="warn" class="app-nav-count">
                  {todoCount}
                </Badge>
              ) : null}
            </a>
          ))}
        </nav>
        <main class="app-main">
          <StatusBar />
          {content}
        </main>
      </div>
      <nav class="app-tabbar" aria-label="Navigation">
        {main.slice(0, 2).map(tab)}
        {canWrite ? (
          <button type="button" class="app-tab-add" aria-label="Ajouter une opération" onClick={() => openOpForm({})}>
            <span class="app-tab-add-disc">
              <Icon name="plus" size={24} />
            </span>
          </button>
        ) : null}
        {main.slice(2).map(tab)}
        {lastTab ? tab(lastTab) : null}
      </nav>
      {opForm && OpForm ? <OpForm key={opForm.initial && opForm.initial.id ? opForm.initial.id : "new"} initial={opForm.initial || {}} onClose={closeOpForm} /> : null}
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}
