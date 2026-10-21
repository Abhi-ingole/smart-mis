/** Aggregation primitives used by KPIs, charts, insights and reports — one source of truth. */
import type { ColumnSchema, Table, TimeBucket } from "./types";
import { bucketLabel } from "./format";
import { epochDayToIso } from "./values";

export type SimpleAgg = "sum" | "avg" | "count" | "min" | "max" | "median" | "countDistinct";

export function aggregate(values: number[], agg: SimpleAgg): number | null {
  if (agg === "count") return values.length;
  if (!values.length) return null;
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return values.reduce((a, b) => (b < a ? b : a), Infinity);
    case "max":
      return values.reduce((a, b) => (b > a ? b : a), -Infinity);
    case "median": {
      const s = [...values].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case "countDistinct":
      return new Set(values).size;
  }
}

export function numericValues(table: Table, key: string, rows: number[]): number[] {
  const col = table.num[key];
  if (!col) return [];
  const out: number[] = [];
  for (const i of rows) {
    const v = col[i];
    if (v !== null) out.push(v);
  }
  return out;
}

export interface Group {
  key: string;
  value: number;
  count: number;
}

/** Aggregate a measure (or count rows when measureKey is undefined) by a dimension. */
export function groupBy(table: Table, rows: number[], dimKey: string, measureKey: string | undefined, agg: SimpleAgg): Group[] {
  const dim = table.str[dimKey];
  const mea = measureKey ? table.num[measureKey] : undefined;
  const buckets = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const i of rows) {
    const k = dim[i] ?? "(blank)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (mea) {
      const v = mea[i];
      if (v === null) continue;
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(v);
    }
  }
  const out: Group[] = [];
  for (const [k, c] of counts) {
    const value = mea ? aggregate(buckets.get(k) ?? [], agg === "count" ? "count" : agg) : c;
    if (value === null) continue;
    out.push({ key: k, value, count: c });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Keep the top N groups; fold the rest into "Other" (only for additive aggregations). */
export function topN(groups: Group[], n: number, agg: SimpleAgg): Group[] {
  if (groups.length <= n) return groups;
  const head = groups.slice(0, n);
  if (agg === "sum" || agg === "count") {
    const rest = groups.slice(n);
    head.push({ key: `Other (${rest.length})`, value: rest.reduce((a, g) => a + g.value, 0), count: rest.reduce((a, g) => a + g.count, 0) });
  }
  return head;
}

export function chooseBucket(minDay: number, maxDay: number): TimeBucket {
  const span = maxDay - minDay;
  if (span > 365 * 3) return "year";
  if (span > 370) return "quarter";
  if (span > 62) return "month";
  if (span > 14) return "week";
  return "day";
}

/** Start day of the bucket containing `day`. */
export function bucketStart(day: number, bucket: TimeBucket): number {
  if (bucket === "day") return day;
  if (bucket === "week") {
    const wd = (new Date(day * 86_400_000).getUTCDay() + 6) % 7; // Monday = 0
    return day - wd;
  }
  const [y, m] = epochDayToIso(day).split("-").map(Number);
  const startMonth = bucket === "month" ? m : bucket === "quarter" ? Math.floor((m - 1) / 3) * 3 + 1 : 1;
  return Math.floor(Date.UTC(y, startMonth - 1, 1) / 86_400_000);
}

export function nextBucket(start: number, bucket: TimeBucket): number {
  if (bucket === "day") return start + 1;
  if (bucket === "week") return start + 7;
  const [y, m] = epochDayToIso(start).split("-").map(Number);
  const add = bucket === "month" ? 1 : bucket === "quarter" ? 3 : 12;
  return Math.floor(Date.UTC(y, m - 1 + add, 1) / 86_400_000);
}

export interface TimePoint {
  start: number;
  label: string;
  value: number | null;
  count: number;
}

/** True when the data stops early in the bucket starting at `start` (e.g. only 2 days of the last month). */
export function isPartialBucket(start: number, maxDay: number, bucket: TimeBucket): boolean {
  if (bucket === "day") return false;
  const len = nextBucket(start, bucket) - start;
  return (maxDay - start + 1) / len < 0.8;
}

export interface Series {
  bucket: TimeBucket;
  points: TimePoint[];
  /** The last period has data for only part of its length. */
  lastPartial: boolean;
  maxDay: number | null;
}

/** Continuous time series (empty periods included so gaps are visible, not hidden). */
export function timeSeries(table: Table, rows: number[], timeKey: string, measureKey: string | undefined, agg: SimpleAgg, bucket?: TimeBucket): Series {
  const t = table.num[timeKey];
  const mea = measureKey ? table.num[measureKey] : undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  if (!Number.isFinite(min)) return { bucket: bucket ?? "month", points: [], lastPartial: false, maxDay: null };
  const b = bucket ?? chooseBucket(min, max);
  const vals = new Map<number, number[]>();
  const counts = new Map<number, number>();
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    const s = bucketStart(d, b);
    counts.set(s, (counts.get(s) ?? 0) + 1);
    if (mea) {
      const v = mea[i];
      if (v === null) continue;
      let arr = vals.get(s);
      if (!arr) vals.set(s, (arr = []));
      arr.push(v);
    }
  }
  const points: TimePoint[] = [];
  let guard = 0;
  for (let s = bucketStart(min, b); s <= max && guard < 2000; s = nextBucket(s, b), guard++) {
    const c = counts.get(s) ?? 0;
    const value = mea ? (vals.has(s) ? aggregate(vals.get(s)!, agg) : agg === "sum" || agg === "count" ? 0 : null) : c;
    points.push({ start: s, label: bucketLabel(s, b), value, count: c });
  }
  const last = points[points.length - 1];
  return { bucket: b, points, lastPartial: points.length > 1 && !!last && isPartialBucket(last.start, max, b), maxDay: max };
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function pairs(table: Table, rows: number[], xKey: string, yKey: string): { x: number[]; y: number[] } {
  const xs = table.num[xKey];
  const ys = table.num[yKey];
  const x: number[] = [];
  const y: number[] = [];
  for (const i of rows) {
    const a = xs[i];
    const b = ys[i];
    if (a !== null && b !== null) {
      x.push(a);
      y.push(b);
    }
  }
  return { x, y };
}

/** Additive measures are summed; rates, scores, prices and ages are averaged. */
export function defaultAgg(col: ColumnSchema): "sum" | "avg" {
  if (col.type === "percentage") return "avg";
  if (["price", "score", "rating", "age", "duration"].includes(col.semantic)) return "avg";
  if (col.semantic === "salary") return "avg";
  return "sum";
}

export const allRows = (table: Table) => Array.from({ length: table.rows.length }, (_, i) => i);
