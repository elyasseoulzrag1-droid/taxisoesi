// Jeu de données de démonstration pour le développement et les tests (personnes et montants inventés).
// Scénario : lancement le 29 septembre 2026 à deux associés (50/50), un troisième arrive le 14 novembre
// avec un apport de trésorerie (40/40/20). Renvoie une sauvegarde au format de store.exportAll().

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const SEED_IDS = {
  rock: "pa_rock",
  sam: "pa_sam",
  nora: "pa_nora",
  rockRevolut: "ac_rock_revolut",
  samCard: "ac_sam_card",
  noraPerso: "ac_nora_perso",
  slash: "ac_slash",
  unknownCard: "ac_card_9031",
};

export function buildSeed({ demo = false, today = "2026-11-21" } = {}) {
  const rnd = prng(20260929);
  const ID = SEED_IDS;
  const config = {
    v: 1,
    onboarded: true,
    demo,
    business: {
      name: "StarringYou",
      baseCurrency: "USD",
      startDate: "2026-09-29",
      pivotDate: "2026-11-14",
      pivotLabel: "Arrivée du 3e associé",
      vat: false,
    },
    partners: {
      [ID.rock]: { id: ID.rock, name: "Rock", role: "founder", joinedOn: "2026-09-29", order: 0, archived: false },
      [ID.sam]: { id: ID.sam, name: "Sam", role: "partner", joinedOn: "2026-09-29", order: 1, archived: false },
      [ID.nora]: { id: ID.nora, name: "Nora", role: "investor", joinedOn: "2026-11-14", order: 2, archived: false },
    },
    shareRules: {
      sr_debut: { id: "sr_debut", from: null, shares: { [ID.rock]: 50, [ID.sam]: 50 } },
      sr_trois: { id: "sr_trois", from: "2026-11-14", shares: { [ID.rock]: 40, [ID.sam]: 40, [ID.nora]: 20 } },
    },
    accounts: {
      [ID.rockRevolut]: { id: ID.rockRevolut, name: "Revolut perso de Rock", kind: "bank", owner: ID.rock, currency: "EUR", cards: ["2487"], openingCents: 0, order: 0, archived: false },
      [ID.samCard]: { id: ID.samCard, name: "Carte de Sam", kind: "card", owner: ID.sam, currency: "USD", cards: ["0562"], openingCents: 0, order: 1, archived: false },
      [ID.noraPerso]: { id: ID.noraPerso, name: "Compte perso de Nora", kind: "bank", owner: ID.nora, currency: "USD", cards: [], openingCents: 0, order: 2, archived: false },
      [ID.slash]: { id: ID.slash, name: "Slash StarringYou", kind: "bank", owner: "business", currency: "USD", cards: ["4410", "4428"], openingCents: 0, order: 3, archived: false },
      [ID.unknownCard]: { id: ID.unknownCard, name: "Carte 9031", kind: "card", owner: "unknown", currency: "USD", cards: ["9031"], openingCents: 0, order: 4, archived: false },
    },
    rules: {
      ru_klaviyo: { id: "ru_klaviyo", contains: "klaviyo", categoryId: "email_sms", accountId: null, order: 0, enabled: true },
    },
    recurring: {
      re_shopify: { id: "re_shopify", label: "Abonnement Shopify", amountCents: -3900, currency: "USD", categoryId: "shopify_sub", accountId: ID.slash, day: 29, start: "2026-09", end: null, active: true },
    },
    fx: {},
    closed: {},
  };

  const ops = [];
  let n = 0;
  const push = (op) => {
    n += 1;
    const id = "op_seed" + String(n).padStart(4, "0");
    const stamped = { id, createdAt: op.date + "T12:00:00.000Z", ...op };
    if (demo) stamped.demo = true;
    ops.push(stamped);
  };
  const cents = (min, max) => Math.round((min + rnd() * (max - min)) * 100);

  const start = "2026-09-29";
  const pivot = "2026-11-14";
  const statsByMonth = {};
  const stat = (date) => {
    const month = date.slice(0, 7);
    if (!statsByMonth[month]) statsByMonth[month] = { v: 1, month, shopify: { days: {} }, ads: { meta: { days: {} }, tiktok: { days: {} }, applovin: { days: {} } } };
    return statsByMonth[month];
  };

  let pendingSales = 0;
  let pendingRefunds = 0;
  let pendingFees = 0;
  let payoutNo = 0;

  for (let day = 0; ; day++) {
    const date = addDays(start, day);
    if (date > today) break;
    const afterPivot = date >= pivot;
    const dd = date.slice(8, 10);
    const ramp = Math.min(1, 0.25 + day / 40);

    // Ventes du jour (statistiques de commandes) et cumul pour le prochain virement.
    const orders = Math.max(0, Math.round((3 + rnd() * 9) * ramp * (afterPivot ? 1.6 : 1)));
    const gross = orders * 3900 + Math.round(rnd() * orders * 900);
    const refunds = rnd() < 0.12 && orders > 0 ? 3900 : 0;
    const fees = Math.round(gross * 0.029) + orders * 30;
    stat(date).shopify.days[dd] = { orders, grossCents: gross, discountsCents: 0, refundsCents: refunds, shippingCents: 0, taxCents: 0, netCents: gross - refunds, totalCents: gross - refunds, currency: "USD" };
    pendingSales += gross; pendingRefunds += refunds; pendingFees += fees;

    // Un virement Shopify tous les trois jours : sur le Revolut perso de Rock avant le 14 novembre, sur Slash ensuite.
    if (day % 3 === 2 && pendingSales > 0) {
      payoutNo += 1;
      const net = pendingSales - pendingRefunds - pendingFees;
      const op = {
        kind: "pl", date, label: "Virement Shopify du " + date.slice(8, 10) + "/" + date.slice(5, 7),
        accountId: afterPivot ? ID.slash : ID.rockRevolut,
        amountCents: net, currency: "USD", party: "Shopify", source: "shopify",
        extId: "shopify_payout:seed" + payoutNo,
        splits: [
          { categoryId: "sales_shopify", amountCents: pendingSales },
          { categoryId: "fees_payment", amountCents: -pendingFees },
        ],
        meta: { payoutId: "seed" + payoutNo, status: "paid", grossCents: pendingSales, refundsCents: pendingRefunds, feesCents: pendingFees, adjustmentsCents: 0 },
      };
      if (pendingRefunds) op.splits.push({ categoryId: "refunds", amountCents: -pendingRefunds });
      if (!afterPivot) op.settledCents = Math.round(net / 1.16);
      if (rnd() < 0.7) op.reconciled = true;
      push(op);
      pendingSales = 0; pendingRefunds = 0; pendingFees = 0;
    }

    // Pub : Meta et TikTok dès le début (cartes perso), AppLovin à partir de novembre ; après le 14 novembre, cartes Slash.
    const meta = cents(40, 160) * (afterPivot ? 2 : 1);
    stat(date).ads.meta.days[dd] = { spendCents: meta, currency: "USD", impressions: Math.round(meta * 1.4), clicks: Math.round(meta / 55), purchases: Math.round(orders * 0.6), purchaseValueCents: Math.round(gross * 0.6) };
    if (day % 2 === 0) {
      push({ kind: "pl", date, label: "Meta Ads, prélèvement", accountId: afterPivot ? ID.slash : ID.rockRevolut, amountCents: -meta * 2, currency: "USD", categoryId: "ads_meta", party: "Meta", card: afterPivot ? "4410" : "2487", ref: "FB" + (700000 + n), source: "meta", extId: "meta_txn:seed" + day, ...(afterPivot ? {} : { settledCents: -Math.round((meta * 2) / 1.16) }) });
    }
    const tiktok = cents(20, 90);
    stat(date).ads.tiktok.days[dd] = { spendCents: tiktok, currency: "USD", impressions: tiktok * 2, clicks: Math.round(tiktok / 40), purchases: Math.round(orders * 0.25), purchaseValueCents: Math.round(gross * 0.25) };
    if (day % 4 === 1) {
      push({ kind: "pl", date, label: "TikTok Ads, facture", accountId: afterPivot ? ID.slash : ID.samCard, amountCents: -tiktok * 4, currency: "USD", categoryId: "ads_tiktok", party: "TikTok", card: afterPivot ? "4428" : "0562", source: "tiktok", needsReview: rnd() < 0.2 });
    }
    if (date >= "2026-11-01") {
      const applovin = cents(60, 130);
      stat(date).ads.applovin.days[dd] = { spendCents: applovin, currency: "USD", impressions: applovin * 3, clicks: Math.round(applovin / 30), purchases: Math.round(orders * 0.15), purchaseValueCents: Math.round(gross * 0.15) };
      push({ kind: "pl", date, label: "Applovin Corporation, reçu", accountId: afterPivot ? ID.unknownCard : ID.samCard, amountCents: -applovin, currency: "USD", categoryId: "ads_applovin", party: "Applovin Corporation", card: afterPivot ? "9031" : "0562", ref: "1" + (100 + n) + "-" + (9000 + day), source: "scan", needsReview: true });
    }
  }

  // Outils et prestataires.
  push({ kind: "pl", date: "2026-09-29", label: "Abonnement Shopify", accountId: ID.rockRevolut, amountCents: -3900, currency: "USD", settledCents: -3362, categoryId: "shopify_sub", party: "Shopify", card: "2487", source: "manual" });
  push({ kind: "pl", date: "2026-09-30", label: "Klaviyo, premier mois", accountId: ID.rockRevolut, amountCents: -100, currency: "USD", categoryId: "email_sms", party: "Klaviyo Inc", card: "2487", ref: "2648-3340-7176", source: "scan" });
  push({ kind: "pl", date: "2026-10-03", label: "Outils IA, rendu des films", accountId: ID.samCard, amountCents: -9900, currency: "USD", categoryId: "production_ai", party: "Runway", card: "0562", source: "manual" });
  push({ kind: "pl", date: "2026-10-12", label: "Créatrice UGC, 3 vidéos", accountId: ID.rockRevolut, amountCents: -24000, currency: "EUR", categoryId: "creators", party: "Créatrice UGC", source: "manual", note: "Payée par virement" });
  push({ kind: "pl", date: "2026-10-29", label: "Abonnement Shopify", accountId: ID.rockRevolut, amountCents: -3900, currency: "USD", categoryId: "shopify_sub", party: "Shopify", card: "2487", source: "recurring", estimated: true });
  push({ kind: "pl", date: "2026-10-30", label: "Klaviyo", accountId: ID.samCard, amountCents: -2000, currency: "USD", categoryId: "email_sms", party: "Klaviyo Inc", card: "0562", source: "scan" });
  push({ kind: "pl", date: "2026-11-05", label: "Paiement inconnu", accountId: ID.samCard, amountCents: -4550, currency: "USD", party: "PADDLE.NET", card: "0562", source: "bank", needsReview: true });
  push({ kind: "pl", date: "2026-11-16", label: "Outils IA, rendu des films", accountId: ID.slash, amountCents: -14900, currency: "USD", categoryId: "production_ai", party: "Runway", card: "4410", source: "manual" });

  // Mouvements entre comptes : apport du troisième associé, remboursement, règlement entre associés.
  push({ kind: "transfer", date: "2026-11-14", label: "Apport de trésorerie de Nora", fromAccountId: ID.noraPerso, toAccountId: ID.slash, amountCents: 500000, currency: "USD", source: "manual", reconciled: true });
  push({ kind: "transfer", date: "2026-11-18", label: "Remboursement partiel à Sam", fromAccountId: ID.slash, toAccountId: ID.samCard, amountCents: 60000, currency: "USD", source: "manual" });
  push({ kind: "transfer", date: "2026-11-10", label: "Rock rembourse Sam", fromAccountId: ID.rockRevolut, toAccountId: ID.samCard, amountCents: 20000, currency: "EUR", toAmountCents: 23200, source: "manual" });

  return {
    format: "starringyou-compta",
    version: 1,
    exportedAt: today + "T00:00:00.000Z",
    config,
    ops,
    statsByMonth,
  };
}
