// Lecture des fichiers CSV exportés par les banques, Shopify et les régies pub :
// décodage des octets, détection du séparateur, guillemets RFC 4180, repérage de la ligne d'en-tête.
// Tout est fait en une passe, caractère par caractère, sans expression régulière sur le fichier entier.

const QUOTE = 34;
const LF = 10;
const CR = 13;
const SPACE = 32;
const TAB = 9;

// Ordre de préférence en cas d'égalité : du séparateur le plus rare dans du texte au plus courant.
const CANDIDATES = ["\t", ";", "|", ","];
const CANDIDATE_CODES = [9, 59, 124, 44];

const SNIFF_MAX_LINES = 60;
const SNIFF_MAX_CHARS = 262144;
const HEADER_SCAN_ROWS = 60;
const MAX_QUOTE_ROLLBACKS = 20;
const MAX_OVERFLOW_LINES = 100;

// Octets 0x80 à 0x9F de windows-1252 (le reste est identique à Latin-1).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/* ------------------------------------------------------------------ décodage */

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const tag = Object.prototype.toString.call(input);
  if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return new Uint8Array(0);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeUtf16(bytes, littleEndian) {
  const even = bytes.length - (bytes.length % 2);
  let view = bytes.subarray(0, even);
  if (!littleEndian) {
    const swapped = new Uint8Array(even);
    for (let i = 0; i < even; i += 2) { swapped[i] = view[i + 1]; swapped[i + 1] = view[i]; }
    view = swapped;
  }
  return stripBom(new TextDecoder("utf-16le").decode(view));
}

function decodeCp1252(bytes) {
  const parts = [];
  const chunk = new Array(8192);
  let filled = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    chunk[filled++] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b;
    if (filled === 8192) { parts.push(String.fromCharCode.apply(null, chunk)); filled = 0; }
  }
  if (filled) parts.push(String.fromCharCode.apply(null, chunk.slice(0, filled)));
  return parts.join("");
}

// UTF-16 sans BOM : dans un texte surtout ASCII, un octet sur deux vaut zéro, toujours du même côté.
function guessUtf16(bytes) {
  const size = Math.min(bytes.length, 4096);
  const pairs = Math.floor(size / 2);
  if (pairs < 2) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) zeroEven++;
    if (bytes[i + 1] === 0) zeroOdd++;
  }
  if (zeroOdd >= pairs * 0.4 && zeroEven <= pairs * 0.05) return "le";
  if (zeroEven >= pairs * 0.4 && zeroOdd <= pairs * 0.05) return "be";
  return null;
}

// Compte les séquences UTF-8 multi-octets bien formées et les octets qui ne peuvent pas en faire partie.
function utf8Stats(bytes) {
  let valid = 0;
  let invalid = 0;
  const n = bytes.length;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    let extra = 0;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b >= 0xe0 && b <= 0xef) extra = 2;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3;
    let ok = extra > 0 && i + extra < n;
    for (let k = 1; ok && k <= extra; k++) if ((bytes[i + k] & 0xc0) !== 0x80) ok = false;
    if (ok) { valid++; i += extra; } else invalid++;
  }
  return { valid, invalid };
}

/**
 * Transforme les octets d'un fichier en texte.
 * BOM UTF-8, UTF-16LE et UTF-16BE reconnus ; UTF-16 sans BOM deviné aux octets nuls ; sinon UTF-8 strict,
 * et windows-1252 quand les octets ne sont pas de l'UTF-8 valide (exports de banques françaises, vieux Excel).
 * Un fichier UTF-8 à peine abîmé (quelques octets isolés) reste lu en UTF-8.
 * @param {ArrayBuffer|Uint8Array|ArrayBufferView|number[]|string} input
 * @returns {string} texte sans BOM ("" si l'entrée est vide ou illisible)
 */
