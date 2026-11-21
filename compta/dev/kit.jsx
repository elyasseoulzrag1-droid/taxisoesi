// Galerie du kit d'interface : chaque composant et chaque graphique, avec du contenu réaliste (montants inventés).
// Construction : node build.mjs --entry dev/kit.jsx --out dist/kit.html
import { render } from "preact";
import { useState } from "preact/hooks";
import {
  Avatar,
  Badge,
  Banner,
  BarChart,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmHost,
  DateInput,
  DateText,
  EmptyState,
  Field,
  FileDrop,
  HBarList,
  Icon,
  ICON_NAMES,
  IconButton,
  LineChart,
  List,
  ListItem,
  Menu,
  Modal,
  Money,
  MoneyInput,
  PartnerDot,
  ProgressBar,
  SearchInput,
  Section,
  Segmented,
  Select,
  Skeleton,
  Sparkline,
  Spinner,
  SplitBar,
  Stat,
  Table,
  Tabs,
  TextArea,
  TextInput,
  ToastHost,
  Toggle,
  confirmDialog,
  fmtMoney,
  fmtPct,
  moneyAxis,
  plural,
  toast,
} from "../src/ui/index.js";

const usd = (cents) => fmtMoney(cents, "USD", { round: true });
const usdAxis = moneyAxis("USD");

const PARTNERS = [
  { id: "rock", name: "Rock", role: "Fondateur", share: 40, put: 642000, back: 125000, profit: 178200 },
  { id: "sam", name: "Sam", role: "Associé", share: 40, put: 318000, back: 0, profit: 178200 },
  { id: "nora", name: "Nora", role: "Investisseuse", share: 20, put: 1500000, back: 0, profit: 89100 },
];

const MONTHS = [
  { label: "sept. 2026", salesCents: 96000, expenseCents: 178000, profitCents: -82000 },
  { label: "oct. 2026", salesCents: 1124000, expenseCents: 1000000, profitCents: 124000 },
  { label: "nov. 2026", salesCents: 1842000, expenseCents: 1396500, profitCents: 445500 },
];

const WEEKS = [
  { label: "29 sept.", meta: 42000, tiktok: 0, applovin: 0 },
  { label: "6 oct.", meta: 118000, tiktok: 36000, applovin: 0 },
  { label: "13 oct.", meta: 156000, tiktok: 61000, applovin: 0 },
  { label: "20 oct.", meta: 171000, tiktok: 74000, applovin: 22000 },
  { label: "27 oct.", meta: 164000, tiktok: 82000, applovin: 41000 },
  { label: "3 nov.", meta: 188000, tiktok: 97000, applovin: 58000 },
  { label: "10 nov.", meta: 203000, tiktok: 101000, applovin: 77000 },
  { label: "17 nov.", meta: 221000, tiktok: 118000, applovin: 94770 },
];

const CASH = [
  { label: "1er nov.", cashCents: 212000 },
  { label: "4 nov.", cashCents: 148000 },
  { label: "7 nov.", cashCents: 96000 },
  { label: "10 nov.", cashCents: -38000 },
  { label: "13 nov.", cashCents: -112000 },
  { label: "14 nov.", cashCents: 1388000 },
  { label: "17 nov.", cashCents: 1296000 },
  { label: "20 nov.", cashCents: 1412000 },
  { label: "21 nov.", cashCents: 1402500 },
];

const DAILY = [
  { label: "15 nov.", salesCents: 61200, adsCents: 41800 },
  { label: "16 nov.", salesCents: 74900, adsCents: 44200 },
  { label: "17 nov.", salesCents: 58300, adsCents: 46100 },
  { label: "18 nov.", salesCents: null, adsCents: 43900 },
  { label: "19 nov.", salesCents: 88700, adsCents: 47500 },
  { label: "20 nov.", salesCents: 96400, adsCents: 52300 },
  { label: "21 nov.", salesCents: 102800, adsCents: 49400 },
];

const GROUPS = [
  { label: "Publicité", value: 987000 },
  { label: "Production des films (outils IA et rendu vidéo)", value: 184500 },
  { label: "Plateforme et paiement", value: 96200 },
  { label: "Logiciels et abonnements", value: 61800 },
  { label: "Créateurs et prestataires", value: 45000 },
  { label: "Juridique, compta et impôts", value: 18000 },
  { label: "Banque et change", value: 4000 },
];

