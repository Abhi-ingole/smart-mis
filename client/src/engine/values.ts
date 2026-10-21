/** Value parsing shared by inference, cleaning and analytics. */
import type { Cell, DateOrder } from "./types";

const CURRENCY_RE = /(₹|rs\.?|inr|\$|usd|€|eur|£|gbp|¥|aed|sgd)/i;

export interface ParsedNumber {
  value: number;
  currency: string | null;
  percent: boolean;
}

/** "₹1,23,456.50", "(1,200)", "45%", "1.5e3", "-12" → number. Returns null if not numeric. */
export function parseNumber(cell: Cell): ParsedNumber | null {
  if (cell === null || typeof cell === "boolean") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? { value: cell, currency: null, percent: false } : null;
  let s = cell.trim();
  if (!s || s.length > 40) return null;
  const cur = CURRENCY_RE.exec(s);
  const currency = cur ? cur[1] : null;
  s = s.replace(CURRENCY_RE, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1).trim();
  if (s.endsWith("-") && /^\d/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  // Thousand separators (both 1,234,567 and Indian 12,34,567) — but not decimal commas like "12,5".
  if (/^-?\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  s = s.replace(/\s/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  let value = Number(s);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -Math.abs(value);
  return { value, currency, percent };
}

// ── Dates (stored as days since 1970-01-01, UTC) ──────────────
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export const toEpochDay = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

function valid(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function epochDayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export interface DateParts {
  /** Both readings when the string is like 03/04/2024 */
  a: number;
  b: number;
  c: number;
  sep: "slash" | "named" | "iso" | "month";
}

const fullYear = (y: number) => (y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y);

/** Parses a date string. For d/m vs m/d strings, `order` decides. Returns epoch day or null. */
export function parseDate(cell: Cell, order: DateOrder = "dmy"): number | null {
  if (cell === null || typeof cell === "boolean") return null;
  if (typeof cell === "number") return null; // Excel serials are handled by excelSerialToDay when the column is known to be a date
  const s = cell.trim();
  let m: RegExpExecArray | null;
  // ISO: 2024-03-15, 2024-03-15T10:30, 2024/03/15
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return valid(y, mo, d) ? toEpochDay(y, mo, d) : null;
  }
  // 15/03/2024, 03-15-24, 15.03.2024 (+ optional time)
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}.*)?$/.exec(s))) {
    const p = +m[1];
    const q = +m[2];
    const y = fullYear(+m[3]);
    const [d, mo] = order === "mdy" ? [q, p] : [p, q];
    return valid(y, mo, d) ? toEpochDay(y, mo, d) : null;
  }
  // 15-Mar-2024, 15 Mar 2024, 15 March, 2024
  if ((m = /^(\d{1,2})[\s\-/]+([a-z]{3,9})\.?[\s\-/,]+(\d{2}|\d{4})$/i.exec(s))) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = fullYear(+m[3]);
    return mo && valid(y, mo, +m[1]) ? toEpochDay(y, mo, +m[1]) : null;
  }
  // Mar 15, 2024 / March 15 2024
  if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo && valid(+m[3], mo, +m[2]) ? toEpochDay(+m[3], mo, +m[2]) : null;
  }
  // Month-year: 2024-03, Mar-2024, March 2024
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return valid(+m[1], +m[2], 1) ? toEpochDay(+m[1], +m[2], 1) : null;
  if ((m = /^([a-z]{3,9})[\s\-/']+(\d{2}|\d{4})$/i.exec(s))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = fullYear(+m[2]);
    return mo && valid(y, mo, 1) ? toEpochDay(y, mo, 1) : null;
  }
  return null;
}

/** For "a/b/yyyy" strings: which readings are possible. */
export function slashParts(cell: Cell): [number, number] | null {
  if (typeof cell !== "string") return null;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(cell.trim());
  return m ? [+m[1], +m[2]] : null;
}

/** Excel serial date (days since 1899-12-30) → epoch day. */
export const excelSerialToDay = (n: number) => Math.round(n) - 25569;

export function parseBoolean(cell: Cell): boolean | null {
  if (typeof cell === "boolean") return cell;
  if (typeof cell !== "string") return null;
  const s = cell.trim().toLowerCase();
  if (["yes", "y", "true", "t"].includes(s)) return true;
  if (["no", "n", "false", "f"].includes(s)) return false;
  return null;
}

export function cellText(cell: Cell): string | null {
  if (cell === null) return null;
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  if (typeof cell === "number") return Number.isInteger(cell) ? String(cell) : String(+cell.toFixed(6));
  const s = cell.trim();
  return s === "" ? null : s;
}