export function decodeBytes(input) {
  if (input == null) return "";
  if (typeof input === "string") return stripBom(input);
  const bytes = toBytes(input);
  const n = bytes.length;
  if (!n) return "";
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return stripBom(new TextDecoder("utf-8").decode(bytes.subarray(3)));
  }
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), true);
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), false);
  const utf16 = guessUtf16(bytes);
  if (utf16) return decodeUtf16(bytes, utf16 === "le");
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    const { valid, invalid } = utf8Stats(bytes);
    if (valid > 0 && invalid * 8 <= valid) return stripBom(new TextDecoder("utf-8").decode(bytes));
    return decodeCp1252(bytes);
  }
}

/* ------------------------------------------------------------------ cellules */

// Une cellule "ressemble à une donnée" (nombre, montant, date, heure) plutôt qu'à un titre de colonne.
function looksNumeric(cell) {
  const n = cell.length;
  if (!n || n > 40) return false;
  let digits = 0;
  let others = 0;
  for (let i = 0; i < n; i++) {
    const c = cell.charCodeAt(i);
    if (c >= 48 && c <= 57) { digits++; continue; }
    // espaces, ponctuation des nombres et des dates, symboles monétaires courants
    if (c === SPACE || c === 0xa0 || c === 0x202f || c === 46 || c === 44 || c === 58 || c === 47 || c === 45 ||
      c === 43 || c === 40 || c === 41 || c === 37 || c === 36 || c === 39 || c === 0x20ac || c === 0xa3 || c === 0x2212) continue;
    others++;
  }
  if (!digits) return false;
  if (!others) return true;
  return digits >= 4 && digits * 2 >= n;
}

// Nettoie une cellule : espaces autour, écriture ="0123" des tableurs, apostrophe qui force le texte ('0562, '=SOMME).
function cleanCell(raw) {
  let s = raw.trim();
  const n = s.length;
  if (n >= 3 && s.charCodeAt(0) === 61 && s.charCodeAt(1) === QUOTE && s.charCodeAt(n - 1) === QUOTE) {
    s = s.slice(2, -1).split('""').join('"').trim();
  } else if (n > 1 && s.charCodeAt(0) === 39) {
    const c = s.charCodeAt(1);
    if ((c >= 48 && c <= 57) || c === 61 || c === 43 || c === 45 || c === 64) s = s.slice(1).trim();
  }
  return s;
}

function countFilled(row) {
  let count = 0;
  for (let i = 0; i < row.length; i++) if (row[i]) count++;
  return count;
}

// Longueur de la ligne sans ses cellules vides de fin.
function trimmedLength(row) {
  let n = row.length;
  while (n > 0 && !row[n - 1]) n--;
  return n;
}

/* ------------------------------------------------------------------ lecture des enregistrements */

/**
 * Découpe le texte en enregistrements (lignes logiques) avec le séparateur donné.
 * Les lignes entièrement vides sont ignorées. Renvoie aussi le numéro de ligne du fichier où commence chaque enregistrement.
 */
