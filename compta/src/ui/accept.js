// Filtre de fichiers selon un attribut `accept` (logique pure, testée).

/**
 * Vrai si le fichier correspond à la liste `accept` d'un champ fichier
 * (".csv,.pdf", "image/*", "application/pdf"...). Sans `accept`, tout passe.
 * @param {{ name?: string, type?: string }} file
 * @param {string} [accept]
 */
export function matchesAccept(file, accept) {
  if (!accept) return true;
  const rules = String(accept)
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;
  const name = String((file && file.name) || "").toLowerCase();
  const type = String((file && file.type) || "").toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Sépare une liste de fichiers en acceptés et refusés. */
export function splitByAccept(files, accept) {
  const accepted = [];
  const rejected = [];
  for (const file of files || []) (matchesAccept(file, accept) ? accepted : rejected).push(file);
  return { accepted, rejected };
}
