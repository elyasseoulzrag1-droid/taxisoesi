// État global de l'appli : un seul magasin, sans bibliothèque.
// Les vues lisent avec les hooks ci-dessous et n'écrivent que par les actions (actions.js).
import { useEffect, useReducer, useRef } from "preact/hooks";
import { normalizeConfig, defaultConfig } from "../core/model.js";
import { buildBook } from "../core/ledger.js";
import { resolvePeriod } from "../core/periods.js";
import { todayISO } from "../core/dates.js";

const PREFS_KEY = "sy-compta:prefs";

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // Stockage indisponible (navigation privée, aperçu) : on continue sans mémoriser.
  }
}

const prefs = readPrefs();
const emptyConfig = normalizeConfig(defaultConfig());

let state = {
  phase: "boot", // "boot" | "ready" | "unavailable"
  platform: null,
  data: {
    ready: false,
    stale: false,
    error: null,
    readOnly: false,
    config: emptyConfig,
    configExists: false,
    ops: [],
    statsByMonth: {},
    audit: [],
    ignored: {},
  },
  book: buildBook(emptyConfig, []),
  canWrite: false,
  forceReadOnly: false, // outil de dev : simule un lecteur sans droit d'écriture
  ui: {
    route: "accueil",
    periodId: typeof prefs.periodId === "string" ? prefs.periodId : "all",
    customPeriod: prefs.customPeriod && typeof prefs.customPeriod === "object" ? prefs.customPeriod : { from: null, to: null },
    opFilter: {},
    opForm: null, // null ou { initial }
    addTab: "fichier",
  },
};

const listeners = new Set();

export function getState() {
  return state;
}

/** Fusionne un morceau d'état (ou le résultat d'une fonction) et prévient les abonnés. */
export function setState(patch) {
  const next = typeof patch === "function" ? patch(state) : patch;
  if (!next) return;
  state = { ...state, ...next };
  for (const fn of Array.from(listeners)) fn(state);
}

export function setUi(patch) {
  setState((s) => ({ ui: { ...s.ui, ...patch } }));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/**
 * Hook : lit une partie de l'état et ne redessine le composant que si elle change.
 * Le sélecteur peut renvoyer un objet neuf à chaque appel : la comparaison est faite champ par champ.
 */
export function useApp(selector) {
  const [, force] = useReducer((n) => n + 1, 0);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const valueRef = useRef();
  const selected = selector(state);
  const value = shallowEqual(valueRef.current, selected) ? valueRef.current : selected;
  valueRef.current = value;
  useEffect(
    () =>
      subscribe(() => {
        if (!shallowEqual(valueRef.current, selectorRef.current(state))) force();
      }),
    [],
  );
  return value;
}

export const useBook = () => useApp((s) => s.book);
export const useConfig = () => useApp((s) => s.data.config);
export const useData = () => useApp((s) => s.data);
export const useCanWrite = () => useApp((s) => s.canWrite);
export const usePlatform = () => useApp((s) => s.platform);
export const useUi = () => useApp((s) => s.ui);
export const useRoute = () => useApp((s) => s.ui.route);

/** Période choisie dans la barre du haut, résolue en { id, from, to, label }. */
export function usePeriod() {
  const { periodId, customPeriod, config } = useApp((s) => ({
    periodId: s.ui.periodId,
    customPeriod: s.ui.customPeriod,
    config: s.data.config,
  }));
  return resolvePeriod(periodId, config, todayISO(), customPeriod);
}

/** Même chose hors composant (actions, exports). */
export function currentPeriod() {
  const { ui, data } = state;
  return resolvePeriod(ui.periodId, data.config, todayISO(), ui.customPeriod);
}

export function setPeriod(periodId, customPeriod) {
  const patch = { periodId };
  if (customPeriod) patch.customPeriod = customPeriod;
  setUi(patch);
  writePrefs(patch);
}

let lastConfigKey = null;

/** Reçoit chaque instantané du magasin de données et recalcule ce qui a changé (config, livre). */
export function applySnapshot(snap) {
  const prev = state.data;
  let config = prev.config;
  const key = snap.config ? JSON.stringify(snap.config) : "";
  if (key !== lastConfigKey) {
    config = normalizeConfig(snap.config || defaultConfig());
    lastConfigKey = key;
  }
  const ops = snap.ops || [];
  const book = config !== prev.config || ops !== prev.ops ? buildBook(config, ops) : state.book;
  const user = (state.platform && state.platform.user) || {};
  const data = {
    ready: !!snap.ready,
    loaded: snap.loaded !== false,
    stale: !!snap.stale,
    error: snap.error || null,
    readOnly: !!snap.readOnly,
    config,
    configExists: !!snap.config,
    ops,
    statsByMonth: snap.statsByMonth || {},
    audit: snap.audit || [],
    ignored: snap.ignored || {},
  };
  setState({
    data,
    book,
    canWrite: !data.readOnly && user.canWrite !== false && !state.forceReadOnly,
    phase: data.ready ? "ready" : state.phase,
  });
}