function readRecords(src, start, startLine, delimiter) {
  const d = delimiter.charCodeAt(0);
  const n = src.length;
  const skipSpace = d !== SPACE;
  const skipTab = d !== TAB;
  const records = [];
  const lines = [];
  if (start >= n) return { records, lines };

  let row = [];
  let filled = false;
  let line = startLine;
  let rowLine = startLine;
  let i = start;
  let literalQuoteAt = -1;
  let rollbacks = 0;

  for (;;) {
    let cell = null;
    let end = -1;

    // Un guillemet ouvre une cellule seulement en début de champ (espaces tolérés avant).
    let j = i;
    while (j < n) {
      const c = src.charCodeAt(j);
      if ((c === SPACE && skipSpace) || (c === TAB && skipTab)) j++;
      else break;
    }
    if (j < n && src.charCodeAt(j) === QUOTE && j !== literalQuoteAt) {
      let k = j + 1;
      let seg = k;
      let buf = "";
      let innerLine = line;
      let closed = false;
      while (k < n) {
        const c = src.charCodeAt(k);
        if (c === QUOTE) {
          if (src.charCodeAt(k + 1) === QUOTE) {
            // guillemet doublé = un guillemet dans la valeur
            buf += src.slice(seg, k + 1);
            k += 2;
            seg = k;
            continue;
          }
          let t = k + 1;
          while (t < n) {
            const s = src.charCodeAt(t);
            if ((s === SPACE && skipSpace) || (s === TAB && skipTab)) t++;
            else break;
          }
          const next = t < n ? src.charCodeAt(t) : -1;
          if (next === -1 || next === d || next === LF || next === CR) {
            buf += src.slice(seg, k);
            end = t;
            closed = true;
            break;
          }
          // Guillemet isolé au milieu de la valeur (export mal formé) : on le garde tel quel.
          k++;
          continue;
        }
        if (c === LF) innerLine++;
        else if (c === CR && src.charCodeAt(k + 1) !== LF) innerLine++;
        k++;
      }
      if (!closed) {
        if (innerLine > line && rollbacks < MAX_QUOTE_ROLLBACKS) {
          // Guillemet jamais refermé qui avalerait toute la suite du fichier : on le relit comme un caractère normal.
          rollbacks++;
          literalQuoteAt = j;
        } else {
          buf += src.slice(seg, n);
          end = n;
          closed = true;
        }
      }
      if (closed) {
        cell = innerLine > line ? buf.replace(/\r\n?/g, "\n") : buf;
        line = innerLine;
      }
    }

    if (cell === null) {
      let k = i;
      while (k < n) {
        const c = src.charCodeAt(k);
        if (c === d || c === LF || c === CR) break;
        k++;
      }
      cell = src.slice(i, k);
      end = k;
    }

    cell = cleanCell(cell);
    if (cell) filled = true;
    row.push(cell);

    if (end >= n) {
      if (filled) { records.push(row); lines.push(rowLine); }
      break;
    }
    const c = src.charCodeAt(end);
    if (c === d) {
      i = end + 1;
      if (i >= n) {
        row.push("");
        if (filled) { records.push(row); lines.push(rowLine); }
        break;
      }
      continue;
    }
    // fin de ligne : CRLF, LF ou CR seul
    if (filled) { records.push(row); lines.push(rowLine); }
    row = [];
    filled = false;
    i = end + 1;
    if (c === CR && i < n && src.charCodeAt(i) === LF) i++;
    line++;
    rowLine = line;
    if (i >= n) break;
  }
  return { records, lines };
}

/* ------------------------------------------------------------------ séparateur */

// Première ligne "sep=;" écrite pour Excel : elle donne le séparateur et ne fait pas partie des données.
function readSepLine(src) {
  let end = 0;
  const limit = Math.min(src.length, 12);
  while (end < limit && src.charCodeAt(end) !== LF && src.charCodeAt(end) !== CR) end++;
  if (end === limit && end < src.length) return null;
  let first = src.slice(0, end);
  if (first.length >= 2 && first.charCodeAt(0) === QUOTE && first.charCodeAt(first.length - 1) === QUOTE) first = first.slice(1, -1);
  if (first.slice(0, 4).toLowerCase() !== "sep=") return null;
  let rest = first.slice(4);
  if (rest.length > 1) rest = rest.replace(/ +$/, "");
  let delimiter = null;
  if (rest === "\\t") delimiter = "\t";
  else if (rest.length === 1) delimiter = rest;
  if (!delimiter) return null;
  let next = end;
  if (next < src.length) {
    next += src.charCodeAt(next) === CR && src.charCodeAt(next + 1) === LF ? 2 : 1;
  }
  return { delimiter, end: next };
}

