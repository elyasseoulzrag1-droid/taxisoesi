// Page de développement : monte un ou plusieurs écrans dans la vraie coquille de l'appli,
// sur la plateforme simulée (dev/mock-claude.js), avec le jeu de données de démonstration.
// Options lues dans window.__harness (posées par dev/shot.mjs) :
//   seed: "full" (défaut) | "config" (réglages seuls, aucune opération) | "none" (base vide : premier lancement)
//   readOnly: true pour simuler un lecteur sans droit d'écriture
import { render } from "preact";
import { boot, startRouter } from "../src/app/boot.js";
import { setState } from "../src/app/state.js";
import Shell from "../src/views/Shell.jsx";
import { buildSeed } from "./seed.js";

export async function mountHarness({ views = {}, OpForm = null, Onboarding = null } = {}) {
  const opts = window.__harness || {};
  const seed = opts.seed || "full";
  if (opts.readOnly) setState({ forceReadOnly: true });
  startRouter();
  render(<Shell views={views} OpForm={OpForm} Onboarding={Onboarding} />, document.getElementById("app"));
  await boot({
    beforeSubscribe: async (platform) => {
      if (seed === "none") return;
      const dump = buildSeed();
      if (seed === "config") { dump.ops = []; dump.statsByMonth = {}; }
      await platform.store.importAll(dump, { replace: true });
    },
  });
}
