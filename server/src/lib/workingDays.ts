import { addDays, weekday } from "./dates";

export interface WorkRules {
  /** Weekdays that are always off. 0 = Sunday … 6 = Saturday. Default: [0] */
  weekdaysOff: number[];
  /** Which Saturdays of the month are off (1–5). Default: [2, 4] */
  saturdaysOff: number[];
}

export const DEFAULT_WORK_RULES: WorkRules = { weekdaysOff: [0], saturdaysOff: [2, 4] };

/** 1 for the first Saturday of the month, 2 for the second, etc. */
export function nthWeekdayOfMonth(date: string): number {
  const day = Number(date.slice(8, 10));
  return Math.ceil(day / 7);
}

export function isWorkingDay(date: string, rules: WorkRules = DEFAULT_WORK_RULES, holidays: Iterable<string> = []): boolean {
  const wd = weekday(date);
  if (rules.weekdaysOff.includes(wd)) return false;
  if (wd === 6 && rules.saturdaysOff.includes(nthWeekdayOfMonth(date))) return false;
  const set = holidays instanceof Set ? holidays : new Set(holidays);
  if (set.has(date)) return false;
  return true;
}

/** The most recent working day strictly before `date` (searches up to 60 days back). */
export function previousWorkingDay(date: string, rules: WorkRules = DEFAULT_WORK_RULES, holidays: Iterable<string> = []): string | null {
  const set = new Set(holidays);
  let d = addDays(date, -1);
  for (let i = 0; i < 60; i++) {
    if (isWorkingDay(d, rules, set)) return d;
    d = addDays(d, -1);
  }
  return null;
}

/** Why a day is off, or null if it is a working day. */
export function offReason(date: string, rules: WorkRules = DEFAULT_WORK_RULES, holidays: Map<string, string> = new Map()): string | null {
  const wd = weekday(date);
  if (rules.weekdaysOff.includes(wd)) return wd === 0 ? "Sunday" : "Weekly off";
  if (wd === 6 && rules.saturdaysOff.includes(nthWeekdayOfMonth(date))) {
    const n = nthWeekdayOfMonth(date);
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix} Saturday`;
  }
  const h = holidays.get(date);
  if (h) return `Holiday: ${h}`;
  return null;
}

export function parseWorkRules(json: string | null | undefined): WorkRules {
  if (!json) return { ...DEFAULT_WORK_RULES };
  try {
    const v = JSON.parse(json);
    const weekdaysOff = Array.isArray(v.weekdaysOff) ? v.weekdaysOff.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6) : DEFAULT_WORK_RULES.weekdaysOff;
    const saturdaysOff = Array.isArray(v.saturdaysOff) ? v.saturdaysOff.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5) : DEFAULT_WORK_RULES.saturdaysOff;
    return { weekdaysOff, saturdaysOff };
  } catch {
    return { ...DEFAULT_WORK_RULES };
  }
}
