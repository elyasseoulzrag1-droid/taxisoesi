// Logique pure du tableau empilé sur téléphone (testée dans tests/unit/ui-kit.test.mjs).

/**
 * Répartit les colonnes d'un tableau dans les emplacements d'une ligne empilée :
 * `title` (en haut à gauche), `amount` (en haut à droite), `sub` (détails) et `aside` (en bas à droite).
 * Une colonne peut choisir sa place avec `phone` ; sinon la première colonne non alignée à droite est le titre,
 * la dernière colonne alignée à droite est le montant et le reste part en détails.
 * @param {Array<{ key: string, align?: string, phone?: "title"|"amount"|"sub"|"aside"|"hide" }>} columns
 * @returns {{ title: object|null, amount: object|null, sub: object[], aside: object[] }}
 */
export function phoneSlots(columns) {
  const visible = (columns || []).filter((c) => c && c.phone !== "hide");
  const explicit = (slot) => visible.filter((c) => c.phone === slot);
  let title = explicit("title")[0] || null;
  let amount = explicit("amount")[0] || null;
  const free = visible.filter((c) => !c.phone);
  if (!title) title = free.find((c) => c.align !== "right") || free.find((c) => c !== amount) || null;
  if (!amount) {
    const rights = free.filter((c) => c !== title && c.align === "right");
    amount = rights[rights.length - 1] || null;
  }
  const aside = explicit("aside");
  const sub = visible.filter((c) => c !== title && c !== amount && c.phone !== "aside");
  return { title, amount, sub, aside };
}
