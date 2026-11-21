// Jeu d'icônes en SVG en ligne (grille 24, trait 1,75, bouts ronds). Pas d'emoji, pas de police d'icônes.
import { cx } from "./util.js";

// Chaque icône : une liste de tracés (attribut "d").
const DOT = (x, y) => `M${x + 1} ${y}a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z`;
const CIRCLE = "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z";

export const ICONS = {
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  edit: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6M14 11v6"],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  search: ["M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", "M21 21l-4.3-4.3"],
  filter: ["M3 5h18l-7 8.5V19l-4 2v-7.5Z"],
  close: ["M18 6 6 18M6 6l12 12"],
  check: ["M20 6 9 17l-5-5"],
  "check-circle": [CIRCLE, "M8.5 12.5l2.5 2.5 4.5-5"],
  alert: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9v4", "M12 17h.01"],
  info: [CIRCLE, "M12 16v-4", "M12 8h.01"],
  help: [CIRCLE, "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  "chevron-left": ["M15 18l-6-6 6-6"],
  "chevron-right": ["M9 18l6-6-6-6"],
  "chevron-down": ["M6 9l6 6 6-6"],
  "chevron-up": ["M18 15l-6-6-6 6"],
  camera: [
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z",
    "M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  ],
  scan: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 12h10"],
  chart: ["M3 3v18h18", "M8 17v-5", "M13 17V8", "M18 17v-8"],
  "trend-up": ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  "trend-down": ["M23 18l-9.5-9.5-5 5L1 6", "M17 18h6v-6"],
  wallet: ["M20 7H5a2 2 0 0 1 0-4h13v4", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1", "M17 14h.01"],
  coins: ["M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z", "M18.1 10.4a6 6 0 1 1-7.7 7.7", "M7 6h1v4"],
  dollar: ["M12 1v22", "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  percent: ["M19 5 5 19", "M9 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z", "M20 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"],
  users: [
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
    "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    "M23 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
  "user-plus": ["M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M12.5 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M20 8v6M23 11h-6"],
  settings: ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3", "M1 14h6M9 8h6M17 16h6"],
  sparkles: [
    "M11 3l1.8 4.9L18 9.5l-5.2 1.6L11 16l-1.8-4.9L4 9.5l5.2-1.6Z",
    "M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z",
  ],
  receipt: [
    "M5 2v20l2.5-1.5L10 22l2-1.5 2 1.5 2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5Z",
    "M9 8h6M9 12h6M9 16h3",
  ],
  bank: ["M3 21h18", "M12 3 3 8v2h18V8Z", "M6 10v8M10 10v8M14 10v8M18 10v8"],
  link: [
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7",
    "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  ],
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6", "M10 14 21 3"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M16 2v4M8 2v4M3 10h18"],
  clock: [CIRCLE, "M12 6v6l4 2"],
  refresh: ["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"],
  undo: ["M3 7v6h6", "M21 17a9 9 0 0 0-15-6.7L3 13"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4"],
  unlock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 9.9-1"],
  paperclip: ["M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"],
  "arrow-in": ["M17 7 7 17", "M17 17H7V7"],
  "arrow-out": ["M7 17 17 7", "M7 7h10v10"],
  "arrow-up": ["M12 19V5", "M5 12l7-7 7 7"],
  "arrow-down": ["M12 5v14", "M19 12l-7 7-7-7"],
  "arrow-right": ["M5 12h14", "M12 5l7 7-7 7"],
  swap: ["M17 3l4 4-4 4", "M3 7h18", "M7 21l-4-4 4-4", "M21 17H3"],
  more: [DOT(5, 12), DOT(12, 12), DOT(19, 12)],
  copy: [
    "M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
    "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  ],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  tag: ["M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z", "M7 7h.01"],
  film: [
    "M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z",
    "M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5",
  ],
  ticket: [
    "M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z",
    "M14 5v2M14 11v2M14 17v2",
  ],
  home: ["M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"],
  list: ["M8 6h13M8 12h13M8 18h13", "M3 6h.01M3 12h.01M3 18h.01"],
  menu: ["M3 6h18M3 12h18M3 18h18"],
  sort: ["M11 5h10M11 9h7M11 13h4", "M3 17l3 3 3-3", "M6 18V4"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"],
  image: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M10 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
    "M21 15l-5-5L5 21",
  ],
  text: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
  store: ["M3 9l1.5-5h15L21 9", "M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0", "M5 12v8h14v-8", "M10 20v-5h4v5"],
  megaphone: ["M3 11v2a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1Z", "M18.5 9a4 4 0 0 1 0 6", "M8 14v4a2 2 0 0 0 4 0v-1.5"],
  star: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2l-5-4.9 6.9-1Z"],
  flag: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z", "M4 22v-7"],
  sun: [
    "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"],
};

export const ICON_NAMES = Object.keys(ICONS);

/**
 * Icône en ligne. Décorative par défaut (masquée aux lecteurs d'écran) ; passer `label` pour la nommer.
 * @param {{ name: string, size?: number, label?: string, class?: string }} props
 */
export function Icon({ name, size = 20, label, class: className, ...rest }) {
  // Nom inconnu : un point discret plutôt qu'une erreur.
  const paths = ICONS[name] || [DOT(12, 12)];
  return (
    <svg
      class={cx("icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
      {...rest}
    >
      {paths.map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
}
