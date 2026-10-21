/**
 * Chart recommendation + chart data. Rules are driven by column types and data shape:
 *   date + measure → trend line · category + measure → bar · few categories → donut
 *   numeric → histogram · two correlated numerics → scatter · two categories → stacked bar / heatmap
 */
import type { ChartSpec, ChartType, ColumnProfile, ColumnSchema, DomainGuess, Table, TimeBucket } from "./types";
import { allRows, defaultAgg, groupBy, pairs, pearson, timeSeries, topN, type SimpleAgg } from "./analytics";
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
  const time = cols.find((c) => c.role === "time" && c.type === "date" && profiles[c.key]?.dateRange && profiles[c.key]!.dateRange!.days > 1);
  const charts: ChartSpec[] = [];
  const m1 = measures[0];
  const m2 = measures[1];

  if (time) {
    if (m1) charts.push({ id: cid(), type: "line", title: `${m1.name} over time`, x: time.key, y: m1.key, agg: defaultAgg(m1), reason: `${time.name} is a date and ${m1.name} is numeric, so a trend line shows how it changes.` });
    charts.push({ id: cid(), type: m1 ? "area" : "line", title: `Records over time`, x: time.key, agg: "count", reason: `Counts rows per period of ${time.name}.` });
  }
  const d1 = dims[0];
  const d2 = dims[1];
  if (d1) {
    const agg: SimpleAgg = m1 ? defaultAgg(m1) : "count";
    charts.push({ id: cid(), type: "bar", title: m1 ? `${agg === "sum" ? "" : "Average "}${m1.name} by ${d1.name}`.trim() : `Rows by ${d1.name}`, x: d1.key, y: m1?.key, agg, limit: 12, reason: `${d1.name} is a category${m1 ? ` and ${m1.name} is a measure` : ""} — bars compare groups.` });
  }
  // A donut only for a few categories, and only one.
  const fewCats = dims.find((c) => (profiles[c.key]?.distinct ?? 0) <= 6 && c !== d1) ?? (d1 && (profiles[d1.key]?.distinct ?? 0) <= 6 ? d1 : undefined);
  if (fewCats) charts.push({ id: cid(), type: "donut", title: `Share by ${fewCats.name}`, x: fewCats.key, y: m1 && defaultAgg(m1) === "sum" ? m1.key : undefined, agg: m1 && defaultAgg(m1) === "sum" ? "sum" : "count", reason: `${fewCats.name} has only ${profiles[fewCats.key]?.distinct} values, so a share chart stays readable.` });
  if (d2 && d2 !== fewCats) {
    const agg: SimpleAgg = m1 ? defaultAgg(m1) : "count";
    charts.push({ id: cid(), type: "bar", title: m1 ? `${agg === "sum" ? "" : "Average "}${m1.name} by ${d2.name}`.trim() : `Rows by ${d2.name}`, x: d2.key, y: m1?.key, agg, limit: 12, reason: `Compares ${d2.name} groups.` });
  }
  if (d1 && d2 && (profiles[d1.key]?.distinct ?? 0) <= 12 && (profiles[d2.key]?.distinct ?? 0) <= 10) {
    if (m1 && defaultAgg(m1) === "sum") charts.push({ id: cid(), type: "stacked", title: `${m1.name} by ${d1.name} and ${d2.name}`, x: d1.key, series: d2.key, y: m1.key, agg: "sum", reason: `Shows how each ${d1.name} splits across ${d2.name}.` });
    else charts.push({ id: cid(), type: "heatmap", title: `${m1 ? `Average ${m1.name}` : "Rows"} by ${d1.name} × ${d2.name}`, x: d1.key, series: d2.key, y: m1?.key, agg: m1 ? "avg" : "count", reason: `A grid makes combinations of ${d1.name} and ${d2.name} easy to compare.` });
  }
  if (m1) charts.push({ id: cid(), type: "histogram", title: `Distribution of ${m1.name}`, x: m1.key, agg: "count", reason: `Shows how ${m1.name} values are spread.` });
  // Scatter only for a meaningful relationship.
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
  } else if (m2 && !table) {
    charts.push({ id: cid(), type: "scatter", title: `${m2.name} vs ${m1!.name}`, x: m1!.key, y: m2.key, agg: "count", reason: "Two numeric columns." });
  }
  charts.push({ id: cid(), type: "table", title: "Data preview", agg: "count", limit: 50, reason: "The underlying rows, for checking details." });
  return charts.slice(0, 9);
}

