# Outils de développement

Tout se lance depuis le dossier `compta/`.

## Vérifier un écran seul

Chaque écran se teste dans la vraie coquille de l'appli, sur une plateforme simulée
(`dev/mock-claude.js` : base de données, fichiers, export, IA en mémoire) et avec un jeu de
données réaliste (`dev/seed.js` : trois associés, ventes Shopify, pubs, apport de trésorerie).

1. Crée ta page d'essai `dev/h-<nom>.jsx` :

```jsx
import { mountHarness } from "./harness.jsx";
import Partners from "../src/views/Partners.jsx";
import OpForm from "../src/views/OpForm.jsx"; // seulement si ton écran ouvre le formulaire d'opération

mountHarness({ views: { associes: Partners }, OpForm });
```

`views` associe un nom de page (`accueil`, `operations`, `ajouter`, `associes`, `ventes`, `pub`,
`rapports`, `assistant`, `reglages`, `plus`) à un composant. Les pages absentes affichent un
écran d'attente. `Onboarding` se passe de la même façon que `OpForm`.

2. Construis-la : `node build.mjs --entry dev/h-<nom>.jsx --out dist/h-<nom>.html`

3. Ouvre-la dans Chromium et récupère les captures :

```
node dev/shot.mjs dist/h-<nom>.html --route associes --out <dossier de captures>
```

La commande affiche les erreurs de console, les exceptions et tout débordement horizontal, puis
enregistre quatre captures (téléphone 390 px et ordinateur 1280 px, thème clair et sombre).
Elle sort en erreur s'il y a un problème.

Options utiles :
- `--empty` : réglages présents mais aucune opération (pour les états vides)
- `--fresh` : base totalement vide (premier lancement)
- `--readonly` : simule un lecteur qui n'a pas le droit de modifier
- `--flow dev/flows/<nom>.mjs` : scénario exécuté avant les captures. Le module exporte
  `export async function run(page, { assert })` et pilote la page avec Playwright
  (`page.click`, `page.fill`, `page.getByRole`...). Une exception fait échouer la commande.
- `--only phone` ou `--only desktop`, `--no-dark`, `--name <préfixe>`

Dans un scénario, l'état de l'appli se lit avec `page.evaluate` : la plateforme simulée expose
`window.__mock` (voir l'en-tête de `dev/mock-claude.js`).

Si la construction échoue à cause d'un fichier qui n'est pas le tien et qui est en cours
d'écriture, attends une minute et relance : ne corrige pas le fichier d'un autre.

## Vérifier le code source

`node tools/check-source.mjs` : typographie imposée (pas de tiret cadratin) et API interdites.

## Tests

`npm test` lance les tests unitaires (`tests/unit`), `npm run test:e2e` les parcours complets
(`tests/e2e`), après `node build.mjs`.
