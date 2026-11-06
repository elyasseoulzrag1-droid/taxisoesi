# Labo EuroMillions

Générateur de grilles EuroMillions qui s'appuie sur tous les tirages depuis le 13 février 2004
et sur toutes les stratégies connues, avec un test qui montre ce que chacune vaut vraiment.

Ouvre simplement `index.html` dans un navigateur : tout est intégré, rien à installer.

## Ce que fait la page

- **Générer** : 1 à 20 grilles, avec 5 méthodes de choix (hasard pur, numéros chauds,
  en retard, champions historiques, mixte) et 4 filtres :
  - *Anti-partage* : écarte ce que la majorité des joueurs coche (dates 1 à 31, le 7,
    suites, motifs, anciens tirages) pour partager moins si tu gagnes.
  - *Couverture maximale* : les grilles se complètent (10 grilles couvrent les 50 numéros).
  - *Profil statistique* : somme, pairs/impairs, bas/hauts, dizaines et finales dans la zone
    où tombent 80 % des tirages.
  - *Jamais sortie* : exclut les combinaisons déjà tirées.
- **Statistiques** : fréquences des numéros et des étoiles, retards en cours et records,
  paires fréquentes, sommes, parité, test du khi-deux sur l'équité des tirages.
- **Vérifier une grille** : coche ta grille, la page calcule son risque de partage, son profil
  et ce qu'elle aurait gagné sur tout l'historique.
- **Les vraies probas** : les 13 rangs de gain et un test sur les 300 derniers tirages réels qui
  compare chaque stratégie au hasard pur, sans tricher (seules les données connues avant chaque
  tirage sont utilisées).

## Ce qu'il faut savoir

Chaque grille a exactement **1 chance sur 139 838 160** de gagner le jackpot. Aucune méthode
ne change ce chiffre : les tirages n'ont pas de mémoire, et le test intégré le confirme.
Les deux leviers réels sont de ne pas partager le gain (anti-partage) et de ne pas doubler
ses numéros quand on joue plusieurs grilles (couverture).

Le jeu doit rester un plaisir. Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).

## Mettre à jour les tirages

```bash
python3 build.py --update   # télécharge les nouveaux tirages et reconstruit index.html
python3 build.py            # reconstruit seulement index.html
```

`build.py` refuse toute mise à jour qui modifierait un tirage déjà connu.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | la page finale, autonome (générée, ne pas modifier à la main) |
| `src/app.html` | le code de la page (interface, calculs, graphiques) |
| `data/euromillions.csv` | les 1 995 tirages (date, 5 numéros, 2 étoiles) |
| `build.py` | met à jour les données et construit `index.html` |

## Sources des données

Archives publiques [dev-baris/lottery-archive](https://github.com/dev-baris/lottery-archive) et
[Loisirio/lottochaos-lottery-data](https://github.com/Loisirio/lottochaos-lottery-data)
(licence CC BY 4.0), comparées l'une à l'autre : 1 989 tirages en commun, aucune différence.

Outil indépendant à but informatif, sans lien avec la FDJ ni les opérateurs EuroMillions.
