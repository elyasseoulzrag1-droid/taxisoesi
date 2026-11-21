// Backend "base Claude" : adapte la capacité `db` (obtenue par claude.use("db")) à l'interface du store.

/**
 * @param {object} db espace de noms résolu par `await window.claude.use("db")`
 * @returns backend { kind, listen, set, update, delete }
 */
export function createClaudeBackend(db) {
  // db.doc() lève une TypeError synchrone pour un chemin mal formé : on en fait un rejet, marqué comme bug interne.
  const call = async (path, method, data) => {
    let ref;
    try {
      ref = db.doc(path);
    } catch (err) {
      throw { code: "internal", message: String((err && err.message) || err) };
    }
    return method === "delete" ? ref.delete() : ref[method](data);
  };
  return {
    kind: "claude",
    /** Un seul abonnement par collection : la base livre l'ensemble des documents à chaque changement. */
    listen(collection, onDocs, onError) {
      return db.collection(collection).onSnapshot(
        (snap) => {
          const docs = [];
          for (const doc of snap.docs) {
            const data = doc.exists === false ? undefined : doc.data();
            if (data) docs.push({ id: doc.id, data });
          }
          onDocs(docs, { fromCache: !!(snap.metadata && snap.metadata.fromCache) });
        },
        (err) => onError(err),
      );
    },
    set: (path, data) => call(path, "set", data),
    update: (path, data) => call(path, "update", data),
    delete: (path) => call(path, "delete"),
  };
}
