/**
 * KPI engine: recommends KPIs from the columns that exist and computes them
 * from the data. Every KPI carries its formula and source columns.
 */
import type { Agg, ColumnProfile, ColumnSchema, DomainGuess, KpiDef, KpiFilter, KpiValue, QualityReport, Table } from "./types";
import { aggregate, bucketStart, chooseBucket, defaultAgg, numericValues, nextBucket, groupBy, isPartialBucket } from "./analytics";
import { bucketLabel, fmtCurrency, fmtNumber, fmtPercent } from "./format";
import { isNumericType } from "./table";

export interface KpiContext {
  quality?: QualityReport;
}

const colName = (schema: ColumnSchema[], key?: string) => schema.find((c) => c.key === key)?.name ?? key ?? "";

function matchFilter(table: Table, i: number, f?: KpiFilter): boolean {
  if (!f) return true;
  const v = table.str[f.columnKey]?.[i];
  if (v === null || v === undefined) return false;
  const lv = v.toLowerCase();
  return f.values.some((x) => x.toLowerCase() === lv);
}

function computeSimple(table: Table, rows: number[], agg: Agg, columnKey: string | undefined, filter: KpiFilter | undefined): number | null {
  const r = filter ? rows.filter((i) => matchFilter(table, i, filter)) : rows;
  switch (agg) {
    case "count":
      return r.length;
    case "countDistinct": {
      if (!columnKey) return null;
      const s = new Set<string>();
      for (const i of r) {
        const v = table.str[columnKey]?.[i];
        if (v !== null && v !== undefined) s.add(v.toLowerCase());
      }
      return s.size;
    }
    case "missingPct": {
      if (!columnKey || !rows.length) return null;
      let m = 0;
      for (const i of r) if (table.str[columnKey]?.[i] === null) m++;
      return (m / r.length) * 100;
    }
    case "sum":
    case "avg":
    case "min":
    case "max":
    case "median":
      return columnKey ? aggregate(numericValues(table, columnKey, r), agg) : null;
    default:
      return null;
  }
}

export function computeKpi(def: KpiDef, table: Table, rows: number[], ctx: KpiContext = {}): { value: number | null; label?: string } {
  switch (def.agg) {
    case "quality":
      return { value: ctx.quality?.score ?? null };
    case "ratio": {
      if (!def.numerator || !def.denominator) return { value: null };
      const a = computeSimple(table, rows, def.numerator.agg, def.numerator.columnKey, def.numerator.filter);
      const b = computeSimple(table, rows, def.denominator.agg, def.denominator.columnKey, def.denominator.filter);
      if (a === null || b === null || b === 0) return { value: null };
      return { value: def.format === "percent" ? (a / b) * 100 : a / b };
    }
    case "share": {
      if (!def.filter || !rows.length) return { value: null };
      const hit = rows.filter((i) => matchFilter(table, i, def.filter)).length;
      return { value: (hit / rows.length) * 100 };
    }
    case "topShare": {
      if (!def.columnKey) return { value: null };
      const measure = def.numerator?.columnKey;
      const groups = groupBy(table, rows, def.columnKey, measure, measure ? "sum" : "count");
      const total = groups.reduce((a, g) => a + g.value, 0);
      if (!groups.length || total <= 0) return { value: null };
      return { value: (groups[0].value / total) * 100, label: groups[0].key };
    }
    default:
      return { value: computeSimple(table, rows, def.agg, def.columnKey, def.filter) };
  }
}

const AGG_WORD: Record<string, string> = { count: "COUNT", countDistinct: "COUNT DISTINCT", sum: "SUM", avg: "AVERAGE", min: "MIN", max: "MAX", median: "MEDIAN", missingPct: "MISSING %" };