const OPS = [
  { id: "1", date: "2026-11-21", label: "AppLovin, campagne de Noël", category: "Pub AppLovin", account: "Carte Slash 0562", owner: 2, cents: -9477, review: true },
  { id: "2", date: "2026-11-20", label: "Virement Shopify", category: "Ventes Shopify", account: "Slash Business", owner: -1, cents: 184250 },
  { id: "3", date: "2026-11-19", label: "Meta Ads, facture de la semaine", category: "Pub Meta (Facebook, Instagram)", account: "Carte Slash 0562", owner: 2, cents: -121800 },
  { id: "4", date: "2026-11-18", label: "Klaviyo, abonnement novembre", category: "Email et SMS (Klaviyo)", account: "Revolut perso de Rock", owner: 0, cents: -4500 },
  { id: "5", date: "2026-11-17", label: "ElevenLabs, voix des films", category: "Outils IA et rendu vidéo", account: "Revolut perso de Sam", owner: 1, cents: -9900, currency: "EUR", approx: true },
  { id: "6", date: "2026-11-14", label: "Apport de Nora", category: "Mouvement entre comptes", account: "Slash Business", owner: -1, cents: 1500000, transfer: true },
];

const CATEGORY_OPTIONS = [
  { value: "ads_meta", label: "Pub Meta (Facebook, Instagram)", group: "Publicité" },
  { value: "ads_tiktok", label: "Pub TikTok", group: "Publicité" },
  { value: "ads_applovin", label: "Pub AppLovin", group: "Publicité" },
  { value: "production_ai", label: "Outils IA et rendu vidéo", group: "Production des films" },
  { value: "email_sms", label: "Email et SMS (Klaviyo)", group: "Logiciels et abonnements" },
  { value: "software", label: "Logiciels et abonnements", group: "Logiciels et abonnements" },
  { value: "other_expense", label: "Autres dépenses" },
];

const NAV = [
  { id: "accueil", label: "Accueil", icon: "home" },
  { id: "operations", label: "Opérations", icon: "list" },
  { id: "associes", label: "Associés", icon: "users" },
  { id: "ventes", label: "Ventes", icon: "store" },
  { id: "pub", label: "Pub", icon: "megaphone" },
  { id: "rapports", label: "Rapports", icon: "chart" },
  { id: "assistant", label: "Assistant", icon: "sparkles" },
  { id: "reglages", label: "Réglages", icon: "settings" },
];

function Shell({ children, theme, onTheme }) {
  const [currency, setCurrency] = useState("USD");
  const [route, setRoute] = useState("accueil");
  return (
    <div class="app">
      <header class="app-topbar">
        <div class="app-topbar-inner">
          <a class="app-brand" href="#accueil">
            <span class="app-brand-mark">
              <Icon name="ticket" size={18} />
            </span>
            <span class="app-brand-name">StarringYou</span>
          </a>
          <div class="app-topbar-tools">
            <Button size="sm" icon="calendar" iconRight="chevron-down">
              Nov. 2026
            </Button>
            <Segmented
              size="sm"
              label="Devise d'affichage"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: "USD", label: "$" },
                { value: "EUR", label: "€" },
              ]}
            />
          </div>
        </div>
      </header>
      <div class="app-body">
        <nav class="app-sidebar" aria-label="Pages">
          <Button variant="primary" icon="plus" full>
            Ajouter
          </Button>
          <p class="app-nav-label overline">Suivi</p>
          {NAV.map((item) => (
            <a class="app-nav-item" href={"#" + item.id} aria-current={route === item.id ? "page" : undefined} onClick={() => setRoute(item.id)}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.id === "operations" ? (
                <Badge tone="warn" class="app-nav-count">
                  3
                </Badge>
              ) : null}
            </a>
          ))}
          <p class="app-sidebar-foot">Lancé le 29 sept. 2026</p>
        </nav>
        <main class="app-main">
          <div class="app-status">
            <Badge tone="warn" icon="info">
              Données d'exemple
            </Badge>
            <Badge icon="lock">Mode local (cet appareil uniquement)</Badge>
          </div>
          <div class="page">
            <header class="page-head">
              <div class="page-head-text">
                <h1 class="page-title">Kit d'interface</h1>
                <p class="page-sub">Tous les composants et graphiques de Compta StarringYou, avec des montants inventés.</p>
              </div>
              <div class="page-actions">
                <Segmented
                  size="sm"
                  label="Thème"
                  value={theme}
                  onChange={onTheme}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "light", label: "Clair", icon: "sun" },
                    { value: "dark", label: "Sombre", icon: "moon" },
                  ]}
                />
              </div>
            </header>
            {children}
          </div>
        </main>
      </div>
      <nav class="app-tabbar" aria-label="Navigation">
        <a class="app-tab" href="#accueil" aria-current={route === "accueil" ? "page" : undefined} onClick={() => setRoute("accueil")}>
          <Icon name="home" size={22} />
          <span class="app-tab-label">Accueil</span>
        </a>
        <a class="app-tab" href="#operations" aria-current={route === "operations" ? "page" : undefined} onClick={() => setRoute("operations")}>
          <Icon name="list" size={22} />
          <span class="app-tab-label">Opérations</span>
        </a>
        <button type="button" class="app-tab-add" aria-label="Ajouter" onClick={() => toast("Ici s'ouvre la feuille d'ajout.")}>
          <span class="app-tab-add-disc">
            <Icon name="plus" size={24} />
          </span>
        </button>
        <a class="app-tab" href="#associes" aria-current={route === "associes" ? "page" : undefined} onClick={() => setRoute("associes")}>
          <Icon name="users" size={22} />
          <span class="app-tab-label">Associés</span>
        </a>
        <a class="app-tab" href="#plus" aria-current={route === "plus" ? "page" : undefined} onClick={() => setRoute("plus")}>
          <Icon name="menu" size={22} />
          <span class="app-tab-label">Plus</span>
        </a>
      </nav>
    </div>
  );
}