function sniff(src, start) {
  const n = Math.min(src.length, start + SNIFF_MAX_CHARS);
  const counts = [[], [], [], []];
  const bounds = [];
  let current = [0, 0, 0, 0];
  let inQuotes = false;
  let fieldStart = true;
  let hasContent = false;
  let lineStart = start;
  let i = start;
  for (; i < n && bounds.length < SNIFF_MAX_LINES; i++) {
    const c = src.charCodeAt(i);
    if (inQuotes) {
      if (c === QUOTE) {
        if (src.charCodeAt(i + 1) === QUOTE) i++;
        else inQuotes = false;
      }
      continue;
    }
    if (c === LF || c === CR) {
      if (hasContent) {
        bounds.push([lineStart, i]);
        for (let k = 0; k < 4; k++) counts[k].push(current[k]);
      }
      if (c === CR && src.charCodeAt(i + 1) === LF) i++;
      current = [0, 0, 0, 0];
      fieldStart = true;
      hasContent = false;
      lineStart = i + 1;
      continue;
    }
    if (c === QUOTE && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      hasContent = true;
      continue;
    }
    if (c === SPACE) continue;
    hasContent = true;
    const k = c === 44 ? 3 : c === 59 ? 1 : c === 9 ? 0 : c === 124 ? 2 : -1;
    if (k >= 0) { current[k]++; fieldStart = true; } else fieldStart = false;
  }
  // Dernière ligne sans retour à la ligne (ou seule ligne, coupée par la limite de lecture).
  if (hasContent && bounds.length < SNIFF_MAX_LINES && (i >= src.length || !bounds.length)) {
    bounds.push([lineStart, i]);
    for (let k = 0; k < 4; k++) counts[k].push(current[k]);
  }
  return { counts, bounds };
}

/**
 * Devine le séparateur d'un texte CSV parmi virgule, point-virgule, tabulation et barre verticale.
 * Regarde les premières lignes en ignorant ce qui est entre guillemets : le bon séparateur revient
 * le même nombre de fois sur presque toutes les lignes, ligne d'en-tête comprise.
 * @param {string} text
 * @returns {"," | ";" | "\t" | "|"} (virgule si rien ne tranche)
 */
export function detectDelimiter(text) {
  const src = typeof text === "string" ? stripBom(text) : "";
  const sep = readSepLine(src);
  if (sep) return sep.delimiter;
  return sniffDelimiter(src, 0);
}

function sniffDelimiter(src, start) {
  const { counts, bounds } = sniff(src, start);
  const total = bounds.length;
  if (!total) return ",";
  let best = ",";
  let bestScore = 0;
  for (let k = 0; k < 4; k++) {
    const freq = new Map();
    for (const c of counts[k]) if (c > 0) freq.set(c, (freq.get(c) || 0) + 1);
    let mode = 0;
    let times = 0;
    for (const [c, f] of freq) if (f > times || (f === times && c > mode)) { mode = c; times = f; }
    if (!times) continue;
    // La première ligne "régulière" doit ressembler à des titres de colonnes : c'est ce qui départage
    // un vrai séparateur d'une virgule décimale ou d'une virgule de date présente sur chaque ligne de données.
    const first = bounds[counts[k].indexOf(mode)];
    const cells = readRecords(src.slice(first[0], first[1]), 0, 1, CANDIDATES[k]).records[0] || [];
    let filled = 0;
    let wordy = 0;
    for (const cell of cells) {
      if (!cell) continue;
      filled++;
      if (!looksNumeric(cell)) wordy++;
    }
    const score = (times / total) * (0.75 + 0.25 * (filled ? wordy / filled : 0));
    if (score > bestScore + 1e-9) { best = CANDIDATES[k]; bestScore = score; }
  }
  return best;
}

/* ------------------------------------------------------------------ ligne d'en-tête */

function hasNumericCell(row) {
  for (let i = 0; i < row.length; i++) if (row[i] && looksNumeric(row[i])) return true;
  return false;
}

// Les lignes suivantes ont-elles la même forme (même nombre de cellules) que la ligne candidate ?
// Oui si la ligne juste après a la même forme, ou au moins la moitié des cinq suivantes.
function followedByConsistentRows(records, index) {
  const width = records[index].length;
  const trimmed = trimmedLength(records[index]);
  let seen = 0;
  let same = 0;
  let nextSame = false;
  for (let j = index + 1; j < records.length && seen < 5; j++) {
    seen++;
    if (records[j].length === width || trimmedLength(records[j]) === trimmed) {
      same++;
      if (seen === 1) nextSame = true;
    }
  }
  return nextSame || (same >= 1 && same * 2 >= seen);
}

/**
 * Trouve la ligne d'en-tête : la première ligne d'au moins 3 cellules remplies, suivie de lignes de même forme,
 * en préférant une ligne sans nombre ni date (les lignes de titre du genre "Solde;1 234,56" sont écartées).
 */