export function formulaOf(def: KpiDef, schema: ColumnSchema[]): string {
  const part = (agg: Agg, key?: string, f?: KpiFilter) => {
    const where = f ? ` where ${colName(schema, f.columnKey)} = ${f.values.join(" or ")}` : "";
    if (agg === "count") return `COUNT(rows${where})`;
    return `${AGG_WORD[agg] ?? agg.toUpperCase()}(${colName(schema, key)}${where})`;
  };
  switch (def.agg) {
    case "quality":
      return "Data quality score (see Data Quality page)";
    case "ratio":
      return `${part(def.numerator!.agg, def.numerator!.columnKey, def.numerator!.filter)} ÷ ${part(def.denominator!.agg, def.denominator!.columnKey, def.denominator!.filter)}${def.format === "percent" ? " × 100" : ""}`;
    case "share":
      return `${part("count", undefined, def.filter)} ÷ COUNT(rows) × 100`;
    case "topShare":
      return def.numerator?.columnKey
        ? `Largest SUM(${colName(schema, def.numerator.columnKey)}) by ${colName(schema, def.columnKey)} ÷ total × 100`
        : `Largest COUNT(rows) by ${colName(schema, def.columnKey)} ÷ COUNT(rows) × 100`;
    default:
      return part(def.agg, def.columnKey, def.filter);
  }
}

export function sourceColumns(def: KpiDef, schema: ColumnSchema[]): string[] {
  const keys = [def.columnKey, def.filter?.columnKey, def.numerator?.columnKey, def.numerator?.filter?.columnKey, def.denominator?.columnKey, def.denominator?.filter?.columnKey].filter(Boolean) as string[];
  return [...new Set(keys)].map((k) => colName(schema, k));
}

export function formatKpi(def: KpiDef, value: number | null, schema: ColumnSchema[], label?: string): string {
  if (value === null) return "—";
  let s: string;
  const col = schema.find((c) => c.key === (def.columnKey ?? def.numerator?.columnKey));
  switch (def.format) {
    case "percent":
      s = fmtPercent(value);
      break;
    case "currency":
      s = fmtCurrency(value, col?.currencySymbol);
      break;
    case "decimal":
      s = fmtNumber(value, 2);
      break;
    default:
      s = fmtNumber(value, Number.isInteger(value) ? 0 : 2);
  }
  return label ? `${label} · ${s}` : s;
}

const COMPARABLE = new Set<Agg>(["count", "countDistinct", "sum", "avg", "median", "ratio", "share", "min", "max"]);

/** Latest period vs the period before, when the data has dates spanning at least two periods. */
export function periodComparison(table: Table, rows: number[], timeKey: string | undefined): { last: number[]; prev: number[]; label: string } | null {
  if (!timeKey || !table.num[timeKey]) return null;
  const t = table.num[timeKey];
  let min = Infinity;
  let max = -Infinity;
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  if (!Number.isFinite(min)) return null;
  const bucket = chooseBucket(min, max);
  const starts: number[] = [];
  for (let s = bucketStart(min, bucket), guard = 0; s <= max && guard < 5000; s = nextBucket(s, bucket), guard++) starts.push(s);
  if (starts.length < 2) return null;
  // If the latest period is incomplete (e.g. 2 days of a month), compare the latest FULL periods instead.
  let li = starts.length - 1;
  let note = "";
  if (isPartialBucket(starts[li], max, bucket) && starts.length >= 3) {
    li--;
    note = " (latest full periods)";
  }
  const lastStart = starts[li];
  const prevStart = starts[li - 1];
  const lastEnd = nextBucket(lastStart, bucket);
  const last: number[] = [];
  const prev: number[] = [];
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    if (d >= lastStart && d < lastEnd) last.push(i);
    else if (d >= prevStart && d < lastStart) prev.push(i);
  }
  if (!last.length || !prev.length) return null;
  return { last, prev, label: `${bucketLabel(lastStart, bucket)} vs ${bucketLabel(prevStart, bucket)}${note}` };
}

/** Rows split into time periods (last `max` periods), for KPI sparklines. */
export function periodBuckets(table: Table, rows: number[], timeKey: string | undefined, max = 12): { label: string; rows: number[] }[] {
  if (!timeKey || !table.num[timeKey]) return [];
  const t = table.num[timeKey];
  let min = Infinity;
  let maxDay = -Infinity;
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    if (d < min) min = d;
    if (d > maxDay) maxDay = d;
  }
  if (!Number.isFinite(min)) return [];
  const bucket = chooseBucket(min, maxDay);
  const map = new Map<number, number[]>();
  for (const i of rows) {
    const d = t[i];
    if (d === null) continue;
    const s = bucketStart(d, bucket);
    let arr = map.get(s);
    if (!arr) map.set(s, (arr = []));
    arr.push(i);
  }
  const out: { label: string; rows: number[] }[] = [];
  for (let s = bucketStart(min, bucket), g = 0; s <= maxDay && g < 5000; s = nextBucket(s, bucket), g++) out.push({ label: bucketLabel(s, bucket), rows: map.get(s) ?? [] });
  return out.slice(-max);
}