function Tickets() {
  return (
    <Section title="Tuiles de chiffres" sub="Le billet : un talon avec la période, une ligne de perforation, le chiffre.">
      <div class="grid-kpi">
        <Stat label="Ventes nettes" value={usd(1842000)} stub="Nov. 2026" tone="in" trend={{ label: "+64 %", dir: "up", good: true }} sub="vs oct." />
        <Stat label="Dépenses" value={usd(1396500)} stub="Nov. 2026" tone="out" sub="dont pub 9 870 $" />
        <Stat label="Bénéfice" value={usd(445500)} stub="Nov. 2026" tone="accent" valueTone="in" sub="marge 24 %" />
        <Stat label="Pub" value={usd(987000)} stub="Nov. 2026" sub="1,87 $ de ventes pour 1 $ de pub" />
      </div>
      <div class="grid-kpi">
        <Stat label="Trésorerie" value={usd(1402500)} icon="wallet" tone="info" sub="2 comptes de l'entreprise" trend={CASH.map((d) => d.cashCents)} />
        <Stat label="Perte" value={usd(-82000)} stub="Sept. 2026" tone="out" valueTone="out" sub="les 2 premiers jours" />
        <Stat label="À vérifier" value="3" icon="alert" tone="warn" sub="opérations importées" onClick={() => toast("Ouvre la liste des opérations à vérifier.")} />
        <Stat label="Montant très long" value={fmtMoney(-12345678, "USD")} stub="Depuis le lancement du 29 sept." sub="le chiffre rétrécit pour tenir dans le billet, le talon trop long est coupé" />
      </div>
      <Card pad="sm" flat>
        <p class="text-sm">
          Bénéfice de la période : <strong class="num">{usd(445500)}</strong>, ta part (40 %) : <strong class="num t-in">{usd(178200)}</strong>
        </p>
      </Card>
    </Section>
  );
}

