import type { ColumnSchema, TimeBucket } from "./types";
import { epochDayToIso } from "./values";

const nf = (maxFrac: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: maxFrac });
const int = nf(0);
const dec2 = nf(2);

export function fmtNumber(n: number | null | undefined, maxFrac?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (maxFrac !== undefined) return nf(maxFrac).format(n);
  return Math.abs(n) >= 1000 ? int.format(n) : dec2.format(n);
}

export function fmtPercent(n: number | null | undefined, frac = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const f = n !== 0 && Math.abs(n) < 0.1 ? 2 : frac;
  return `${n.toFixed(f)}%`;
}

/** Only shows a currency symbol when the data itself had one — never invents ₹ or $. */
export function fmtCurrency(n: number | null | undefined, symbol?: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = symbol ? normaliseSymbol(symbol) : "";
  const v = Math.abs(n) >= 1000 ? int.format(n) : dec2.format(n);
  return s ? (n < 0 ? `-${s}${v.replace("-", "")}` : `${s}${v}`) : v;
}

function normaliseSymbol(s: string): string {
  const k = s.toLowerCase().replace(".", "");
  if (k === "rs" || k === "inr" || k === "₹") return "₹";
  if (k === "usd" || k === "$") return "$";
  if (k === "eur" || k === "€") return "€";
  if (k === "gbp" || k === "£") return "£";
  return s.toUpperCase() + " ";
}

/** Short axis labels: 12.3L, 4.5Cr, 12K (Indian) */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(2)}`;
}

export function fmtValue(n: number | null | undefined, col?: ColumnSchema): string {
  if (!col) return fmtNumber(n);
  if (col.type === "currency") return fmtCurrency(n, col.currencySymbol);
  if (col.type === "percentage") return fmtPercent(n);
  if (col.type === "date" && n !== null && n !== undefined) return epochDayToIso(n);
  return fmtNumber(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Label for a time bucket starting at epoch day `start`. */
export function bucketLabel(start: number, bucket: TimeBucket): string {
  const iso = epochDayToIso(start);
  const [y, m, d] = iso.split("-").map(Number);
  switch (bucket) {
    case "day":
      return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
    case "week":
      return `Wk of ${d} ${MONTHS[m - 1]}`;
    case "month":
      return `${MONTHS[m - 1]} ${y}`;
    case "quarter":
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "year":
      return String(y);
  }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
