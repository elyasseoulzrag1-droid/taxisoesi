// Qui regarde la page : capacité `user`. Toutes ses lectures résolvent une valeur et ne rejettent jamais ;
// on reste prudent quand même (une vue ancienne peut ne pas avoir toutes les méthodes).

export const ANONYMOUS = Object.freeze({ id: null, name: "", isOwner: false, canEdit: false, canWrite: null });
/** Mode local : une seule personne, sur son appareil, qui a tous les droits. */
export const LOCAL_USER = Object.freeze({ id: null, name: "", isOwner: true, canEdit: true, canWrite: true });

async function safe(run, fallback) {
  try {
    const value = await run();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * @param {object|null} user espace de noms résolu par `await window.claude.use("user")`
 * @returns {Promise<{ id: string|null, name: string, isOwner: boolean, canEdit: boolean, canWrite: boolean|null }>}
 *   canWrite : true ou false quand la plateforme le dit, null quand elle ne dit rien (un écrit refusé tranchera).
 */
export async function loadIdentity(user) {
  if (!user) return ANONYMOUS;
  const [me, canWrite] = await Promise.all([
    safe(() => user.me(), null),
    safe(() => user.can("data.write"), null),
  ]);
  return Object.freeze({
    id: me && typeof me.id === "string" && me.id ? me.id : null,
    name: me && typeof me.name === "string" ? me.name : "",
    isOwner: !!(me && me.isOwner),
    canEdit: !!(me && me.canEdit),
    canWrite: canWrite === true || canWrite === false ? canWrite : null,
  });
}

/**
 * Fabrique resolveNames(ids) -> Promise<{ [id]: nom }> ("" quand le nom n'est pas connu de ce visiteur).
 * Ne stocke jamais ces noms : ils changent selon qui regarde. À rappeler à chaque affichage (la plateforme met en cache).
 */
export function makeResolveNames(user) {
  return async function resolveNames(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === "string" && id))];
    const out = {};
    for (const id of list) out[id] = "";
    if (!user || !list.length || typeof user.profiles !== "function") return out;
    const profiles = await safe(() => user.profiles(list), null);
    if (profiles && typeof profiles === "object") {
      for (const id of list) {
        const profile = profiles[id];
        if (profile && typeof profile.name === "string") out[id] = profile.name;
      }
    }
    return out;
  };
}
