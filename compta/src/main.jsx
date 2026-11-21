// Point d'entrée : monte la coquille, puis branche la plateforme (base de données, fichiers, IA).
import { render } from "preact";
import { boot, startRouter } from "./app/boot.js";
import Shell from "./views/Shell.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Operations from "./views/Operations.jsx";
import OpForm from "./views/OpForm.jsx";
import Partners from "./views/Partners.jsx";
import Settings from "./views/Settings.jsx";

const views = {
  accueil: Dashboard,
  operations: Operations,
  associes: Partners,
  reglages: Settings,
};

startRouter();
render(<Shell views={views} OpForm={OpForm} />, document.getElementById("app"));
boot();
