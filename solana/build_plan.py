#!/usr/bin/env python3
"""Intègre la recherche documentaire (recherche.json) dans plan.html.

Usage :
    python3 solana/build_plan.py

plan.html reste un fichier autonome : la recherche y est copiée entre les repères
/*RESEARCH*/ et /*END*/, pour que la page s'ouvre sans serveur.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "recherche.json"
PAGE = HERE / "plan.html"
TAGS = {
    "Marché crypto global", "Bitcoin", "Macro et taux", "Régulation",
    "Panne ou congestion du réseau", "Faillite ou scandale", "Ventes d'un gros détenteur",
    "Mèmecoins", "NFT et applis", "DeFi", "Investisseurs institutionnels et ETF",
    "Mise à jour technique", "Liquidations en cascade", "Géopolitique",
    "Écosystème et adoption", "Levée de fonds",
}


def check(data: dict) -> None:
    for e in data["events"]:
        for key in ("start", "end", "kind", "from", "to", "title", "explain", "tags", "scope", "sources"):
            if key not in e:
                sys.exit(f"Événement incomplet ({key}) : {e.get('title')}")
        if e["kind"] not in ("hausse", "baisse"):
            sys.exit(f"Type inconnu : {e['kind']}")
        unknown = set(e["tags"]) - TAGS
        if unknown:
            sys.exit(f"Étiquettes inconnues {unknown} : {e['title']}")
    text = json.dumps(data, ensure_ascii=False)
    if "\u2014" in text:
        sys.exit("Tiret cadratin trouvé dans la recherche")


def main() -> None:
    data = json.loads(DATA.read_text())
    check(data)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = PAGE.read_text()
    new, n = re.subn(r"/\*RESEARCH\*/.*?/\*END\*/", lambda _: f"/*RESEARCH*/{blob}/*END*/", page, flags=re.S)
    if n != 1:
        sys.exit("Repères /*RESEARCH*/ ... /*END*/ introuvables dans plan.html")
    PAGE.write_text(new)
    print(f"plan.html : {len(data['events'])} mouvements expliqués, "
          f"{len(data.get('future', {}).get('upcoming', []))} événements à venir.")


if __name__ == "__main__":
    main()
