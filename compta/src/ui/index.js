// Kit d'interface de Compta StarringYou : tout s'importe d'ici.
//   import { Button, Modal, Money, BarChart, toast, fmtMoney } from "../ui/index.js";
export { Icon, ICON_NAMES } from "./Icon.jsx";
export { Button, IconButton, Spinner } from "./Button.jsx";
export { Modal, isModalOpen } from "./Modal.jsx";
export { confirmDialog, ConfirmHost } from "./confirm.jsx";
export { toast, dismissToast, ToastHost } from "./toast.jsx";
export { Field, TextInput, TextArea, DateInput, Select, Segmented, Toggle, Checkbox, SearchInput } from "./fields.jsx";
export { MoneyInput } from "./MoneyInput.jsx";
export { FileDrop } from "./FileDrop.jsx";
export { Badge, Chip, Card, Section, EmptyState, Banner, Skeleton, ProgressBar, Avatar, PartnerDot, Money, DateText, List, ListItem } from "./display.jsx";
export { Stat } from "./Stat.jsx";
export { Tabs } from "./Tabs.jsx";
export { Menu } from "./Menu.jsx";
export { Table } from "./Table.jsx";
export { BarChart, LineChart, Sparkline, HBarList, SplitBar, ChartLegend, ChartTable } from "./charts/index.js";
export { cx, useMediaQuery, useStableId, Portal } from "./util.js";
export { normTone, seriesColor, seriesInk } from "./tone.js";
export { matchesAccept } from "./accept.js";
export {
  MINUS,
  NBSP,
  EMPTY,
  fmtMoney,
  fmtMoneyCompact,
  fmtMoneyAxis,
  moneyAxis,
  fmtNumber,
  fmtPct,
  fmtRatio,
  fmtDate,
  fmtMonth,
  fmtShare,
  fmtFileSize,
  plural,
  pluralWord,
  initials,
} from "./format.js";