function Charts() {
  return (
    <Section title="Graphiques" sub="Survole ou touche une barre pour lire ses valeurs ; la vue tableau donne les mêmes chiffres.">
      <div class="grid-2">
        <Card>
          <BarChart
            title="Bénéfice ou perte par mois"
            sub="Ventes nettes moins toutes les dépenses"
            data={MONTHS}
            series={[{ key: "profitCents", label: "Bénéfice" }]}
            colorBySign
            format={usd}
            formatAxis={usdAxis}
            xTitle="Mois"
          />
        </Card>
        <Card>
          <BarChart
            title="Ventes et dépenses par mois"
            data={MONTHS}
            series={[
              { key: "salesCents", label: "Ventes nettes", tone: "in" },
              { key: "expenseCents", label: "Dépenses", tone: "out" },
            ]}
            format={usd}
            formatAxis={usdAxis}
            xTitle="Mois"
          />
        </Card>
        <Card>
          <BarChart
            title="Pub par semaine"
            sub="Empilée par plateforme"
            mode="stacked"
            data={WEEKS}
            series={[
              { key: "meta", label: "Meta" },
              { key: "tiktok", label: "TikTok" },
              { key: "applovin", label: "AppLovin" },
            ]}
            format={usd}
            formatAxis={usdAxis}
            xTitle="Semaine du"
          />
        </Card>
        <Card>
          <LineChart
            title="Trésorerie de l'entreprise"
            sub="Solde des comptes de l'entreprise, novembre"
            data={CASH}
            series={[{ key: "cashCents", label: "Trésorerie", tone: "accent" }]}
            area
            format={usd}
            formatAxis={usdAxis}
            xTitle="Jour"
          />
        </Card>
        <Card>
          <LineChart
            title="Ventes et pub par jour"
            sub="Une journée sans vente coupe la ligne"
            data={DAILY}
            series={[
              { key: "salesCents", label: "Ventes", tone: "in" },
              { key: "adsCents", label: "Pub", tone: "out" },
            ]}
            format={usd}
            formatAxis={usdAxis}
            xTitle="Jour"
          />
        </Card>
        <Card>
          <HBarList
            title="Dépenses par groupe"
            items={GROUPS}
            format={usd}
            tone="out"
            showShare
            onSelect={(item) => toast("Ouvre les opérations : " + item.label)}
            labelTitle="Groupe"
          />
        </Card>
        <Card>
          <div class="stack">
            <SplitBar
              title="Pub par plateforme"
              segments={[
                { label: "Meta", value: 542000 },
                { label: "TikTok", value: 295000 },
                { label: "AppLovin", value: 135230 },
                { label: "Google", value: 14770 },
              ]}
              format={usd}
              labelTitle="Plateforme"
            />
            <hr class="divider" />
            <SplitBar
              title="Qui a mis quoi"
              sub="Apports et dépenses payées avec son argent"
              variant="thin"
              segments={PARTNERS.map((p) => ({ label: p.name, value: p.put }))}
              format={usd}
              labelTitle="Associé"
            />
          </div>
        </Card>
        <Card>
          <div class="stack">
            <BarChart title="Aucune donnée" data={[]} series={[{ key: "v", label: "Ventes" }]} emptyText="Aucune vente sur cette période. Importe un export Shopify pour voir ce graphique." />
            <LineChart title="Un seul point" data={[{ label: "21 nov.", v: 102800 }]} series={[{ key: "v", label: "Ventes" }]} format={usd} formatAxis={usdAxis} height={140} table={false} />
            <div class="row row-wrap gap-4">
              <span class="row">
                <Sparkline values={[3, 5, 4, 8, 7, 11, 14]} label="Ventes en hausse sur 7 jours" />
                <span class="text-sm muted">en hausse</span>
              </span>
              <span class="row">
                <Sparkline values={[9, 7, 8, 4, -2, -3, -6]} tone="out" area label="Trésorerie en baisse, passée sous zéro" />
                <span class="text-sm muted">sous zéro</span>
              </span>
              <span class="row">
                <Sparkline values={[5]} tone="in" label="Un seul point" />
                <span class="text-sm muted">un point</span>
              </span>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Buttons() {
  const [loading, setLoading] = useState(false);
  return (
    <Section title="Boutons et menus">
      <Card>
        <div class="stack">
          <div class="row row-wrap">
            <Button variant="primary" icon="plus">
              Nouvelle opération
            </Button>
            <Button icon="upload">Importer un fichier</Button>
            <Button variant="ghost" iconRight="chevron-right">
              Tout voir
            </Button>
            <Button variant="danger" icon="trash">
              Supprimer
            </Button>
          </div>
          <div class="row row-wrap">
            <Button variant="primary" size="sm">
              Enregistrer
            </Button>
            <Button size="sm" icon="download">
              Exporter (CSV)
            </Button>
            <Button size="sm" disabled>
              Mois clôturé
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1800);
              }}
            >
              Importer 12 opérations
            </Button>
            <Spinner label="Chargement" />
          </div>
          <div class="row row-wrap">
            <IconButton icon="edit" label="Modifier" />
            <IconButton icon="paperclip" label="Ajouter un justificatif" variant="secondary" />
            <IconButton icon="filter" label="Filtrer" pressed />
            <IconButton icon="refresh" label="Actualiser" size="sm" />
            <Menu
              label="Autres actions sur l'opération"
              items={[
                { label: "Dupliquer", icon: "copy", onSelect: () => toast("Opération dupliquée.", { tone: "in" }) },
                { label: "Marquer comme vérifiée", icon: "check", onSelect: () => toast("Opération vérifiée.", { tone: "in" }) },
                { label: "Voir le justificatif", icon: "eye", disabled: true },
                { separator: true },
                { label: "Supprimer", icon: "trash", danger: true, onSelect: () => toast("Opération supprimée.", { action: { label: "Annuler", onClick: () => toast("Suppression annulée.") } }) },
              ]}
            />
            <Menu
              text="Exporter"
              icon="download"
              align="start"
              items={[
                { label: "Journal (CSV)", icon: "file", hint: "214 lignes" },
                { label: "Classeur Excel", icon: "file" },
                { label: "Sauvegarde complète (JSON)", icon: "download" },
              ]}
            />
          </div>
          <Button variant="primary" full icon="check">
            Enregistrer la dépense
          </Button>
        </div>
      </Card>
    </Section>
  );
}