/** Which chart types make sense for a spec's columns (used by the customise menu). */
export function compatibleTypes(spec: ChartSpec, schema: ColumnSchema[]): ChartType[] {
  const x = schema.find((c) => c.key === spec.x);
  if (spec.type === "table") return ["table"];
  if (!x) return [spec.type];
  if (x.type === "date") return ["line", "area", "bar"];
  if (spec.type === "scatter") return ["scatter"];
  if (spec.type === "histogram") return ["histogram"];
  if (spec.series) return spec.agg === "sum" || spec.agg === "count" ? ["stacked", "heatmap"] : ["heatmap"];
  // Shares only make sense for totals and counts, never for averages.
  return spec.agg === "sum" || spec.agg === "count" ? ["bar", "donut", "pie"] : ["bar"];
}

// ── Chart data ──────────────────────────────────────────────

export type ChartData =
  | { kind: "series"; points: { label: string; value: number | null }[]; bucket?: TimeBucket; xLabel: string; yLabel: string; note?: string }
  | { kind: "scatter"; points: { x: number; y: number }[]; xLabel: string; yLabel: string; r: number | null; note?: string }
  | { kind: "matrix"; rows: string[]; cols: string[]; values: (number | null)[][]; xLabel: string; seriesLabel: string; yLabel: string; note?: string }
  | { kind: "table"; columns: ColumnSchema[]; rows: (string | null)[][]; total: number }
  | { kind: "empty"; message: string };

const AGG_LABEL: Record<string, string> = { sum: "Total", avg: "Average", count: "Count", min: "Minimum", max: "Maximum", median: "Median" };

export function buildChartData(spec: ChartSpec, table: Table, rows: number[]): ChartData {
  const col = (k?: string) => table.schema.find((c) => c.key === k);
  const x = col(spec.x);
  const y = col(spec.y);
  const yLabel = y ? `${AGG_LABEL[spec.agg] ?? spec.agg} ${y.name}` : "Rows";
  if (!rows.length) return { kind: "empty", message: "No rows match the current filters." };

  if (spec.type === "table") {
    const visible = table.schema.filter((c) => !c.excluded);
    const limit = spec.limit ?? 50;
    return { kind: "table", columns: visible, rows: rows.slice(0, limit).map((i) => visible.map((c) => table.str[c.key][i])), total: rows.length };
  }
  if (!x) return { kind: "empty", message: "This chart's column no longer exists. Edit or remove the chart." };

  if (spec.type === "histogram") {
    const values = rows.map((i) => table.num[x.key]?.[i]).filter((v): v is number => v !== null && v !== undefined);
    const stats = numericStats(values);
    if (!stats) return { kind: "empty", message: `No numeric values in ${x.name}.` };
    return {
      kind: "series",
      points: stats.histogram.map((b) => ({ label: `${fmtNumber(b.from)}–${fmtNumber(b.to)}`, value: b.count })),
      xLabel: x.name,
      yLabel: "Rows",
    };
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
  if (spec.type === "stacked" || spec.type === "heatmap") {
    const s = col(spec.series);
    if (!s) return { kind: "empty", message: "Pick a second category." };
    const topX = topN(groupBy(table, rows, x.key, y?.key, y ? (spec.agg === "avg" ? "sum" : spec.agg) : "count"), 10, "max").map((g) => g.key);
    const topS = topN(groupBy(table, rows, s.key, y?.key, y ? (spec.agg === "avg" ? "sum" : spec.agg) : "count"), 8, "max").map((g) => g.key);
    const values = topX.map((xv) => {
      const sub = rows.filter((i) => (table.str[x.key][i] ?? "(blank)") === xv);
      const g = groupBy(table, sub, s.key, y?.key, y ? spec.agg : "count");
      return topS.map((sv) => g.find((q) => q.key === sv)?.value ?? null);
    });
    const hidden = new Set(rows.map((i) => table.str[x.key][i] ?? "(blank)")).size - topX.length;
    return { kind: "matrix", rows: topX, cols: topS, values, xLabel: x.name, seriesLabel: s.name, yLabel, note: hidden > 0 ? `Top ${topX.length} ${x.name} shown.` : undefined };
  }
  const agg: SimpleAgg = y ? spec.agg : "count";
  const groups = groupBy(table, rows, x.key, y?.key, agg);
  const limit = spec.type === "pie" || spec.type === "donut" ? 6 : (spec.limit ?? 12);
  const shown = topN(groups, limit, agg);
  const note = groups.length > limit ? (agg === "sum" || agg === "count" ? `Top ${limit} ${x.name} shown; the remaining ${groups.length - limit} are grouped as “Other”.` : `Top ${limit} of ${groups.length} ${x.name} shown.`) : undefined;
  return { kind: "series", points: shown.map((g) => ({ label: g.key, value: g.value })), xLabel: x.name, yLabel, note };
}
