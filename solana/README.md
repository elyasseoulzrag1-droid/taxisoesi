# Radar Solana

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

## Sources

| Donnée | Source |
|---|---|
| Prix, bougies, échanges | Binance, API publique de données de marché (`data-api.binance.vision`, repli sur `api.binance.com`). Paire SOL/USDT, et SOL/BUSD avant le 11 août 2020. |
| Conversion en euros | Paire EUR/USDT de Binance, au cours de chaque bougie |
| Capitalisation, offre | CoinGecko |
| Réseau | Nœuds RPC publics (`solana-rpc.publicnode.com`, repli sur `api.mainnet-beta.solana.com`) |
| Graphiques | TradingView Lightweight Charts 5.0.9 |

Si le flux en direct (WebSocket) est bloqué, la page passe en **mode secours** : elle interroge
Binance chaque seconde et le prix continue d'avancer. Seul le flux des échanges est alors suspendu.

Outil d'information, pas un conseil en investissement.
