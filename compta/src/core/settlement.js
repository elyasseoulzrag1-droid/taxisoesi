// "Qui doit verser combien à qui" : liste courte de paiements qui remet les compteurs à zéro.
// Logique pure, testée dans tests/unit/settlement.test.mjs.

/**
 * @param {object} book livre calculé par buildBook
 * @param {{ mode?: "nets"|"all" }} [opts]
 *   "nets" : rembourser ce que chacun a avancé (on solde les comptes d'associés, sans toucher au bénéfice).
 *   "all"  : tout solder, bénéfice (ou perte) partagé compris.
 * @returns {{ payments: Array<{ from: string, to: string, cents: number }>, shortfallCents: number, cashAfterCents: number }}
 *   from / to : identifiant d'associé ou "business". shortfallCents : ce que l'entreprise n'a pas en caisse pour finir de payer.
 */
export function settlementPlan(book, { mode = "nets" } = {}) {
  const creditors = [];
  const debtors = [];
  for (const [id, position] of Object.entries(book.partners || {})) {
    if (id === "unknown") continue; // comptes non attribués : on ne peut pas dire qui paie
    const cents = mode === "all" ? position.equityCents : position.netCents;
    if (cents > 0) creditors.push({ id, cents });
    else if (cents < 0) debtors.push({ id, cents: -cents });
  }
  const bySize = (a, b) => b.cents - a.cents || (a.id < b.id ? -1 : 1);
  creditors.sort(bySize);
  debtors.sort(bySize);

  const payments = [];
  let cash = Math.max(0, book.businessCashCents || 0);

  // 1. L'entreprise rembourse d'abord avec sa trésorerie.
  for (const c of creditors) {
    const pay = Math.min(c.cents, cash);
    if (pay > 0) {
      payments.push({ from: "business", to: c.id, cents: pay });
      c.cents -= pay;
      cash -= pay;
    }
  }
  // 2. Ce qui reste dû est réglé directement par les associés qui doivent de l'argent.
  for (const c of creditors) {
    for (const d of debtors) {
      if (c.cents <= 0) break;
      const pay = Math.min(c.cents, d.cents);
      if (pay > 0) {
        payments.push({ from: d.id, to: c.id, cents: pay });
        c.cents -= pay;
        d.cents -= pay;
      }
    }
  }
  // 3. Les associés qui doivent encore quelque chose le versent à l'entreprise.
  for (const d of debtors) {
    if (d.cents > 0) {
      payments.push({ from: d.id, to: "business", cents: d.cents });
      cash += d.cents;
      d.cents = 0;
    }
  }
  const shortfallCents = creditors.reduce((sum, c) => sum + c.cents, 0);
  return { payments, shortfallCents, cashAfterCents: cash };
}
