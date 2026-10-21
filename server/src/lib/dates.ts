/** Date helpers. All business dates are plain "YYYY-MM-DD" strings in the company time zone. */

export const DEFAULT_TZ = "Asia/Kolkata";
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parts of "now" in a given IANA time zone. */
export function nowParts(tz = DEFAULT_TZ, now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export const todayIn = (tz = DEFAULT_TZ, now = new Date()) => nowParts(tz, now).date;

/** A UTC-noon Date for a YYYY-MM-DD string (safe for day arithmetic). */
export function toUtcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  return fromUtcDate(toUtcDate(date)) === date;
}

/** 0 = Sunday … 6 = Saturday */
export const weekday = (date: string) => toUtcDate(date).getUTCDay();

export const monthOf = (date: string) => date.slice(0, 7);

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const shortDay = (date: string) => SHORT_DAYS[weekday(date)];

/** "Wed, 21 Oct 2026" */
export function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${shortDay(date)}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
