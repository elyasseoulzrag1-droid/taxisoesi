// Point d'entrée : monte la coquille, puis branche la plateforme (base de données, fichiers, IA).
import { render } from "preact";
import { boot, startRouter } from "./app/boot.js";
import Shell from "./views/Shell.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Operations from "./views/Operations.jsx";
import OpForm from "./views/OpForm.jsx";
import ImportCenter from "./views/ImportCenter.jsx";
import Partners from "./views/Partners.jsx";
import Sales from "./views/Sales.jsx";
import Ads from "./views/Ads.jsx";
import Reports from "./views/Reports.jsx";
import Settings from "./views/Settings.jsx";
import Onboarding from "./views/Onboarding.jsx";
import More from "./views/More.jsx";

const views = {
  accueil: Dashboard,
  operations: Operations,
  ajouter: ImportCenter,
  associes: Partners,
  ventes: Sales,
  pub: Ads,
  rapports: Reports,
  reglages: Settings,
  plus: More,
};

startRouter();
render(<Shell views={views} OpForm={OpForm} Onboarding={Onboarding} />, document.getElementById("app"));
boot();
