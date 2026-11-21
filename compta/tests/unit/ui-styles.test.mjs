// Garde-fous du kit d'interface : jetons de thème, couleurs en dur, variables CSS utilisées, page hôte, exports.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const read = (rel) => readFile(path.join(ROOT, rel), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Fichiers de style du kit (les vues ont leurs propres fichiers views-<nom>.css).
const KIT_CSS = ["src/styles/base.css", "src/styles/components.css", "src/styles/charts.css", "src/styles/views.css"];

/** Déclarations "--nom: valeur" d'un bloc CSS. */
function declarations(block) {
  const out = new Map();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** Corps du bloc qui suit `marker` (accolades équilibrées). */
function blockAfter(css, marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `bloc introuvable : ${marker}`);
  const open = css.indexOf("{", start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("accolade non fermée après " + marker);
}

async function listFiles(dir, pattern) {
  const out = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(rel, pattern)));
    else if (pattern.test(entry.name)) out.push(rel);
  }
  return out;
}

test("tokens.css : les deux blocs du thème sombre sont identiques", async () => {
  const css = stripComments(await read("src/styles/tokens.css"));
  const media = blockAfter(css, "@media (prefers-color-scheme: dark)");
  const auto = declarations(blockAfter(media, ':root:not([data-theme="light"])'));
  const forced = declarations(blockAfter(css, ':root[data-theme="dark"]'));
  assert.ok(auto.size > 40, "le thème sombre redéfinit les couleurs");
  assert.deepEqual([...forced.keys()].sort(), [...auto.keys()].sort(), "mêmes jetons dans les deux blocs");
  for (const [name, value] of auto) assert.equal(forced.get(name), value, `${name} diffère entre les deux blocs sombres`);
  assert.match(blockAfter(media, ':root:not([data-theme="light"])'), /color-scheme:\s*dark/);
  assert.match(blockAfter(css, ':root[data-theme="dark"]'), /color-scheme:\s*dark/);
});

test("tokens.css : le thème sombre ne redéfinit que des jetons qui existent, et toutes les couleurs de base", async () => {
  const css = stripComments(await read("src/styles/tokens.css"));
  const light = declarations(blockAfter(css, ":root {"));
  const dark = declarations(blockAfter(css, ':root[data-theme="dark"]'));
  for (const name of dark.keys()) assert.ok(light.has(name), `${name} est défini en sombre mais pas en clair`);
  const mustTheme = [
    "--paper", "--surface", "--surface-2", "--sunken", "--line", "--line-strong", "--control-line", "--ink", "--ink-2", "--ink-3",
    "--accent", "--accent-hover", "--accent-soft", "--accent-text", "--on-accent",
    "--in", "--in-soft", "--in-fill", "--out", "--out-soft", "--out-fill", "--warn", "--warn-soft", "--warn-fill", "--info", "--info-soft", "--info-fill",
    "--danger", "--danger-hover", "--on-danger", "--ticket", "--ticket-stub", "--ticket-edge", "--ticket-shadow", "--pop", "--focus", "--scrim",
    "--shadow-1", "--shadow-2", "--shadow-3", "--chart-in", "--chart-out", "--chart-accent", "--chart-muted", "--chart-grid", "--chart-axis", "--chart-hover",
    ...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}-ink`),
  ];
  for (const name of mustTheme) {
    assert.ok(light.has(name), `${name} manque dans le thème clair`);
    assert.ok(dark.has(name), `${name} n'est pas redéfini dans le thème sombre`);
  }
  for (const name of ["--paper", "--surface", "--ink", "--accent", "--ticket"]) {
    assert.notEqual(light.get(name), dark.get(name), `${name} doit changer entre clair et sombre`);
  }
});

test("tokens.css : la palette des séries est celle qui a été validée (ordre fixe)", async () => {
  const css = stripComments(await read("src/styles/tokens.css"));
  const light = declarations(blockAfter(css, ":root {"));
  const dark = declarations(blockAfter(css, ':root[data-theme="dark"]'));
  const pick = (map) => Array.from({ length: 8 }, (_, i) => map.get(`--chart-${i + 1}`));
  assert.deepEqual(pick(light), ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]);
  assert.deepEqual(pick(dark), ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"]);
  assert.deepEqual([light.get("--chart-in"), light.get("--chart-out")], ["#11957c", "#da4620"]);
  assert.deepEqual([dark.get("--chart-in"), dark.get("--chart-out")], ["#2da58b", "#eb5833"]);
});