function Forms() {
  const [kind, setKind] = useState("out");
  const [cents, setCents] = useState(-9477);
  const [currency, setCurrency] = useState("USD");
  const [received, setReceived] = useState(184250);
  const [date, setDate] = useState("2026-11-21");
  const [label, setLabel] = useState("AppLovin, campagne de Noël");
  const [category, setCategory] = useState("ads_applovin");
  const [account, setAccount] = useState(null);
  const [review, setReview] = useState(true);
  const [split, setSplit] = useState(false);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("klaviyo");
  const [share, setShare] = useState("45");
  const [files, setFiles] = useState([]);
  return (
    <Section title="Formulaire" sub="Champs contrôlés : la valeur, puis onChange avec la nouvelle valeur.">
      <Card>
        <div class="stack">
          <Segmented
            full
            label="Type d'opération"
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (cents != null && next !== "transfer") setCents(next === "out" ? -Math.abs(cents) : Math.abs(cents));
            }}
            options={[
              { value: "out", label: "Dépense", icon: "arrow-out" },
              { value: "in", label: "Encaissement", icon: "arrow-in" },
              { value: "transfer", label: "Mouvement", icon: "swap" },
            ]}
          />
          <div class="grid-2">
            <Field label="Montant" hint={"Valeur enregistrée : " + (cents == null ? "aucune" : cents + " centimes")} required>
              <MoneyInput cents={cents} onChange={setCents} currency={currency} onCurrency={setCurrency} sign={kind === "in" ? "in" : "out"} currencies={["USD", "EUR", "GBP"]} />
            </Field>
            <Field label="Date" required>
              <DateInput value={date} onChange={setDate} max="2026-11-21" />
            </Field>
            <Field label="Libellé" required>
              <TextInput value={label} onChange={setLabel} placeholder="Ex. Klaviyo, abonnement novembre" />
            </Field>
            <Field label="Catégorie">
              <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} placeholder="Non classée" />
            </Field>
            <Field label="Payé avec" error={account ? null : "Choisis le compte ou la carte qui a payé."}>
              <Select
                value={account}
                onChange={setAccount}
                placeholder="Choisir un compte"
                options={[
                  { value: "slash", label: "Slash Business", group: "Comptes de l'entreprise" },
                  { value: "c0562", label: "Carte Slash 0562 (Nora)", group: "Comptes perso" },
                  { value: "revolut", label: "Revolut perso de Rock", group: "Comptes perso" },
                ]}
              />
            </Field>
            <Field label="Part du bénéfice" hint="Les parts des associés doivent faire 100 % au total." optional>
              <TextInput value={share} onChange={setShare} inputMode="decimal" suffix="%" />
            </Field>
            <Field label="Montant reçu sur le compte" hint="Sans choix de devise : elle suit celle du compte.">
              <MoneyInput cents={received} onChange={setReceived} currency="EUR" />
            </Field>
            <Field label="Rechercher une opération">
              <SearchInput value={search} onChange={setSearch} placeholder="Libellé, tiers, montant" />
            </Field>
          </div>
          <Field label="Note" optional>
            <TextArea value={note} onChange={setNote} placeholder="Un détail utile pour plus tard" rows={2} />
          </Field>
          <div class="row row-wrap gap-4">
            <Toggle checked={review} onChange={setReview} label="À vérifier" hint="Importée ou lue sur un reçu, pas encore confirmée" />
            <Checkbox checked={split} onChange={setSplit} label="Répartir sur plusieurs catégories" />
            <Checkbox checked={false} indeterminate onChange={() => {}} label="Sélection partielle" />
            <Checkbox checked disabled onChange={() => {}} label="Pointée (mois clôturé)" />
          </div>
          <FileDrop
            accept="image/*,application/pdf"
            multiple
            label="Ajouter un justificatif"
            hint={files.length ? plural(files.length, "fichier choisi", "fichiers choisis") : "Photo, capture d'écran ou PDF. Dépose le fichier ici ou touche pour le choisir."}
            icon="receipt"
            onFiles={(accepted, rejected) => {
              setFiles(accepted);
              if (rejected.length) toast("Ce type de fichier n'est pas accepté : envoie une image ou un PDF.", { tone: "out" });
            }}
          />
          <FileDrop compact accept=".csv,.tsv,.txt" label="Importer un relevé" hint="CSV Revolut, Slash ou Shopify" onFiles={(accepted) => toast(plural(accepted.length, "fichier reçu", "fichiers reçus"))} />
        </div>
      </Card>
    </Section>
  );
}

