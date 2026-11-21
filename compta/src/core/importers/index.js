// Registre des importeurs de fichiers : détection du type de fichier, puis lecture en brouillons d'opérations.
import { IMPORTERS as SHOPIFY } from "./shopify.js";
import { IMPORTERS as ADS } from "./ads.js";
import { IMPORTERS as BANK } from "./bank.js";
import { findDuplicate } from "../recon.js";

/** Tous les types de fichiers reconnus : { type, label, help, needs, detect(parsed), parse(parsed, ctx) }. */
export const IMPORT_TYPES = [...SHOPIFY, ...ADS, ...BANK];

/** Classe les types possibles pour un fichier lu, du plus probable au moins probable. */
export function detectImport(parsed) {
  return IMPORT_TYPES
    .map((imp) => {
      let confidence = 0;
      try { confidence = Number(imp.detect(parsed)) || 0; } catch { confidence = 0; }
      return { type: imp.type, label: imp.label, confidence };
    })
    .filter((c) => c.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Lit le fichier avec l'importeur choisi, puis repère les doublons avec le journal existant.
 * Un doublon certain (même identifiant externe) est décoché ; un doublon probable reste coché mais signalé.
 */
export function runImport(type, parsed, ctx) {
  const imp = IMPORT_TYPES.find((i) => i.type === type);
  if (!imp) throw new Error("Type de fichier inconnu : " + type);
  const result = imp.parse(parsed, ctx);
  const drafts = (result.drafts || []).map((draft) => {
    const out = { _selected: true, _dupOf: null, _dupExact: false, _matchOf: null, _note: "", ...draft };
    if (ctx && ctx.book && !out._matchOf) {
      const dup = findDuplicate(out, ctx.book);
      if (dup) {
        out._dupOf = dup.opId;
        out._dupExact = !!dup.exact;
        if (dup.exact) out._selected = false;
      }
    }
    return out;
  });
  return { type: imp.type, label: imp.label, stats: null, warnings: [], info: [], ...result, drafts };
}
