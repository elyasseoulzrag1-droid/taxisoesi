#!/usr/bin/env node
// Garde-fous sur le code source : typographie imposée et API interdites dans un Artifact.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TARGETS = ["src", "dev", "README.md"];
const RULES = [
  { re: /[—–]/, msg: "tiret cadratin ou demi-cadratin interdit (utiliser virgule, deux-points, parenthèses ou '-')" },
  { re: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, msg: "alert/confirm/prompt ne s'affichent pas dans un Artifact", only: /\.(jsx?|html)$/ },
  { re: /window\.print\s*\(/, msg: "window.print() ne fait rien dans un Artifact", only: /\.(jsx?|html)$/ },
  { re: /\.innerHTML\s*=|dangerouslySetInnerHTML/, msg: "innerHTML interdit (données importées = non fiables)", only: /\.(jsx?)$/ },
];

async function walk(p) {
  const full = path.join(ROOT, p);
  let entries;
  try { entries = await readdir(full, { withFileTypes: true }); } catch { return [p]; }
  const out = [];
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = path.join(p, e.name);
    if (e.isDirectory()) out.push(...(await walk(rel)));
    else out.push(rel);
  }
  return out;
}

let failures = 0;
for (const target of TARGETS) {
  for (const file of await walk(target)) {
    if (!/\.(jsx?|mjs|css|html|md|json)$/.test(file)) continue;
    let text;
    try { text = await readFile(path.join(ROOT, file), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.only && !rule.only.test(file)) continue;
        if (rule.re.test(line)) {
          failures++;
          console.error(`${file}:${i + 1}: ${rule.msg}\n    ${line.trim().slice(0, 140)}`);
        }
      }
    });
  }
}
if (failures) { console.error(`\n${failures} problème(s).`); process.exit(1); }
console.log("Source OK.");
