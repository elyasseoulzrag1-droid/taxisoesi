# Radar Solana et Plan Solana

Deux pages autonomes, à ouvrir dans un navigateur :

- `index.html` (**Radar**) : le cours en direct, l'historique, les échanges et le réseau.
- `plan.html` (**Plan**) : ton plan d'investissement, le thermomètre d'achat, les alertes et l'explication
  de chaque grande hausse et baisse depuis 2020. Fond noir, couleurs de Solana.

## Installer l'appli sur l'écran d'accueil

Une appli web s'installe depuis une adresse en HTTPS. Le plus simple est GitHub Pages (gratuit) :

1. Sur GitHub, ouvre **Settings**, puis **Pages** :
   https://github.com/elyasseoulzrag1-droid/taxisoesi/settings/pages
2. Dans « Build and deployment », choisis **Deploy from a branch**, la branche
   `claude/solana-tracking-app-xrv4x8` et le dossier **/ (root)**, puis **Save**.
3. Une à deux minutes plus tard, l'appli est en ligne :
   https://elyasseoulzrag1-droid.github.io/taxisoesi/solana/plan.html

Ouvre cette adresse sur ton téléphone :

- **iPhone** (Safari) : bouton Partager, puis « Sur l'écran d'accueil ».
- **Android** (Chrome) : bouton « Installer » dans la page, ou menu ⋮ puis « Ajouter à l'écran d'accueil ».

L'appli s'ouvre alors en plein écran avec son icône (`manifest.json`, icônes dans `icons/`), garde une
copie pour s'ouvrir sans réseau (`sw.js`) et envoie les alertes en notification tant qu'elle est ouverte.

## Radar

Tableau de bord pour suivre Solana (SOL) en direct : le prix qui bouge chaque seconde, tout
l'historique depuis la première cotation (10 avril 2020), les échanges en cours et l'activité du réseau.

Ouvre simplement `index.html` dans un navigateur (double-clic) : rien à installer, pas de clé d'API.
Une connexion internet est nécessaire, toutes les données arrivent en direct.

## Ce que montre la page

- **Prix en direct** : mis à jour chaque seconde, variation sur 24 h, plus haut, plus bas, volume
  et capitalisation. Bascule **$ / €** en haut à droite.
- **Graphique** avec 8 périodes :

  | Bouton | Période | Une bougie = |
  |---|---|---|
  | Direct | 16 dernières minutes | 1 seconde |
  | 1 H | 1 heure | 1 minute |
  | 24 H | 24 heures | 5 minutes |
  | 7 J | 7 jours | 15 minutes |
  | 1 M | 30 jours | 1 heure |
  | 3 M | 90 jours | 4 heures |
  | 1 A | 1 an | 1 jour |
  | Tout | depuis le 10 avril 2020 | 1 jour |

  La dernière bougie avance chaque seconde, quelle que soit la période. Affichage en courbe ou en
  bougies, échelle logarithmique (activée d'office sur « Tout »), zoom à la molette ou au pincement,
  lecture des valeurs au survol et tableau des 30 dernières bougies.
- **Performance** : variation sur 1 h, 24 h, 7 j, 30 j, 90 j, 1 an et depuis la première cotation,
  plus haut et plus bas historiques.
- **Échanges en direct** : chaque ordre exécuté sur SOL/USDT, filtre des gros ordres
  (≥ 10 k ou ≥ 100 k) et part des achats et des ventes sur la dernière minute.
- **Réseau Solana** : slot et bloc en cours, transactions par seconde, total des transactions depuis
  le lancement, avancement de l'époque, validateurs actifs, offre en circulation, inflation, et la
  courbe des transactions par seconde sur 12 heures.

Les choix (devise, période, type de graphique, filtre) sont mémorisés dans le navigateur.

## Plan

- **Thermomètre d'achat** (0 à 100) en 5 zones : très bas, bas, neutre, haut, très haut. Il combine
  l'écart du prix à sa moyenne des 200 derniers jours comparé à toute l'histoire de SOL (40 %), le RSI
  sur 14 jours (20 %), la place du prix dans son année (20 %) et l'indice peur et avidité (20 %).
  Le calcul n'utilise que les données connues à chaque date, sans regarder le futur.
- **Pourquoi ça bouge** : comparaison en direct avec le Bitcoin et l'Ethereum (mouvement de tout le
  marché ou propre à Solana), sentiment du marché, état du réseau, dernières actualités, et la
  situation de fond issue de la recherche.
- **Alertes** : changement de zone, forte variation sur 24 h (avec la cause probable), seuils de prix
  en euros, jour d'achat du plan. Dans la page, en notification du navigateur et en son. Elles
  fonctionnent tant que la page est ouverte.
- **Mon plan** : date de début (septembre 2027 par défaut), 24, 30 ou 36 achats, montant de base,
  jour du mois, multiplicateurs par zone (×2, ×1,5, ×1, ×0,5, pause), prises de bénéfices en option,
  calendrier et suivi des achats réels (prix moyen, gain), avec sauvegarde.
- **Simulation** : le plan rejoué sur les vrais prix en euros, pour n'importe quel mois de départ
  depuis 2021, comparé à l'achat fixe et à l'achat en une fois, plus un bilan sur toutes les dates de
  départ possibles.
- **Histoire** : 37 grands mouvements de 2020 à novembre 2026, chacun expliqué avec ses sources,
  placés sur le graphique, le classement des causes qui reviennent et les pannes du réseau.
- **D'ici 2030** : les événements connus pendant le plan (Fed, halving du Bitcoin en 2028, élection
  américaine, baisse de l'inflation du SOL...), le cycle de 4 ans, l'offre de SOL et l'avis
  d'analystes.

La recherche est dans `recherche.json` (avec toutes les sources). Après l'avoir modifiée :

```bash
python3 solana/build_plan.py   # recopie la recherche dans plan.html
```

Réglages, achats notés et alertes restent dans le navigateur (bouton de sauvegarde pour les transférer).

## Sources

| Donnée | Source |
|---|---|
| Prix, bougies, échanges | Binance, API publique de données de marché (`data-api.binance.vision`, repli sur `api.binance.com`). Paire SOL/USDT, et SOL/BUSD avant le 11 août 2020. |
| Conversion en euros | Paire EUR/USDT de Binance, au cours de chaque bougie |
| Capitalisation, offre | CoinGecko |
| Réseau | Nœuds RPC publics (`solana-rpc.publicnode.com`, repli sur `api.mainnet-beta.solana.com`) |
| Sentiment (Plan) | Indice Fear & Greed d'alternative.me |
| Actualités (Plan) | Google Actualités et Cointelegraph, via rss2json (relais allorigins en secours) |
| Incidents réseau (Plan) | status.solana.com |
| Graphiques | TradingView Lightweight Charts 5.0.9 |

Si le flux en direct (WebSocket) est bloqué, la page passe en **mode secours** : elle interroge
Binance chaque seconde et le prix continue d'avancer. Seul le flux des échanges est alors suspendu.

Outil d'information, pas un conseil en investissement.