function findHeaderRow(records) {
  const total = records.length;
  if (total <= 1) return 0;
  const scan = Math.min(total, HEADER_SCAN_ROWS);
  const filled = new Array(scan);
  let widest = 0;
  for (let i = 0; i < scan; i++) {
    filled[i] = countFilled(records[i]);
    if (filled[i] > widest) widest = filled[i];
  }
  const need = Math.min(3, widest);
  let loose = -1;
  for (let i = 0; i < scan; i++) {
    if (filled[i] < need) continue;
    if (!followedByConsistentRows(records, i)) continue;
    if (!hasNumericCell(records[i])) return i;
    if (loose < 0) loose = i;
  }
  if (loose >= 0) return loose;
  // Aucune ligne suivie de lignes régulières (fichier très court ou très irrégulier) : la première ligne assez remplie.
  for (let i = 0; i < scan; i++) if (filled[i] >= need) return i;
  return 0;
}

/* ------------------------------------------------------------------ API */

function emptyResult(delimiter) {
  return { headers: [], rows: [], delimiter, headerRow: 0, headerLine: 0, lineNumbers: [], preamble: [], overflowLines: [] };
}

/**
 * Lit un texte CSV.
 * - Séparateur deviné (virgule, point-virgule, tabulation, barre verticale) ou imposé par opts.delimiter
 *   ou par une première ligne "sep=;".
 * - Guillemets RFC 4180 : guillemets doublés, séparateurs et retours à la ligne dans une cellule.
 * - Fins de ligne CRLF, LF ou CR ; lignes vides ignorées partout.
 * - Lignes de titre avant le tableau : la ligne d'en-tête est repérée automatiquement, ou imposée par
 *   opts.headerRow (rang à partir de 0 parmi les lignes non vides, ligne "sep=" non comptée).
 * - opts.noHeader : le fichier n'a pas de ligne d'en-tête (colonnes nommées "Colonne 1", "Colonne 2"...).
 * - Chaque ligne est complétée ou coupée à la largeur de l'en-tête ; les cellules sont nettoyées
 *   (espaces, écriture ="0123", apostrophe de protection devant un chiffre, "=", "+", "-" ou "@").
 * @param {string|ArrayBuffer|Uint8Array} text texte déjà décodé (des octets sont acceptés et décodés avec decodeBytes)
 * @param {{ delimiter?: string, headerRow?: number, noHeader?: boolean }} [opts]
 * @returns {{ headers: string[], rows: string[][], delimiter: string, headerRow: number, headerLine: number,
 *   lineNumbers: number[], preamble: string[][], overflowLines: number[] }}
 *   headerLine et lineNumbers sont des numéros de ligne du fichier (à partir de 1) : lineNumbers[i] est la ligne de rows[i].
 *   preamble : les lignes non vides placées avant l'en-tête. overflowLines : lignes du fichier qui avaient plus de
 *   cellules remplies que l'en-tête (le surplus est coupé), au plus 100.
 */
