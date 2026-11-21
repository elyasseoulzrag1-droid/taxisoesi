// Identifiants et empreintes. Uniquement des lettres minuscules et des chiffres : valides comme segment de chemin en base.

let counter = 0;

/** Identifiant unique triable par date de création, ex. "op_m3k2x9a17f4q". */
export function newId(prefix = "") {
  const time = Date.now().toString(36);
  counter = (counter + 1) % 1296;
  const seq = counter.toString(36).padStart(2, "0");
  let rand = "";
  for (let i = 0; i < 6; i++) rand += Math.floor(Math.random() * 36).toString(36);
  return (prefix ? prefix + "_" : "") + time + seq + rand;
}

/** Empreinte courte et stable d'une chaîne (FNV-1a, 2 x 32 bits), en hexadécimal. */
export function hashString(input) {
  const s = String(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i; h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Transforme un libellé en identifiant lisible ("Carte Visa 0562" -> "carte_visa_0562"). */
export function slugify(input, max = 40) {
  return String(input)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, max) || "x";
}
