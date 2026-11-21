#!/usr/bin/env node
// Construit l'appli en un seul fichier HTML autonome.
//   node build.mjs          -> dist/compta.html (fragment pour l'Artifact) + index.html (page complète)
//   node build.mjs --min    -> idem, code minifié
import { build } from "esbuild";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const minify = process.argv.includes("--min");
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
// Options de dev : --entry dev/kit.jsx --out dist/kit.html construit une autre page (galerie de composants).
const customEntry = argValue("--entry");
const customOut = argValue("--out");

const STYLE_ORDER = ["tokens.css", "base.css", "components.css", "views.css"];

async function bundleJs() {
  const result = await build({
    entryPoints: [customEntry ? path.resolve(ROOT, customEntry) : path.join(SRC, "main.jsx")],
    bundle: true,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    jsxImportSource: "preact",
    minify,
    legalComments: "none",
    write: false,
    logLevel: "warning",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return result.outputFiles[0].text;
}

async function bundleCss() {
  const dir = path.join(SRC, "styles");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".css"));
  const ordered = [
    ...STYLE_ORDER.filter((f) => files.includes(f)),
    ...files.filter((f) => !STYLE_ORDER.includes(f)).sort(),
  ];
  const parts = await Promise.all(ordered.map((f) => readFile(path.join(dir, f), "utf8")));
  return parts.join("\n");
}

const [js, css, template] = await Promise.all([
  bundleJs(),
  bundleCss(),
  readFile(path.join(SRC, "page.html"), "utf8"),
]);

for (const marker of ["/*__STYLES__*/", "/*__SCRIPT__*/"]) {
  if (!template.includes(marker)) throw new Error(`Repère ${marker} introuvable dans src/page.html`);
}

// Un "</script>" dans le code fermerait la balise : on le neutralise.
const safeJs = js.replace(/<\/script/gi, "<\\/script");
const fragment = template
  .replace("/*__STYLES__*/", () => css)
  .replace("/*__SCRIPT__*/", () => safeJs);

const page =
  '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  "</head>\n<body>\n" + fragment + "\n</body>\n</html>\n";

await mkdir(path.join(ROOT, "dist"), { recursive: true });
const kb = (n) => Math.round(n / 1024) + " Ko";
if (customOut) {
  await writeFile(path.resolve(ROOT, customOut), page);
  console.log(`${customOut} : ${kb(page.length)}`);
} else {
  await writeFile(path.join(ROOT, "dist", "compta.html"), fragment);
  await writeFile(path.join(ROOT, "index.html"), page);
  console.log(`dist/compta.html : ${kb(fragment.length)} (js ${kb(js.length)}, css ${kb(css.length)})`);
}
