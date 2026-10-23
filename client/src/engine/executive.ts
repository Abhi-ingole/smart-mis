/**
 * Executive view: the numbers behind the report-style dashboard header —
 * year selection (calendar or Indian financial year), month-by-month values
 * coloured by quarter, change vs the same month last year, and a
 * dimension × quarter matrix. Pure functions over the typed table.
 */
import type { ColumnProfile, ColumnSchema, KpiDef, Table } from "./types";
import { aggregate, numericValues, type SimpleAgg } from "./analytics";

export type YearMode = "calendar" | "fiscal";

export interface PeriodOption {
  id: string;
  label: string;
  start: number; // epoch day, inclusive
  end: number; // epoch day, exclusive
}

export interface MonthPoint {
  label: string; // "Apr"
  long: string; // "Apr 2025"
  quarter: number; // 1..4 within the selected year type
  value: number | null;
  prior: number | null; // same month one year earlier
  rows: number;
}

export interface MatrixRow {
  label: string;
  quarters: (number | null)[];
  /** Same quarters one year earlier. */
  prior: (number | null)[];
  total: number | null;
  priorTotal: number | null;
}

export interface ExecMeasure {
  key?: string; // undefined = count of rows
  agg: SimpleAgg;
  name: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (y: number, m: number) => Math.floor(Date.UTC(y, m, 1) / 86_400_000);
const ymOf = (day: number) => {
  const d = new Date(day * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
};

/** Calendar years, or Apr–Mar financial years, that contain data. Newest first. */
export function yearOptions(table: Table, rows: number[], timeKey: string, mode: YearMode): PeriodOption[] {
  const t = table.num[timeKey];
  if (!t) return [];
  const years = new Set<number>();
  for (const i of rows) {
    const d = t[i];
    if (d === null || d === undefined) continue;
    const { y, m } = ymOf(d);
    years.add(mode === "fiscal" ? (m >= 3 ? y : y - 1) : y);
  }
  return [...years]
    .sort((a, b) => b - a)
    .map((y) =>
      mode === "fiscal"
        ? { id: `FY${y}`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`, start: dayOf(y, 3), end: dayOf(y + 1, 3) }
        : { id: `CY${y}`, label: String(y), start: dayOf(y, 0), end: dayOf(y + 1, 0) },
    );
}

/** Financial year (Apr–Mar) when the data starts in April or the headers talk about FY; calendar otherwise. */
export function guessYearMode(table: Table, rows: number[], timeKey: string, schema: ColumnSchema[]): YearMode {
  if (schema.some((c) => /\bfy\b|financial year|fiscal/i.test(c.name))) return "fiscal";
  const t = table.num[timeKey];
  let min = Infinity;
  for (const i of rows) {
    const d = t?.[i];
    if (d !== null && d !== undefined && d < min) min = d;
  }
  return Number.isFinite(min) && ymOf(min).m === 3 ? "fiscal" : "calendar";
}

export function rowsIn(table: Table, rows: number[], timeKey: string, p: Pick<PeriodOption, "start" | "end">): number[] {
  const t = table.num[timeKey];
  const out: number[] = [];
  for (const i of rows) {
    const d = t[i];
    if (d !== null && d !== undefined && d >= p.start && d < p.end) out.push(i);
  }
  return out;
}

export const priorPeriod = (p: PeriodOption): PeriodOption => {
  const s = ymOf(p.start);
  return { id: `${p.id}-prior`, label: "previous year", start: dayOf(s.y - 1, s.m), end: p.start };
};

export function measureValue(table: Table, rows: number[], m: ExecMeasure): number | null {
  if (!m.key || m.agg === "count") return rows.length;
  if (!rows.length) return null;
  return aggregate(numericValues(table, m.key, rows), m.agg);
}

/** 12 months of the selected year (or every month of the data when no year is selected, up to 36). */
export function monthSeries(table: Table, rows: number[], timeKey: string, m: ExecMeasure, period: PeriodOption | null, mode: YearMode): MonthPoint[] {
  const t = table.num[timeKey];
  let startDay: number;
  let months: number;
  if (period) {
    startDay = period.start;
    months = 12;
  } else {
    let min = Infinity;
    let max = -Infinity;
    for (const i of rows) {
      const d = t[i];
      if (d === null || d === undefined) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    if (!Number.isFinite(min)) return [];
    const a = ymOf(min);
    const b = ymOf(max);
    months = Math.min(36, (b.y - a.y) * 12 + (b.m - a.m) + 1);
    const first = b.y * 12 + b.m - months + 1;
    startDay = dayOf(Math.floor(first / 12), first % 12);
  }
  const s = ymOf(startDay);
  const buckets: number[][] = Array.from({ length: months }, () => []);
  const prior: number[][] = Array.from({ length: months }, () => []);
  const base = s.y * 12 + s.m;
  for (const i of rows) {
    const d = t[i];
    if (d === null || d === undefined) continue;
    const { y, m: mm } = ymOf(d);
    const idx = y * 12 + mm - base;
    if (idx >= 0 && idx < months) buckets[idx].push(i);
    else if (idx + 12 >= 0 && idx + 12 < months) prior[idx + 12].push(i);
  }
  return buckets.map((b, k) => {
    const abs = base + k;
    const y = Math.floor(abs / 12);
    const mm = abs % 12;
    const fiscalIndex = mode === "fiscal" ? (mm + 9) % 12 : mm;
    return {
      label: MON[mm],
      long: `${MON[mm]} ${y}`,
      quarter: Math.floor(fiscalIndex / 3) + 1,
      value: b.length ? measureValue(table, b, m) : m.agg === "count" || m.agg === "sum" ? 0 : null,
      prior: prior[k].length ? measureValue(table, prior[k], m) : null,
      rows: b.length,
    };
  });
}

/**
 * Rows of `dimKey` (top `limit` by total, rest as "Other") × the four quarters of the selected
 * year, with the same quarters one year earlier for comparison. `rows` may span several years.
 */
export function quarterMatrix(table: Table, rows: number[], timeKey: string, dimKey: string, m: ExecMeasure, period: PeriodOption, limit = 10): { rows: MatrixRow[]; total: MatrixRow } {
  const t = table.num[timeKey];
  const dim = table.str[dimKey];
  const a = ymOf(period.start);
  const empty = () => Array.from({ length: 8 }, () => [] as number[]); // 0–3 prior year, 4–7 selected year
  const groups = new Map<string, number[][]>();
  const all = empty();
  for (const i of rows) {
    const d = t[i];
    if (d === null || d === undefined) continue;
    const b = ymOf(d);
    const qi = Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / 3) + 4;
    if (qi < 0 || qi > 7) continue;
    const label = dim[i] ?? "(blank)";
    let g = groups.get(label);
    if (!g) groups.set(label, (g = empty()));
    g[qi].push(i);
    all[qi].push(i);
  }
  const val = (r: number[]) => (r.length ? measureValue(table, r, m) : null);
  const flat = (qs: number[][]) => {
    const out: number[] = [];
    for (const q of qs) for (const i of q) out.push(i);
    return out;
  };
  const make = (label: string, g: number[][]): MatrixRow => {
    const cur = g.slice(4);
    const pri = g.slice(0, 4);
    const curRows = flat(cur);
    const priRows = flat(pri);
    return {
      label,
      quarters: cur.map(val),
      prior: pri.map(val),
      total: curRows.length ? measureValue(table, curRows, m) : null,
      priorTotal: priRows.length ? measureValue(table, priRows, m) : null,
    };
  };
  const built = [...groups].map(([label, g]) => ({ g, row: make(label, g) })).filter((x) => x.row.total !== null);
  built.sort((x, y) => (y.row.total ?? -Infinity) - (x.row.total ?? -Infinity));
  const additive = m.agg === "sum" || m.agg === "count";
  let out = built.map((x) => x.row);
  if (built.length > limit && additive) {
    const rest = built.slice(limit - 1);
    const g = empty();
    for (const r of rest)
      r.g.forEach((q, k) => {
        for (const i of q) g[k].push(i);
      });
    out = [...out.slice(0, limit - 1), make(`Other (${rest.length})`, g)];
  } else out = out.slice(0, limit);
  return { rows: out, total: make("Total", all) };
}

/** The measure the executive view leads with: the first summed KPI, else a money/quantity column, else row count. */
export function pickMeasure(kpis: KpiDef[], schema: ColumnSchema[]): ExecMeasure {
  const by = (k?: string) => schema.find((c) => c.key === k && !c.excluded);
  const k = kpis.find((d) => d.agg === "sum" && by(d.columnKey));
  if (k) return { key: k.columnKey, agg: "sum", name: by(k.columnKey)!.name };
  const prefer = ["revenue", "profit", "cost", "salary", "quantity", "score"];
  for (const s of prefer) {
    const c = schema.find((x) => x.semantic === s && x.role === "measure" && !x.excluded);
    if (c) return { key: c.key, agg: s === "score" ? "avg" : "sum", name: c.name };
  }
  const any = schema.find((c) => c.role === "measure" && !c.excluded);
  if (any) return { key: any.key, agg: any.type === "percentage" ? "avg" : "sum", name: any.name };
  return { agg: "count", name: "Records" };
}

/** A readable dimension for the matrix: 2–30 values, preferring product/category/region-like columns. */
export function pickDimension(schema: ColumnSchema[], profiles: Record<string, ColumnProfile>): string | undefined {
  const ok = schema.filter((c) => c.role === "dimension" && !c.excluded && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 30);
  const rank = (c: ColumnSchema) => (["category", "product", "region", "department", "subject", "payment", "status"].indexOf(c.semantic) + 1 || 99) * 100 + (profiles[c.key]?.distinct ?? 0);
  return ok.sort((a, b) => rank(a) - rank(b))[0]?.key;
}

export const QUARTER_LABELS = (mode: YearMode) =>
  mode === "fiscal" ? ["Q1 (Apr–Jun)", "Q2 (Jul–Sep)", "Q3 (Oct–Dec)", "Q4 (Jan–Mar)"] : ["Q1 (Jan–Mar)", "Q2 (Apr–Jun)", "Q3 (Jul–Sep)", "Q4 (Oct–Dec)"];

export const pctChange = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : ((now - before) / Math.abs(before)) * 100);
