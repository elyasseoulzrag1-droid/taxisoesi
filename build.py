#!/usr/bin/env python3
"""Construit le Labo EuroMillions.

Usage :
    python3 build.py                 # reconstruit index.html depuis data/euromillions.csv
    python3 build.py --update        # télécharge d'abord les derniers tirages, puis reconstruit
    python3 build.py --fragment OUT  # écrit aussi la version "fragment" (sans <html>/<head>)

Le fichier index.html produit est autonome : toutes les données sont intégrées,
il s'ouvre directement dans un navigateur, sans serveur ni connexion.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "euromillions.csv"
TEMPLATE = ROOT / "src" / "app.html"
OUTPUT = ROOT / "index.html"
PLACEHOLDER = '/*__DRAWS__*/""'
SOURCE_URL = (
    "https://raw.githubusercontent.com/dev-baris/lottery-archive/main/"
    "eu/euromillions/results.csv"
)
HEADER = ["date", "n1", "n2", "n3", "n4", "n5", "s1", "s2"]


def parse(text: str) -> list[dict]:
    """Lit un CSV date,n1..n5,s1,s2 et valide chaque tirage."""
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        n = sorted(int(r[f"n{i}"]) for i in range(1, 6))
        s = sorted(int(r[f"s{i}"]) for i in (1, 2))
        if len(set(n)) != 5 or not all(1 <= x <= 50 for x in n):
            raise ValueError(f"Numéros invalides le {r['date']}: {n}")
        if len(set(s)) != 2 or not all(1 <= x <= 12 for x in s):
            raise ValueError(f"Étoiles invalides le {r['date']}: {s}")
        rows.append({"date": r["date"], "n": n, "s": s})
    rows.sort(key=lambda x: x["date"])
    dates = [x["date"] for x in rows]
    if len(dates) != len(set(dates)):
        raise ValueError("Tirages en double dans le fichier")
    return rows


def write_csv(rows: list[dict]) -> None:
    with DATA.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADER)
        for r in rows:
            w.writerow([r["date"], *r["n"], *r["s"]])


def update() -> None:
    print(f"Téléchargement : {SOURCE_URL}")
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as resp:
        fresh = parse(resp.read().decode("utf-8"))
    current = parse(DATA.read_text()) if DATA.exists() else []
    # Un tirage déjà connu ne doit jamais changer : on vérifie avant d'écraser.
    known = {r["date"]: r for r in current}
    for r in fresh:
        old = known.get(r["date"])
        if old and (old["n"], old["s"]) != (r["n"], r["s"]):
            sys.exit(f"Conflit le {r['date']} : {old} contre {r}. Rien n'a été modifié.")
    merged = {**known, **{r["date"]: r for r in fresh}}
    rows = sorted(merged.values(), key=lambda x: x["date"])
    write_csv(rows)
    print(f"{len(rows) - len(current)} nouveau(x) tirage(s), {len(rows)} au total.")


def build(fragment_out: Path | None) -> None:
    rows = parse(DATA.read_text())
    lines = "\n".join(
        ",".join([r["date"], *map(str, r["n"]), *map(str, r["s"])]) for r in rows
    )
    template = TEMPLATE.read_text()
    if PLACEHOLDER not in template:
        sys.exit("Repère de données introuvable dans src/app.html")
    fragment = template.replace(PLACEHOLDER, json.dumps(lines))
    page = (
        "<!doctype html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n"
    )
    OUTPUT.write_text(page)
    print(f"index.html : {len(rows)} tirages, du {rows[0]['date']} au {rows[-1]['date']}.")
    if fragment_out:
        fragment_out.parent.mkdir(parents=True, exist_ok=True)
        fragment_out.write_text(fragment)
        print(f"Fragment : {fragment_out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true", help="télécharger les derniers tirages avant de construire")
    ap.add_argument("--fragment", type=Path, help="chemin d'une copie sans <html>/<head>")
    args = ap.parse_args()
    if args.update:
        update()
    build(args.fragment)


if __name__ == "__main__":
    main()