test("aucune couleur en dur hors de tokens.css", async () => {
  const named = /(?<![-\w.#])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|navy|teal|silver|maroon|olive|lime|aqua|fuchsia)(?![-\w(])/i;
  for (const file of KIT_CSS) {
    const css = stripComments(await read(file));
    css.split("\n").forEach((line, i) => {
      const where = `${file}:${i + 1}: ${line.trim()}`;
      assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b/, "couleur hexadécimale : " + where);
      assert.doesNotMatch(line, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, "fonction de couleur : " + where);
      const value = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
      if (/^\s*(color|background|background-color|border[a-z-]*|outline[a-z-]*|fill|stroke|box-shadow|text-decoration-color)\s*:/.test(line)) {
        assert.doesNotMatch(value, named, "couleur nommée : " + where);
      }
    });
  }
  const sources = [...(await listFiles("src/ui", /\.(js|jsx)$/)), "dev/kit.jsx"];
  for (const file of sources) {
    const code = await read(file);
    code.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      assert.doesNotMatch(line, /["'`]#[0-9a-fA-F]{3,8}["'`]|\b(rgba?|hsla?)\(/, `couleur en dur dans ${file}:${i + 1}`);
    });
  }
});

test("toute variable CSS utilisée par le kit est définie", async () => {
  const defined = new Set();
  const cssFiles = ["src/styles/tokens.css", ...KIT_CSS];
  for (const file of cssFiles) {
    for (const m of stripComments(await read(file)).matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
  const used = new Map();
  const note = (name, file) => {
    if (!used.has(name)) used.set(name, file);
  };
  for (const file of cssFiles) {
    for (const m of stripComments(await read(file)).matchAll(/var\(\s*(--[a-z0-9-]+)/g)) note(m[1], file);
  }
  for (const file of [...(await listFiles("src/ui", /\.(js|jsx)$/)), "dev/kit.jsx"]) {
    const code = await read(file);
    for (const m of code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      // Les noms construits ("--chart-${i}") sont vérifiés par le test de la palette.
      if (!/\$\{/.test(code.slice(m.index, m.index + m[0].length + 3))) note(m[1], file);
    }
  }
  assert.ok(used.size > 60, "le kit utilise bien les jetons");
  for (const [name, file] of used) {
    if (name.endsWith("-")) continue;
    assert.ok(defined.has(name), `${name} est utilisé dans ${file} mais n'est défini nulle part`);
  }
});

test("le kit respecte les préférences de mouvement et montre le focus", async () => {
  const base = stripComments(await read("src/styles/base.css"));
  assert.match(base, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(base, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  const tokens = stripComments(await read("src/styles/tokens.css"));
  assert.match(tokens, /--control-h:\s*44px/, "cibles tactiles de 44 px par défaut");
  assert.match(tokens, /--gutter-l:\s*max\(16px, env\(safe-area-inset-left/);
  assert.equal(stripComments(await read("src/styles/views.css")).trim(), "", "views.css reste vide : les vues écrivent dans views-<nom>.css");
});

test("page.html : repères, titre, une seule feuille de polices avec des piles de secours", async () => {
  const html = await read("src/page.html");
  assert.ok(html.includes("/*__STYLES__*/"));
  assert.ok(html.includes("/*__SCRIPT__*/"));
  assert.ok(html.includes("<title>Compta StarringYou</title>"));
  assert.match(html, /<div id="app">/);
  const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  assert.equal(sheets.length, 1, "une seule feuille de style externe");
  assert.match(sheets[0], /href="https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.doesNotMatch(html, /@import|@font-face/);
  assert.doesNotMatch(html, /<script[^>]+src=/, "aucun script externe dans le gabarit");
  const families = [...sheets[0].matchAll(/family=([^:&"]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, " ")));
  const tokens = stripComments(await read("src/styles/tokens.css"));
  for (const role of ["--font-ui", "--font-display"]) {
    const stack = new RegExp(role + ":\\s*([^;]+);").exec(tokens)[1].split(",").map((f) => f.trim().replace(/^"|"$/g, ""));
    assert.ok(families.includes(stack[0]), `${stack[0]} (${role}) est chargée par le lien Google Fonts`);
    assert.ok(stack.length >= 4, `${role} a une vraie pile de secours`);
    assert.equal(stack[stack.length - 1], "sans-serif");
  }
  const styles = [...KIT_CSS, "src/styles/tokens.css"];
  for (const file of styles) assert.doesNotMatch(await read(file), /@import|@font-face|url\(/, `${file} ne charge rien d'externe`);
});

test("index.js exporte tous les composants et graphiques prévus", async () => {
  const index = await read("src/ui/index.js");
  const exported = new Set();
  for (const m of index.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(",")) {
      const clean = name.trim().split(/\s+as\s+/).pop();
      if (clean) exported.add(clean);
    }
  }
  const required = [
    "Button", "IconButton", "Icon", "Modal", "confirmDialog", "ConfirmHost", "toast", "ToastHost", "Field", "TextInput", "TextArea",
    "MoneyInput", "DateInput", "Select", "Segmented", "Toggle", "Checkbox", "SearchInput", "FileDrop", "Badge", "Chip", "Card", "Section",
    "Stat", "EmptyState", "Banner", "Skeleton", "Tabs", "Menu", "Money", "DateText", "Avatar", "PartnerDot", "ProgressBar", "Spinner", "Table",
    "BarChart", "LineChart", "Sparkline", "HBarList", "SplitBar", "fmtMoney", "fmtDate", "fmtPct", "fmtRatio", "plural",
  ];
  for (const name of required) assert.ok(exported.has(name), `${name} n'est pas exporté par src/ui/index.js`);
});

test("Icon.jsx contient toutes les icônes prévues", async () => {
  const code = await read("src/ui/Icon.jsx");
  const required = [
    "plus", "edit", "trash", "upload", "download", "search", "filter", "close", "check", "alert", "info",
    "chevron-left", "chevron-right", "chevron-down", "chevron-up", "camera", "chart", "wallet", "users", "settings", "sparkles",
    "receipt", "bank", "link", "calendar", "refresh", "lock", "unlock", "paperclip", "arrow-in", "arrow-out", "swap", "more",
    "copy", "eye", "tag", "film", "ticket", "home", "list", "menu",
  ];
  for (const name of required) {
    const key = new RegExp(`\\n\\s*(?:"${name}"|${name.includes("-") ? "\\b\\B" : name}):\\s*\\[`);
    assert.match(code, key, `icône manquante : ${name}`);
  }
});