export function evaluateKpis(defs: KpiDef[], table: Table, rows: number[], ctx: KpiContext = {}, timeKey?: string): KpiValue[] {
  const cmp = periodComparison(table, rows, timeKey);
  const buckets = periodBuckets(table, rows, timeKey);
  return defs.map((def) => {
    const { value, label } = computeKpi(def, table, rows, ctx);
    const out: KpiValue = { id: def.id, value, display: formatKpi(def, value, table.schema, label), formula: formulaOf(def, table.schema), sourceColumns: sourceColumns(def, table.schema) };
    if (cmp && COMPARABLE.has(def.agg) && def.agg !== "quality") {
      const a = computeKpi(def, table, cmp.last, ctx).value;
      const b = computeKpi(def, table, cmp.prev, ctx).value;
      if (a !== null && b !== null) {
        const changePct = b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
        out.comparison = { label: cmp.label, previous: b, changePct, direction: a > b ? "up" : a < b ? "down" : "flat" };
      }
    }
    if (buckets.length >= 3 && COMPARABLE.has(def.agg) && def.agg !== "quality") {
      out.trend = buckets.map((b) => ({ label: b.label, value: b.rows.length ? computeKpi(def, table, b.rows, ctx).value : def.agg === "count" || def.agg === "sum" ? 0 : null }));
    }
    return out;
  });
}

// ── Recommendations ─────────────────────────────────────────

let seq = 0;
const kid = (p: string) => `k-${p}-${(seq++).toString(36)}`;

