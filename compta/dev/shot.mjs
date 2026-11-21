#!/usr/bin/env node
// Ouvre une page construite dans Chromium avec la plateforme simulée, vérifie qu'elle tourne proprement
// et enregistre des captures (téléphone et ordinateur, thème clair et sombre).
//
//   node dev/shot.mjs dist/h-dashboard.html --route accueil --out /chemin/captures
// Options :
//   --route <nom>      page à afficher (ancre), défaut accueil
//   --out <dossier>    où enregistrer les captures (défaut dist/shots)
//   --empty            réglages présents mais aucune opération (états vides)
//   --fresh            base totalement vide (premier lancement, assistant de démarrage)
//   --readonly         simule un lecteur sans droit d'écriture
//   --flow <fichier>   module exportant `async function run(page, helpers)` exécuté avant les captures (téléphone clair)
//   --only <phone|desktop>   limite les tailles ; --no-dark saute le thème sombre
//   --name <préfixe>   préfixe des fichiers de capture
// Code de sortie 1 si : erreur console, exception, débordement horizontal, ou échec du scénario.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const file = argv.find((a) => !a.startsWith("--") && a.endsWith(".html"));
if (!file) { console.error("Usage : node dev/shot.mjs <page.html> [options]"); process.exit(2); }

const route = value("--route", "accueil");
const outDir = path.resolve(value("--out", path.join(ROOT, "dist", "shots")));
const flowPath = value("--flow", null);
const only = value("--only", null);
const prefix = value("--name", path.basename(file, ".html") + "-" + route);
const harness = { seed: flag("--fresh") ? "none" : flag("--empty") ? "config" : "full", readOnly: flag("--readonly") };

// Bibliothèques chargées à la demande depuis cdnjs par l'appli : servies ici depuis node_modules (pas de réseau).
const CDN = {
  "xlsx/0.18.5/xlsx.full.min.js": "node_modules/xlsx/dist/xlsx.full.min.js",
  "pdf.js/3.11.174/pdf.min.js": "node_modules/pdfjs-dist/build/pdf.min.js",
  "pdf.js/3.11.174/pdf.worker.min.js": "node_modules/pdfjs-dist/build/pdf.worker.min.js",
};

const sizes = [
  { id: "phone", width: 390, height: 844 },
  { id: "desktop", width: 1280, height: 900 },
].filter((s) => !only || s.id === only);
const schemes = flag("--no-dark") ? ["light"] : ["light", "dark"];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
let failures = 0;
let flowDone = false;

for (const size of sizes) {
  for (const scheme of schemes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (msg) => { if (msg.type() === "error") problems.push("console : " + msg.text()); });
    page.on("pageerror", (err) => problems.push("exception : " + (err.stack || err.message)));
    await page.route(/^https?:\/\//, async (r) => {
      const url = r.request().url();
      const hit = Object.keys(CDN).find((k) => url.endsWith(k));
      if (hit) {
        try {
          return await r.fulfill({ contentType: "text/javascript", body: await readFile(path.join(ROOT, CDN[hit])) });
        } catch { /* absent : on bloque */ }
      }
      return r.abort();
    });
    await page.addInitScript({ path: path.join(ROOT, "dev", "mock-claude.js") });
    await page.addInitScript((opts) => { window.__harness = opts; }, harness);
    await page.goto(pathToFileURL(path.resolve(file)).href + "#" + route);
    try {
      await page.waitForSelector('[data-phase="ready"], [data-phase="unavailable"]', { timeout: 15000 });
    } catch {
      problems.push("la page n'est pas arrivée à l'état prêt en 15 s");
    }
    await page.waitForTimeout(350);

    if (flowPath && !flowDone) {
      flowDone = true;
      try {
        const mod = await import(pathToFileURL(path.resolve(flowPath)).href);
        await mod.run(page, { assert, route, root: ROOT });
        console.log("scénario : OK");
      } catch (err) {
        problems.push("scénario : " + (err.stack || err.message));
      }
      await page.waitForTimeout(200);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`débordement horizontal de ${overflow}px à ${size.width}px de large`);
    const shot = path.join(outDir, `${prefix}-${size.id}-${scheme}${harness.seed !== "full" ? "-" + harness.seed : ""}${harness.readOnly ? "-lecture" : ""}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`${size.id} ${scheme} : ${shot}`);
    for (const p of problems) console.error("  PROBLÈME " + p);
    failures += problems.length;
    await context.close();
  }
}
await browser.close();
if (failures) { console.error(`\n${failures} problème(s).`); process.exit(1); }
console.log("Aucun problème détecté.");
