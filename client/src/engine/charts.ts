/**
 * Chart recommendation + chart data. Rules are driven by column types and data shape:
 *   date + measure → trend line · category + measure → column/bar · few categories → donut
 *   many categories → treemap · several measures → grouped comparison · numeric → histogram
 *   two correlated numerics → scatter · two categories → stacked / heatmap
 */
import type { ChartSpec, ChartType, ColumnProfile, ColumnSchema, DomainGuess, Table, TimeBucket } from "./types";
import { allRows, defaultAgg, groupBy, pairs, pearson, timeSeries, topN, type Group, type SimpleAgg } from "./analytics";
import { numericStats } from "./profile";
import { isNumericType } from "./table";
import { fmtNumber } from "./format";

let seq = 0;
const cid = () => `ch-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const PREFERRED_DIMS = ["region", "category", "product", "department", "subject", "status", "result", "payment", "gender", "customer"];

export function recommendCharts(schema: ColumnSchema[], profiles: Record<string, ColumnProfile>, domain: DomainGuess, table?: Table): ChartSpec[] {
  const cols = schema.filter((c) => !c.excluded && (profiles[c.key]?.count ?? 0) > 0);
  const n = table?.rows.length ?? 0;
  const measures = cols
    .filter((c) => c.role === "measure" && isNumericType(c))
    .sort((a, b) => mScore(b) - mScore(a));
  function mScore(c: ColumnSchema) {
    const domainPick = (domain.domain === "sales" && c.semantic === "revenue") || (domain.domain === "hr" && c.semantic === "salary") || (domain.domain === "academic" && c.semantic === "score") || (domain.domain === "finance" && c.semantic === "cost");
    return (domainPick ? 10 : 0) + (c.type === "currency" ? 3 : 0) + (c.semantic !== "none" ? 2 : 0) - (profiles[c.key]?.missingPct ?? 0) / 25;
  }
  const dims = cols
    .filter((c) => c.role === "dimension" && c.type !== "text")
    .filter((c) => {
      const d = profiles[c.key]?.distinct ?? 0;
      return d >= 2 && d <= Math.max(60, n * 0.5);
    })
    .sort((a, b) => dScore(b) - dScore(a));
  function dScore(c: ColumnSchema) {
    const d = profiles[c.key]?.distinct ?? 0;
    const pref = PREFERRED_DIMS.indexOf(c.semantic);
    return (pref >= 0 ? 10 - pref : 0) + (d <= 12 ? 3 : d <= 30 ? 1 : -2);
  }
  const distinct = (c?: ColumnSchema) => (c ? (profiles[c.key]?.distinct ?? 0) : 0);
  const time = cols.find((c) => c.role === "time" && c.type === "date" && profiles[c.key]?.dateRange && profiles[c.key]!.dateRange!.days > 1);
  const charts: ChartSpec[] = [];
  const m1 = measures[0];
  const m2 = measures[1];
  const catType = (d: ColumnSchema): ChartType => (distinct(d) <= 8 ? "column" : "bar");

  // 1. Trend of the main measure, and records over time
  if (time) {
    if (m1) charts.push({ id: cid(), type: "line", title: `${m1.name} over time`, x: time.key, y: m1.key, agg: defaultAgg(m1), reason: `${time.name} is a date and ${m1.name} is numeric, so a trend line shows how it changes.`, options: { dots: true } });
    charts.push({ id: cid(), type: m1 ? "area" : "line", title: "Records over time", x: time.key, agg: "count", reason: `Counts rows per period of ${time.name}.` });
  }

  // 2. Several measures compared together (like EBITDA / EBIT / PAT), when they share a unit
  const additive = measures.filter((m) => defaultAgg(m) === "sum");
  const sameUnit = additive.filter((m) => m.type === (additive[0]?.type ?? "number")).slice(0, 4);
  const compareOver = time ?? dims.find((d) => distinct(d) <= 12);
  if (sameUnit.length >= 2 && compareOver) {
    const names = sameUnit.map((m) => m.name);
    charts.push({
      id: cid(),
      type: compareOver.type === "date" ? "column" : "column",
      title: `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]} by ${compareOver.type === "date" ? "period" : compareOver.name}`,
      x: compareOver.key,
      measures: sameUnit.map((m) => m.key),
      agg: "sum",
      reason: `${names.join(", ")} use the same unit, so they can be compared side by side.`,
      options: { top: 12 },
    });
  }

  // 3. Main measure by the main categories
  const d1 = dims[0];
  const d2 = dims[1];
  if (d1) {
    const agg: SimpleAgg = m1 ? defaultAgg(m1) : "count";
    charts.push({ id: cid(), type: catType(d1), title: m1 ? `${agg === "sum" ? "" : "Average "}${m1.name} by ${d1.name}`.trim() : `Rows by ${d1.name}`, x: d1.key, y: m1?.key, agg, reason: `${d1.name} is a category${m1 ? ` and ${m1.name} is a measure` : ""} — bars compare groups.`, options: { top: 12, labels: distinct(d1) <= 8 } });
  }
  // A donut only for a few categories, and only one.
  const fewCats = dims.find((c) => distinct(c) <= 6 && c !== d1) ?? (d1 && distinct(d1) <= 6 ? d1 : undefined);
  const shareMeasure = m1 && defaultAgg(m1) === "sum" ? m1 : undefined;
  if (fewCats) charts.push({ id: cid(), type: "donut", title: `Share by ${fewCats.name}`, x: fewCats.key, y: shareMeasure?.key, agg: shareMeasure ? "sum" : "count", reason: `${fewCats.name} has only ${distinct(fewCats)} values, so a share chart stays readable.` });
  if (d2 && d2 !== fewCats) {
    const agg: SimpleAgg = m1 ? defaultAgg(m1) : "count";
    charts.push({ id: cid(), type: catType(d2), title: m1 ? `${agg === "sum" ? "" : "Average "}${m1.name} by ${d2.name}`.trim() : `Rows by ${d2.name}`, x: d2.key, y: m1?.key, agg, reason: `Compares ${d2.name} groups.`, options: { top: 12 } });
  }
  // Treemap: many categories with an additive measure (e.g. revenue by product / customer)
  const many = dims.find((d) => distinct(d) > 8 && distinct(d) <= 300 && d !== d1);
  if (many && shareMeasure) charts.push({ id: cid(), type: "treemap", title: `${shareMeasure.name} by ${many.name}`, x: many.key, y: shareMeasure.key, agg: "sum", reason: `${many.name} has ${distinct(many)} values; a treemap shows the biggest contributors at a glance.`, options: { top: 20 } });

  // 4. Two categories together
  if (d1 && d2 && distinct(d1) <= 12 && distinct(d2) <= 10) {
    if (m1 && defaultAgg(m1) === "sum") charts.push({ id: cid(), type: "stacked", title: `${m1.name} by ${d1.name} and ${d2.name}`, x: d1.key, series: d2.key, y: m1.key, agg: "sum", reason: `Shows how each ${d1.name} splits across ${d2.name}.` });
    else charts.push({ id: cid(), type: "heatmap", title: `${m1 ? `Average ${m1.name}` : "Rows"} by ${d1.name} × ${d2.name}`, x: d1.key, series: d2.key, y: m1?.key, agg: m1 ? "avg" : "count", reason: `A grid makes combinations of ${d1.name} and ${d2.name} easy to compare.` });
  }

  // 5. Second measure over time (when it isn't already in the comparison)
  if (time && m2 && !sameUnit.includes(m2)) charts.push({ id: cid(), type: "line", title: `${m2.name} over time`, x: time.key, y: m2.key, agg: defaultAgg(m2), reason: `Trend of ${m2.name}, the second most important measure.`, options: { dots: true } });

  // 6. Distribution and relationships
  if (m1 && (profiles[m1.key]?.count ?? 0) >= 20) charts.push({ id: cid(), type: "histogram", title: `Distribution of ${m1.name}`, x: m1.key, agg: "count", reason: `Shows how ${m1.name} values are spread.` });
  if (table && measures.length >= 2) {
    let best: { a: ColumnSchema; b: ColumnSchema; r: number } | null = null;
    const rows = allRows(table);
    for (let i = 0; i < Math.min(measures.length, 6); i++)
      for (let j = i + 1; j < Math.min(measures.length, 6); j++) {
        const { x, y } = pairs(table, rows, measures[i].key, measures[j].key);
        const r = pearson(x, y);
        if (r !== null && Math.abs(r) >= 0.3 && Math.abs(r) < 0.999 && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: measures[i], b: measures[j], r };
      }
    if (best) charts.push({ id: cid(), type: "scatter", title: `${best.b.name} vs ${best.a.name}`, x: best.a.key, y: best.b.key, agg: "count", reason: `${best.a.name} and ${best.b.name} are related (correlation ${best.r.toFixed(2)}).` });
  }
  charts.push({ id: cid(), type: "table", title: "Data preview", agg: "count", limit: 50, reason: "The underlying rows, for checking details." });
  return charts.slice(0, 12);
}

/** Which chart types make sense for a spec (used by the chart-type switcher). */
export function compatibleTypes(spec: ChartSpec, schema: ColumnSchema[]): ChartType[] {
  const x = schema.find((c) => c.key === spec.x);
  if (spec.type === "table" && !x) return ["table"];
  if (spec.type === "scatter") return ["scatter"];
  if (spec.type === "histogram") return ["histogram", "line", "area"];
  const additive = spec.agg === "sum" || spec.agg === "count";
  if (spec.measures && spec.measures.length > 1) return ["column", "bar", "line", "area", "stacked"];
  if (spec.series) return additive ? ["stacked", "column", "heatmap"] : ["column", "heatmap"];
  if (x?.type === "date") return ["line", "area", "column", "bar"];
  // Shares (pie, donut, treemap) only make sense for totals and counts, never for averages.
  return additive ? ["column", "bar", "line", "area", "pie", "donut", "treemap"] : ["column", "bar", "line", "area"];
}

// ── Chart data ──────────────────────────────────────────────

export type ChartData =
  | { kind: "series"; points: { label: string; value: number | null }[]; bucket?: TimeBucket; xLabel: string; yLabel: string; note?: string }
  | { kind: "multi"; labels: string[]; series: { key: string; name: string; values: (number | null)[] }[]; bucket?: TimeBucket; xLabel: string; yLabel: string; note?: string }
  | { kind: "scatter"; points: { x: number; y: number }[]; xLabel: string; yLabel: string; r: number | null; note?: string }
  | { kind: "matrix"; rows: string[]; cols: string[]; values: (number | null)[][]; xLabel: string; seriesLabel: string; yLabel: string; note?: string }
  | { kind: "table"; columns: ColumnSchema[]; rows: (string | null)[][]; total: number }
  | { kind: "empty"; message: string };

export const AGG_LABEL: Record<string, string> = { sum: "Total", avg: "Average", count: "Count", min: "Minimum", max: "Maximum", median: "Median" };

function order(groups: Group[], sort: "value-desc" | "value-asc" | "label" | undefined): Group[] {
  const g = [...groups];
  if (sort === "value-asc") g.sort((a, b) => a.value - b.value);
  else if (sort === "label") g.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  else g.sort((a, b) => b.value - a.value);
  return g;
}

export function buildChartData(spec: ChartSpec, table: Table, rows: number[]): ChartData {
  const col = (k?: string) => table.schema.find((c) => c.key === k);
  const x = col(spec.x);
  const y = col(spec.y);
  const yLabel = y ? `${AGG_LABEL[spec.agg] ?? spec.agg} ${y.name}` : "Rows";
  // Period-like categories (years, FY, quarters) read best in their natural order.
  const periodLike = x ? /year|\bfy\b|period|quarter|month|week/i.test(x.name) : false;
  const opt = { ...spec.options, sort: spec.options?.sort ?? (periodLike && spec.type !== "pie" && spec.type !== "donut" && spec.type !== "treemap" ? ("label" as const) : undefined) };
  if (!rows.length) return { kind: "empty", message: "No rows match the current filters." };

  if (spec.type === "table" && !x) {
    const visible = table.schema.filter((c) => !c.excluded);
    const limit = spec.limit ?? 50;
    return { kind: "table", columns: visible, rows: rows.slice(0, limit).map((i) => visible.map((c) => table.str[c.key][i])), total: rows.length };
  }
  if (!x) return { kind: "empty", message: "This chart's column no longer exists. Edit or remove the chart." };

  // Several measures side by side
  const measureCols = (spec.measures ?? []).map(col).filter((c): c is ColumnSchema => Boolean(c));
  if (measureCols.length > 1) {
    const agg: SimpleAgg = spec.agg === "count" ? "sum" : spec.agg;
    const label = `${AGG_LABEL[agg]} value`;
    if (x.type === "date") {
      const all = measureCols.map((m) => timeSeries(table, rows, x.key, m.key, agg, spec.bucket));
      const base = all[0];
      if (!base.points.length) return { kind: "empty", message: `No valid dates in ${x.name}.` };
      return { kind: "multi", labels: base.points.map((p) => p.label), series: measureCols.map((m, i) => ({ key: m.key, name: m.name, values: all[i].points.map((p) => p.value) })), bucket: base.bucket, xLabel: x.name, yLabel: label };
    }
    const first = order(groupBy(table, rows, x.key, measureCols[0].key, agg), "value-desc");
    const top = opt.top ?? spec.limit ?? 12;
    const cats = order(first.slice(0, top), opt.sort).map((g) => g.key);
    const series = measureCols.map((m) => {
      const g = new Map(groupBy(table, rows, x.key, m.key, agg).map((q) => [q.key, q.value]));
      return { key: m.key, name: m.name, values: cats.map((c) => g.get(c) ?? null) };
    });
    return { kind: "multi", labels: cats, series, xLabel: x.name, yLabel: label, note: first.length > top ? `Top ${top} of ${first.length} ${x.name} shown.` : undefined };
  }

  if (spec.type === "histogram") {
    const values = rows.map((i) => table.num[x.key]?.[i]).filter((v): v is number => v !== null && v !== undefined);
    const stats = numericStats(values);
    if (!stats) return { kind: "empty", message: `No numeric values in ${x.name}.` };
    return { kind: "series", points: stats.histogram.map((b) => ({ label: `${fmtNumber(b.from)}–${fmtNumber(b.to)}`, value: b.count })), xLabel: x.name, yLabel: "Rows" };
  }
  if (spec.type === "scatter") {
    if (!y) return { kind: "empty", message: "Pick a second numeric column." };
    const { x: xs, y: ys } = pairs(table, rows, x.key, y.key);
    const step = Math.max(1, Math.ceil(xs.length / 1500));
    const points = [];
    for (let i = 0; i < xs.length; i += step) points.push({ x: xs[i], y: ys[i] });
    return { kind: "scatter", points, xLabel: x.name, yLabel: y.name, r: pearson(xs, ys), note: step > 1 ? `Showing ${points.length.toLocaleString("en-IN")} of ${xs.length.toLocaleString("en-IN")} points.` : undefined };
  }
  if (x.type === "date") {
    const { bucket, points } = timeSeries(table, rows, x.key, y?.key, spec.agg, spec.bucket);
    if (!points.length) return { kind: "empty", message: `No valid dates in ${x.name}.` };
    return { kind: "series", points: points.map((p) => ({ label: p.label, value: p.value })), bucket, xLabel: x.name, yLabel };
  }
  if (spec.series && (spec.type === "stacked" || spec.type === "heatmap" || spec.type === "column" || spec.type === "table")) {
    const s = col(spec.series);
    if (!s) return { kind: "empty", message: "Pick a second category." };
    const aggForRank: SimpleAgg = y ? (spec.agg === "avg" ? "sum" : spec.agg) : "count";
    const topX = order(groupBy(table, rows, x.key, y?.key, aggForRank).slice(0, opt.top ?? 10), opt.sort).map((g) => g.key);
    const topS = topN(groupBy(table, rows, s.key, y?.key, aggForRank), 8, "max").map((g) => g.key);
    const values = topX.map((xv) => {
      const sub = rows.filter((i) => (table.str[x.key][i] ?? "(blank)") === xv);
      const g = groupBy(table, sub, s.key, y?.key, y ? spec.agg : "count");
      return topS.map((sv) => g.find((q) => q.key === sv)?.value ?? null);
    });
    const hidden = new Set(rows.map((i) => table.str[x.key][i] ?? "(blank)")).size - topX.length;
    return { kind: "matrix", rows: topX, cols: topS, values, xLabel: x.name, seriesLabel: s.name, yLabel, note: hidden > 0 ? `Top ${topX.length} ${x.name} shown.` : undefined };
  }
  const agg: SimpleAgg = y ? spec.agg : "count";
  // "Top N" always means the N largest; the chosen sort then orders them ("Other" stays last).
  const groups = order(groupBy(table, rows, x.key, y?.key, agg), "value-desc");
  const limit = spec.type === "pie" || spec.type === "donut" ? Math.min(opt.top ?? 6, 8) : (opt.top ?? spec.limit ?? 12);
  const top = topN(groups, limit, agg);
  const other = top.length > limit ? top[top.length - 1] : null;
  const shown = [...order(other ? top.slice(0, -1) : top, opt.sort), ...(other ? [other] : [])];
  const note = groups.length > limit ? (agg === "sum" || agg === "count" ? `Top ${limit} ${x.name} shown; the remaining ${groups.length - limit} are grouped as “Other”.` : `Top ${limit} of ${groups.length} ${x.name} shown.`) : undefined;
  return { kind: "series", points: shown.map((g) => ({ label: g.key, value: g.value })), xLabel: x.name, yLabel, note };
}

/** The chart's numbers as rows (for the table view, CSV download and PDF). */
export function chartDataTable(data: ChartData): { headers: string[]; rows: (string | number | null)[][] } | null {
  switch (data.kind) {
    case "series":
      return { headers: [data.xLabel, data.yLabel], rows: data.points.map((p) => [p.label, p.value]) };
    case "multi":
      return { headers: [data.xLabel, ...data.series.map((s) => s.name)], rows: data.labels.map((l, i) => [l, ...data.series.map((s) => s.values[i])]) };
    case "matrix":
      return { headers: [`${data.xLabel} / ${data.seriesLabel}`, ...data.cols], rows: data.rows.map((r, i) => [r, ...data.values[i]]) };
    case "scatter":
      return { headers: [data.xLabel, data.yLabel], rows: data.points.map((p) => [p.x, p.y]) };
    default:
      return null;
  }
}