export function parseCsv(text, opts = {}) {
  const options = opts || {};
  let src;
  if (typeof text === "string") src = stripBom(text);
  else if (text == null) src = "";
  else if (typeof text === "object") src = decodeBytes(text);
  else src = String(text);

  let start = 0;
  let startLine = 1;
  let declared = null;
  const sep = readSepLine(src);
  if (sep) { declared = sep.delimiter; start = sep.end; startLine = 2; }
  const forced = typeof options.delimiter === "string" && options.delimiter.length === 1 ? options.delimiter : null;
  const delimiter = forced || declared || sniffDelimiter(src, start);

  const { records, lines } = readRecords(src, start, startLine, delimiter);
  if (!records.length) return emptyResult(delimiter);

  let headerRow;
  let headerCells;
  let dataStart;
  if (options.noHeader) {
    headerRow = -1;
    dataStart = 0;
    let width = 0;
    for (const row of records) { const t = trimmedLength(row); if (t > width) width = t; }
    headerCells = [];
    for (let i = 0; i < width; i++) headerCells.push("Colonne " + (i + 1));
  } else {
    const wanted = options.headerRow;
    headerRow = Number.isInteger(wanted) && wanted >= 0 && wanted < records.length ? wanted : findHeaderRow(records);
    headerCells = records[headerRow];
    dataStart = headerRow + 1;
  }

  // Largeur du tableau : l'en-tête sans ses cellules vides de fin, sauf si des données se trouvent dessous.
  const rawWidth = headerCells.length;
  let width = trimmedLength(headerCells);
  if (width < rawWidth) {
    for (let r = dataStart; r < records.length && width < rawWidth; r++) {
      const t = Math.min(trimmedLength(records[r]), rawWidth);
      if (t > width) width = t;
    }
  }
  const headers = headerCells.slice(0, width);

  const rows = [];
  const lineNumbers = [];
  const overflowLines = [];
  for (let r = dataStart; r < records.length; r++) {
    let row = records[r];
    if (row.length > width) {
      if (trimmedLength(row) > width && overflowLines.length < MAX_OVERFLOW_LINES) overflowLines.push(lines[r]);
      row = row.slice(0, width);
    } else {
      while (row.length < width) row.push("");
    }
    rows.push(row);
    lineNumbers.push(lines[r]);
  }

  return {
    headers,
    rows,
    delimiter,
    headerRow,
    headerLine: headerRow >= 0 ? lines[headerRow] : 0,
    lineNumbers,
    preamble: headerRow > 0 ? records.slice(0, headerRow) : [],
    overflowLines,
  };
}

/**
 * Normalise un titre de colonne pour le comparer : minuscules, sans accents, sans ponctuation, espaces simples.
 * "Date de début" -> "date de debut", "Amount (USD)" -> "amount usd", "Impr." -> "impr".
 * @param {*} s
 * @returns {string}
 */
export function normHeader(s) {
  if (s == null) return "";
  return String(s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Cherche une colonne par son titre. Les candidats sont essayés dans l'ordre (le premier candidat trouvé gagne,
 * quel que soit l'ordre des colonnes) : une chaîne doit être égale au titre normalisé (elle est normalisée aussi),
 * une expression régulière est testée sur le titre normalisé.
 * @param {string[]} headers
 * @param {Array<string|RegExp>|string|RegExp} candidates
 * @returns {number} rang de la colonne, ou -1
 */
export function findColumn(headers, candidates) {
  if (!Array.isArray(headers)) return -1;
  const norm = headers.map(normHeader);
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    if (candidate instanceof RegExp) {
      for (let i = 0; i < norm.length; i++) {
        candidate.lastIndex = 0;
        if (norm[i] && candidate.test(norm[i])) return i;
      }
    } else if (candidate != null) {
      const wanted = normHeader(candidate);
      if (!wanted) continue;
      const i = norm.indexOf(wanted);
      if (i >= 0) return i;
    }
  }
  return -1;
}

// Clés d'objet à partir des titres : un titre vide devient "Colonne N", un doublon reçoit " (2)", " (3)"...
function objectKeys(headers) {
  const seen = new Set();
  return headers.map((header, i) => {
    const base = header || "Colonne " + (i + 1);
    let key = base;
    let n = 2;
    while (seen.has(key) || key === "__proto__") key = base + " (" + n++ + ")";
    seen.add(key);
    return key;
  });
}

/**
 * Transforme les lignes lues en objets dont les clés sont les titres d'origine.
 * Chaque objet porte aussi `__line` (non énumérable) : le numéro de ligne dans le fichier, pour les messages d'erreur.
 * @param {{ headers: string[], rows: string[][], lineNumbers?: number[] }} parsed résultat de parseCsv
 * @returns {Object<string, string>[]}
 */
export function rowsToObjects(parsed) {
  if (!parsed || !Array.isArray(parsed.rows)) return [];
  const keys = objectKeys(Array.isArray(parsed.headers) ? parsed.headers : []);
  const lines = Array.isArray(parsed.lineNumbers) ? parsed.lineNumbers : [];
  return parsed.rows.map((row, r) => {
    const out = {};
    for (let i = 0; i < keys.length; i++) out[keys[i]] = row[i] == null ? "" : row[i];
    Object.defineProperty(out, "__line", { value: lines[r] == null ? null : lines[r], enumerable: false });
    return out;
  });
}