function Labels() {
  const [filter, setFilter] = useState("all");
  const [tags, setTags] = useState(["Compte : Slash Business", "Payé par : Nora"]);
  const filters = [
    { id: "all", label: "Tout" },
    { id: "out", label: "Dépenses", icon: "arrow-out" },
    { id: "in", label: "Encaissements", icon: "arrow-in" },
    { id: "transfer", label: "Mouvements entre comptes", icon: "swap" },
    { id: "review", label: "À vérifier (3)" },
    { id: "nocat", label: "Non classées" },
    { id: "noreceipt", label: "Sans justificatif" },
  ];
  return (
    <Section title="Étiquettes, pastilles, personnes et montants">
      <Card>
        <div class="stack">
          <div class="row row-wrap">
            <Badge>Estimé</Badge>
            <Badge tone="warn" icon="alert">
              À vérifier
            </Badge>
            <Badge tone="in" icon="check">
              Pointée
            </Badge>
            <Badge tone="out">Doublon</Badge>
            <Badge tone="info" icon="paperclip">
              Justificatif
            </Badge>
            <Badge tone="accent">Depuis le 14 nov.</Badge>
          </div>
          <div class="chip-row">
            {filters.map((f) => (
              <Chip selected={filter === f.id} icon={f.icon} onClick={() => setFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <div class="row row-wrap">
            {tags.map((tag) => (
              <Chip onRemove={() => setTags(tags.filter((t) => t !== tag))} removeLabel={"Retirer le filtre " + tag}>
                {tag}
              </Chip>
            ))}
            <Chip icon="sparkles" onClick={() => toast("Catégorie proposée appliquée.", { tone: "in" })}>
              Classer en Pub AppLovin
            </Chip>
            <Chip>Lecture seule</Chip>
          </div>
          <hr class="divider" />
          <div class="row row-wrap gap-4">
            {PARTNERS.map((p, i) => (
              <span class="row">
                <Avatar name={p.name} index={i} />
                <span class="stack stack-xs">
                  <span class="strong">{p.name}</span>
                  <span class="text-sm muted">
                    {p.role}, {fmtPct(p.share)} du bénéfice
                  </span>
                </span>
              </span>
            ))}
            <span class="row">
              <Avatar name="Slash Business" size="sm" />
              <Avatar name="Rock" index={0} size="lg" />
            </span>
          </div>
          <div class="row row-wrap gap-4 text-sm">
            {PARTNERS.map((p, i) => (
              <span class="row gap-1">
                <PartnerDot index={i} />
                <span>{"Compte perso de " + p.name}</span>
              </span>
            ))}
            <span class="row gap-1">
              <PartnerDot />
              <span>À attribuer</span>
            </span>
          </div>
          <hr class="divider" />
          <div class="row row-wrap gap-4">
            <Money cents={184250} tone="auto" sign />
            <Money cents={-9477} tone="auto" />
            <Money cents={0} tone="auto" />
            <Money cents={-9900} currency="EUR" />
            <Money cents={-10692} approx />
            <Money cents={1500000} round />
            <Money cents={9477} code />
            <Money cents={null} />
            <DateText date="2026-11-21" />
            <DateText date="2026-11-01" style="long" />
            <DateText date="2026-11-21" style="court" />
          </div>
          <div class="grid-2">
            <div class="stack stack-sm">
              <span class="text-sm muted">Clôture de novembre : 18 opérations sur 21 vérifiées</span>
              <ProgressBar value={18} max={21} label="Opérations vérifiées" showValue />
            </div>
            <div class="stack stack-sm">
              <span class="text-sm muted">Parts des associés : 100 % attribués</span>
              <ProgressBar value={100} tone="in" label="Parts attribuées" showValue />
            </div>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function Messages() {
  const [open, setOpen] = useState(false);
  const [openSmall, setOpenSmall] = useState(false);
  const [amount, setAmount] = useState(150000);
  const [label, setLabel] = useState("Apport de Nora");
  return (
    <Section title="Messages, fenêtres et attentes">
      <div class="stack">
        <Banner tone="warn" title="3 opérations à vérifier" action={<Button size="sm">Vérifier</Button>}>
          Elles viennent d'un import : confirme le montant et la catégorie.
        </Banner>
        <Banner tone="info" onClose={() => toast("Message masqué.")}>
          Les montants en euros sont convertis avec le taux du mois : ils portent le signe ≈.
        </Banner>
        <Banner tone="out" title="L'enregistrement a échoué" action={<Button size="sm">Réessayer</Button>}>
          La connexion a été coupée. Tes modifications sont gardées ici : réessaie dans un instant.
        </Banner>
        <Banner tone="in">Novembre est clôturé : plus rien ne bouge sur ce mois.</Banner>
        <Banner tone="accent" icon="users" title="Un troisième associé depuis le 14 nov.">
          Le bénéfice est partagé 40 / 40 / 20 à partir de cette date, 50 / 50 avant.
        </Banner>
        <div class="grid-2">
          <EmptyState
            icon="receipt"
            title="Aucune opération sur cette période"
            text="Les dépenses et les encaissements de novembre apparaîtront ici. Saisis-en une, ou importe un relevé Revolut, Slash ou Shopify."
            action={
              <>
                <Button variant="primary" size="sm" icon="plus">
                  Saisir une opération
                </Button>
                <Button size="sm" icon="upload">
                  Importer un fichier
                </Button>
              </>
            }
          />
          <Card>
            <div class="stack stack-sm">
              <Skeleton width="40%" height={14} />
              <Skeleton height={28} width="65%" radius={8} />
              <Skeleton lines={3} />
              <EmptyState compact icon="paperclip" title="Pas de justificatif" text="Ajoute une photo du reçu pour le retrouver plus tard." />
            </div>
          </Card>
        </div>
        <Card>
          <div class="row row-wrap">
            <Button onClick={() => setOpen(true)} id="kit-open-modal">
              Ouvrir une fenêtre
            </Button>
            <Button onClick={() => setOpenSmall(true)}>Petite fenêtre</Button>
            <Button
              id="kit-confirm"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "Supprimer cette opération ?",
                  message: "AppLovin, campagne de Noël, 94,77 $.\nTu ne pourras pas revenir en arrière.",
                  confirmLabel: "Supprimer",
                  danger: true,
                });
                toast(ok ? "Opération supprimée." : "Rien n'a été supprimé.", { tone: ok ? "in" : "info" });
              }}
            >
              Demander une confirmation
            </Button>
            <Button id="kit-toast" onClick={() => toast("Opération enregistrée.", { tone: "in" })}>
              Notification
            </Button>
            <Button onClick={() => toast("Impossible d'enregistrer : le mois d'octobre est clôturé. Rouvre le mois pour modifier cette opération.", { tone: "out" })}>
              Notification d'erreur
            </Button>
          </div>
        </Card>
      </div>
      <Modal
        open={open}
        title="Enregistrer un apport"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                toast("Apport enregistré.", { tone: "in" });
              }}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div class="stack">
          <Banner tone="info">Apport de Nora à l'entreprise : l'entreprise lui doit ce montant.</Banner>
          <Field label="Montant" required>
            <MoneyInput cents={amount} onChange={setAmount} currency="USD" sign="in" autoFocus />
          </Field>
          <Field label="Libellé">
            <TextInput value={label} onChange={setLabel} />
          </Field>
          <Field label="Du compte">
            <Select value="nora" onChange={() => {}} options={[{ value: "nora", label: "Compte perso de Nora" }]} />
          </Field>
          <Field label="Vers le compte">
            <Select value="slash" onChange={() => {}} options={[{ value: "slash", label: "Slash Business" }]} />
          </Field>
          <Field label="Date">
            <DateInput value="2026-11-14" onChange={() => {}} />
          </Field>
          <Field label="Note" optional>
            <TextArea value="" onChange={() => {}} rows={3} placeholder="Un détail utile pour plus tard" />
          </Field>
          <FileDrop compact label="Ajouter un justificatif" hint="Photo ou PDF" onFiles={() => {}} />
        </div>
      </Modal>
      <Modal open={openSmall} size="sm" title="Rouvrir novembre ?" onClose={() => setOpenSmall(false)} footer={<Button variant="primary" onClick={() => setOpenSmall(false)}>Rouvrir le mois</Button>}>
        <p class="muted">Tu pourras de nouveau modifier les opérations de novembre. Pense à clôturer le mois une fois la correction faite.</p>
      </Modal>
    </Section>
  );
}

