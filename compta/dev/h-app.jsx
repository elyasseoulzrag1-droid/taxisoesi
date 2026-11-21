// Page d'essai : l'appli complète sur la plateforme simulée, avec le jeu de données de démonstration.
import { mountHarness } from "./harness.jsx";
import Dashboard from "../src/views/Dashboard.jsx";
import Operations from "../src/views/Operations.jsx";
import OpForm from "../src/views/OpForm.jsx";
import Partners from "../src/views/Partners.jsx";
import Settings from "../src/views/Settings.jsx";

mountHarness({ views: { accueil: Dashboard, operations: Operations, associes: Partners, reglages: Settings }, OpForm });
