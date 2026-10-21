export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-IN"));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(Math.round(n * 10) / 10).toFixed(1)}%`);

export type KpiKey = "waSent" | "waDelivered" | "deliveryPct" | "emailSent" | "emailOpened" | "openPct";
export const KPI_KEYS: KpiKey[] = ["waSent", "waDelivered", "deliveryPct", "emailSent", "emailOpened", "openPct"];
export const KPI_LABELS: Record<KpiKey, string> = {
  waSent: "WhatsApp sent",
  waDelivered: "WhatsApp delivered",
  deliveryPct: "Delivery rate",
  emailSent: "Emails sent",
  emailOpened: "Emails opened",
  openPct: "Open rate",
};
export const isPct = (k: KpiKey) => k === "deliveryPct" || k === "openPct";
export const channelOf = (k: KpiKey): "wa" | "mail" => (k.startsWith("wa") || k === "deliveryPct" ? "wa" : "mail");
export const fmtKpi = (k: KpiKey, v: number) => (isPct(k) ? fmtPct(v) : fmtInt(v));

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function prettyDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay();
  return `${DAYS[wd]}, ${day} ${MONTHS[m - 1]} ${y}`;
}
export function shortDate(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}
export function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function addDays(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + n, 12));
  return dt.toISOString().slice(0, 10);
}
export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