function TabsAndTables() {
  const [tab, setTab] = useState("file");
  const columns = [
    { key: "label", label: "Opération", phone: "title" },
    { key: "date", label: "Date", render: (op) => <DateText date={op.date} style="jour" />, phone: "sub" },
    { key: "category", label: "Catégorie", phone: "sub" },
    {
      key: "account",
      label: "Compte",
      phone: "sub",
      render: (op) => (
        <span class="row gap-1">
          <PartnerDot index={op.owner < 0 ? undefined : op.owner} color={op.owner < 0 ? "var(--ink-3)" : undefined} />
          <span>{op.account}</span>
        </span>
      ),
    },
    { key: "flags", label: "État", phone: "aside", render: (op) => (op.review ? <Badge tone="warn">À vérifier</Badge> : op.transfer ? <Badge tone="info">Apport</Badge> : null) },
    { key: "cents", label: "Montant", align: "right", phone: "amount", render: (op) => <Money cents={op.cents} currency={op.currency || "USD"} tone={op.transfer ? "none" : "auto"} approx={op.approx} /> },
  ];
  const partnerColumns = [
    {
      key: "name",
      label: "Associé",
      render: (p) =>
        p.total ? (
          "Total"
        ) : (
          <span class="row">
            <Avatar name={p.name} index={p.index} size="sm" />
            <span>{p.name}</span>
          </span>
        ),
    },
    { key: "put", label: "A mis", align: "right", phoneLabel: true, render: (p) => <Money cents={p.put} round /> },
    { key: "back", label: "A déjà récupéré", align: "right", phoneLabel: true, render: (p) => <Money cents={p.back} round /> },
    { key: "left", label: "Reste à récupérer", align: "right", phoneLabel: true, render: (p) => <Money cents={p.put - p.back} round /> },
    { key: "profit", label: "Part du bénéfice", align: "right", phoneLabel: true, render: (p) => <Money cents={p.profit} round tone="auto" /> },
    { key: "all", label: "Total qui lui revient", align: "right", phone: "amount", render: (p) => <Money cents={p.put - p.back + p.profit} round /> },
  ];
  const partnerRows = PARTNERS.map((p, index) => ({ ...p, index }));
  const sum = (key) => PARTNERS.reduce((a, p) => a + p[key], 0);
  return (
    <Section title="Onglets et tableaux" action={<Button variant="ghost" size="sm" iconRight="chevron-right">Tout voir</Button>}>
      <Tabs
        label="Façons d'ajouter des opérations"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "file", label: "Fichier", icon: "upload" },
          { id: "scan", label: "Reçu ou relevé", icon: "camera", count: 2 },
          { id: "text", label: "Texte collé", icon: "text" },
        ]}
      >
        {tab === "file" ? (
          <p class="muted">Dépose un export Shopify, un relevé Revolut ou Slash, ou un export de plateforme pub.</p>
        ) : tab === "scan" ? (
          <p class="muted">Prends en photo un reçu, ou envoie le PDF d'un relevé : une opération par ligne.</p>
        ) : (
          <p class="muted">Colle le texte d'un reçu : les montants et les dates sont repérés pour toi.</p>
        )}
      </Tabs>
      <Card pad={false}>
        <Table caption="Opérations récentes" columns={columns} rows={OPS} rowKey="id" onRowClick={(op) => toast("Ouvre : " + op.label)} />
      </Card>
      <Card pad={false}>
        <Table
          caption="Combien chacun a mis et combien chacun doit récupérer"
          columns={partnerColumns}
          rows={partnerRows}
          rowKey="id"
          footer={{ total: true, put: sum("put"), back: sum("back"), profit: sum("profit") }}
        />
      </Card>
      <Card pad={false}>
        <Table
          columns={columns}
          rows={[]}
          empty={<EmptyState compact icon="search" title="Aucun résultat" text="Aucune opération ne correspond à ta recherche. Essaie un autre mot ou retire un filtre." />}
        />
      </Card>
    </Section>
  );
}