export function recommendKpis(schema: ColumnSchema[], profiles: Record<string, ColumnProfile>, domain: DomainGuess, table?: Table): KpiDef[] {
  const cols = schema.filter((c) => !c.excluded && (profiles[c.key]?.count ?? 0) > 0);
  const by = (s: string) => cols.find((c) => c.semantic === s);
  const measures = cols.filter((c) => c.role === "measure" && isNumericType(c));
  const dims = cols.filter((c) => c.role === "dimension" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 200);
  const ids = cols.filter((c) => c.role === "identifier");
  const kpis: KpiDef[] = [];
  const used = new Set<string>();
  const add = (k: Omit<KpiDef, "id">, tag: string) => {
    const sig = JSON.stringify([k.agg, k.columnKey, k.numerator, k.denominator, k.filter]);
    if (used.has(sig)) return;
    used.add(sig);
    kpis.push({ ...k, id: kid(tag) });
  };
  const fmtFor = (c: ColumnSchema): KpiDef["format"] => (c.type === "currency" ? "currency" : c.type === "percentage" ? "percent" : "number");

  add({ name: "Total records", agg: "count", format: "number", description: "Number of rows in the data (after filters)." }, "rows");

  const statusValues = (c: ColumnSchema | undefined, re: RegExp) => (c ? (profiles[c.key]?.top ?? []).map((t) => t.value).filter((v) => re.test(v)) : []);
  // Distinct values from the full table where available (top-10 may miss some)
  const valuesOf = (c: ColumnSchema | undefined, re: RegExp) => {
    if (!c) return [];
    if (!table) return statusValues(c, re);
    const set = new Set<string>();
    for (const v of table.str[c.key]) if (v && re.test(v)) set.add(v);
    return [...set].slice(0, 20);
  };

  switch (domain.domain) {
    case "sales": {
      const rev = by("revenue");
      const order = by("order_id");
      const qty = by("quantity");
      const cust = by("customer");
      const profit = by("profit");
      const price = by("price");
      if (rev) add({ name: `Total ${rev.name}`, agg: "sum", columnKey: rev.key, format: fmtFor(rev), description: `Sum of ${rev.name} across all rows.` }, "rev");
      if (order) add({ name: "Orders", agg: "countDistinct", columnKey: order.key, format: "number", description: `Number of different ${order.name} values.` }, "orders");
      if (rev && order) add({ name: "Average order value", agg: "ratio", numerator: { agg: "sum", columnKey: rev.key }, denominator: { agg: "countDistinct", columnKey: order.key }, format: fmtFor(rev), description: `Total ${rev.name} divided by the number of orders.` }, "aov");
      else if (rev) add({ name: `Average ${rev.name} per row`, agg: "avg", columnKey: rev.key, format: fmtFor(rev), description: `Mean ${rev.name} per record.` }, "avgrev");
      if (qty) add({ name: `Total ${qty.name}`, agg: "sum", columnKey: qty.key, format: "number", description: `Sum of ${qty.name}.` }, "qty");
      if (!rev && price) add({ name: `Average ${price.name}`, agg: "avg", columnKey: price.key, format: fmtFor(price), description: `Mean ${price.name}.` }, "price");
      if (cust) add({ name: "Customers", agg: "countDistinct", columnKey: cust.key, format: "number", description: `Number of different ${cust.name} values.` }, "cust");
      if (profit) add({ name: `Total ${profit.name}`, agg: "sum", columnKey: profit.key, format: fmtFor(profit), description: `Sum of ${profit.name}.` }, "profit");
      if (profit && rev) add({ name: "Profit margin", agg: "ratio", numerator: { agg: "sum", columnKey: profit.key }, denominator: { agg: "sum", columnKey: rev.key }, format: "percent", description: `${profit.name} as a share of ${rev.name}.` }, "margin");
      break;
    }
    case "hr": {
      const emp = by("employee_id") ?? ids[0];
      const sal = by("salary");
      const dept = by("department");
      const age = by("age");
      const status = by("status");
      if (emp) add({ name: "Headcount", agg: "countDistinct", columnKey: emp.key, format: "number", description: `Number of different ${emp.name} values.` }, "head");
      else add({ name: "Headcount (rows)", agg: "count", format: "number", description: "Each row counted as one employee." }, "head");
      if (sal) {
        add({ name: `Average ${sal.name}`, agg: "avg", columnKey: sal.key, format: fmtFor(sal), description: `Mean ${sal.name}.` }, "avgsal");
        add({ name: `Total ${sal.name}`, agg: "sum", columnKey: sal.key, format: fmtFor(sal), description: `Sum of ${sal.name} (payroll).` }, "payroll");
      }
      if (dept) add({ name: `${dept.name}s`, agg: "countDistinct", columnKey: dept.key, format: "number", description: `Number of different ${dept.name} values.` }, "depts");
      let leftValues = valuesOf(status, /^(left|resigned|terminated|exited|inactive|attrited|separated)$/i);
      if (!leftValues.length && status && /attrition|left|exit/i.test(status.name)) leftValues = valuesOf(status, /^(yes|y|true)$/i);
      if (status && leftValues.length) add({ name: "Attrition rate", agg: "share", filter: { columnKey: status.key, values: leftValues }, format: "percent", description: `Share of rows where ${status.name} is ${leftValues.join("/")}.` }, "attr");
      if (age) add({ name: `Average ${age.name}`, agg: "avg", columnKey: age.key, format: "decimal", description: `Mean ${age.name}.` }, "age");
      break;
    }
    case "academic": {
      const sid = by("student_id") ?? by("person");
      const score = by("score");
      const result = by("result");
      const subject = by("subject");
      if (sid) add({ name: "Students", agg: "countDistinct", columnKey: sid.key, format: "number", description: `Number of different ${sid.name} values.` }, "students");
      if (score) {
        add({ name: `Average ${score.name}`, agg: "avg", columnKey: score.key, format: score.type === "percentage" ? "percent" : "decimal", description: `Mean ${score.name}.` }, "avgscore");
        add({ name: `Highest ${score.name}`, agg: "max", columnKey: score.key, format: score.type === "percentage" ? "percent" : "number", description: `Maximum ${score.name}.` }, "max");
        add({ name: `Lowest ${score.name}`, agg: "min", columnKey: score.key, format: score.type === "percentage" ? "percent" : "number", description: `Minimum ${score.name}.` }, "min");
      }
      const passValues = valuesOf(result, /^(pass|passed|p|promoted|qualified)$/i);
      if (result && passValues.length) add({ name: "Pass rate", agg: "share", filter: { columnKey: result.key, values: passValues }, format: "percent", description: `Share of rows where ${result.name} is ${passValues.join("/")}. (No pass mark is assumed — this uses the result column.)` }, "pass");
      if (subject) add({ name: `${subject.name}s`, agg: "countDistinct", columnKey: subject.key, format: "number", description: `Number of different ${subject.name} values.` }, "subjects");
      break;
    }
    case "finance": {
      const cost = by("cost")!;
      add({ name: `Total ${cost.name}`, agg: "sum", columnKey: cost.key, format: fmtFor(cost), description: `Sum of ${cost.name}.` }, "spend");
      add({ name: `Average ${cost.name}`, agg: "avg", columnKey: cost.key, format: fmtFor(cost), description: `Mean ${cost.name} per row.` }, "avgspend");
      break;
    }
    default:
      break;
  }

  // Generic measures (always useful, and the only ones for unknown data).
  const rankedMeasures = [...measures].sort((a, b) => score(b) - score(a));
  function score(c: ColumnSchema) {
    return (c.type === "currency" ? 3 : 0) + (c.semantic !== "none" ? 2 : 0) + (profiles[c.key]?.count ?? 0) / Math.max(1, table?.rows.length ?? 1);
  }
  for (const m of rankedMeasures.slice(0, domain.domain === "generic" ? 3 : 2)) {
    const agg = defaultAgg(m);
    add({ name: `${agg === "sum" ? "Total" : "Average"} ${m.name}`, agg, columnKey: m.key, format: fmtFor(m) === "number" && agg === "avg" ? "decimal" : fmtFor(m), description: `${agg === "sum" ? "Sum" : "Mean"} of ${m.name}.` }, `m-${m.key}`);
  }
  // Row numbers (Sr., S.No, 1..n) always equal the row count, so count a real ID instead.
  const rowNumber = (c: (typeof ids)[number]) => /^(s[rl]\.?\s*(no\.?)?|s\.?\s*no\.?|serial(\s*no\.?)?|#|row)$/i.test(c.name.trim()) || c.notes.some((n) => n.startsWith("Consecutive"));
  // An ID that is unique on every row just repeats "Total records", so only count IDs that repeat (customers, accounts…).
  const rowsTotal = table?.rows.length ?? 0;
  const mainId = ids.find((c) => !rowNumber(c) && (profiles[c.key]?.distinct ?? 0) < rowsTotal * 0.98);
  if (domain.domain === "generic" && mainId) add({ name: `Distinct ${mainId.name}`, agg: "countDistinct", columnKey: mainId.key, format: "number", description: `Number of different ${mainId.name} values.` }, "ids");

  const mainDim = [...dims].sort((a, b) => dimScore(b) - dimScore(a))[0];
  function dimScore(c: ColumnSchema) {
    const d = profiles[c.key]?.distinct ?? 0;
    return (c.semantic !== "none" ? 3 : 0) + (d >= 2 && d <= 30 ? 2 : 0) - (profiles[c.key]?.missingPct ?? 0) / 50;
  }
  const mainMeasure = rankedMeasures.find((m) => defaultAgg(m) === "sum");
  if (mainDim) {
    if (domain.domain === "generic" && (profiles[mainDim.key]?.distinct ?? 0) > 12) add({ name: `Distinct ${mainDim.name}`, agg: "countDistinct", columnKey: mainDim.key, format: "number", description: `Number of different ${mainDim.name} values.` }, "dim");
    add({
      name: mainMeasure ? `Top ${mainDim.name} by ${mainMeasure.name}` : `Most common ${mainDim.name}`,
      agg: "topShare",
      columnKey: mainDim.key,
      numerator: mainMeasure ? { agg: "sum", columnKey: mainMeasure.key } : undefined,
      format: "percent",
      description: mainMeasure ? `The ${mainDim.name} with the largest share of total ${mainMeasure.name}.` : `The most frequent ${mainDim.name} and its share of rows.`,
    }, "top");
  }

  add({ name: "Data quality score", agg: "quality", format: "number", description: "0–100 score based on missing values, duplicates, invalid values and problem columns." }, "quality");
  return kpis.slice(0, 10);
}