function Lists() {
  return (
    <Section title="Listes" sub="Des lignes à toucher : ce qu'il reste à faire, le menu des pages.">
      <div class="grid-2">
        <Card pad={false}>
          <List label="À faire">
            <ListItem icon="alert" tone="warn" title="3 opérations à vérifier" sub="Importées du relevé Slash du 20 nov." onClick={() => toast("Ouvre les opérations à vérifier.")} />
            <ListItem icon="tag" tone="info" title="5 opérations sans catégorie" onClick={() => toast("Ouvre les opérations non classées.")} />
            <ListItem icon="wallet" tone="accent" title="Carte 2487 à attribuer" sub="Dis à qui appartient cette carte pour savoir qui a payé." onClick={() => toast("Ouvre l'attribution des cartes.")} />
            <ListItem icon="check-circle" tone="in" title="Octobre est clôturé" trailing={<Badge tone="in">Clôturé</Badge>} />
          </List>
        </Card>
        <Card pad={false}>
          <List label="Qui a payé quoi">
            {PARTNERS.map((p, i) => (
              <ListItem lead={<Avatar name={p.name} index={i} />} title={p.name} sub={p.role} trailing={<Money cents={p.put} round />} onClick={() => toast("Ouvre le détail de " + p.name)} />
            ))}
            <ListItem lead={<Avatar name="Slash Business" />} title="L'entreprise" sub="Comptes Slash" trailing={<Money cents={742300} round />} />
          </List>
        </Card>
      </div>
    </Section>
  );
}

function Icons() {
  return (
    <Section title="Icônes" sub={plural(ICON_NAMES.length, "icône", "icônes") + ", à utiliser par leur nom."}>
      <Card>
        <ul class="kit-icons">
          {ICON_NAMES.map((name) => (
            <li>
              <Icon name={name} size={20} />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

function App() {
  const [theme, setTheme] = useState("auto");
  const applyTheme = (next) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  };
  return (
    <>
      <Shell theme={theme} onTheme={applyTheme}>
        <Tickets />
        <Charts />
        <Buttons />
        <Forms />
        <Labels />
        <Messages />
        <TabsAndTables />
        <Lists />
        <Icons />
      </Shell>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

// Quelques règles propres à la galerie (pas à l'appli) : la grille des icônes.
const style = document.createElement("style");
style.textContent =
  ".kit-icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px 8px;font-size:.8125rem;color:var(--ink-2)}" +
  ".kit-icons li{display:flex;align-items:center;gap:8px;min-width:0}.kit-icons span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".kit-icons .icon{color:var(--ink)}";
document.head.appendChild(style);

render(<App />, document.getElementById("app"));
