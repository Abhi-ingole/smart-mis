/**
 * MIS report model. The same numbers as the dashboard (same engine functions),
 * arranged in report sections. Sections adapt: no date column → no reporting period.
 */
import type { ChartSpec, ColumnProfile, DashboardConfig, DatasetMeta, KpiValue, QualityReport, Table } from "./types";
import type { InsightResult } from "./insights";
import { defaultAgg, groupBy } from "./analytics";
import { fmtDate, fmtNumber, fmtPercent, fmtValue } from "./format";
import { isNumericType } from "./table";

export const REPORT_SECTIONS = [
  { id: "summary", title: "Executive summary" },
  { id: "overview", title: "Dataset overview" },
  { id: "kpis", title: "Key performance indicators" },
  { id: "trends", title: "Trends and visual analysis" },
  { id: "categories", title: "Category analysis" },
  { id: "exceptions", title: "Exceptions and anomalies" },
  { id: "quality", title: "Data quality summary" },
  { id: "insights", title: "Key insights" },
  { id: "recommendations", title: "Recommendations" },
  { id: "appendix", title: "Detailed data appendix" },
] as const;

export type SectionId = (typeof REPORT_SECTIONS)[number]["id"];

export interface CategoryTable {
  title: string;
  dimension: string;
  measure: string;
  rows: { label: string; value: string; share: string }[];
}

export interface ReportModel {
  title: string;
  generatedAt: string;
  period: { from: string; to: string; column: string } | null;
  periodNote: string;
  executiveSummary: string[];
  overview: { label: string; value: string }[];
  columns: { name: string; type: string; role: string; missing: string }[];
  kpis: { name: string; value: string; formula: string; comparison?: string; description: string }[];
  charts: ChartSpec[];
  categories: CategoryTable[];
  exceptions: string[];
  quality: { score: number; formula: string; issues: { severity: string; message: string }[] };
  insights: string[];
  recommendations: string[];
  appendix: { headers: string[]; rows: (string | null)[][]; total: number };
  filtersNote: string | null;
}

export function buildReport(args: {
  meta: Pick<DatasetMeta, "name" | "fileName" | "sheetName" | "domain">;
  title?: string;
  table: Table;
  rows: number[];
  profiles: Record<string, ColumnProfile>;
  quality: QualityReport;
  dashboard: DashboardConfig;
  kpiValues: KpiValue[];
  insights: InsightResult;
  filtersNote?: string | null;
  appendixRows?: number;
}): ReportModel {
  const { meta, table, rows, profiles, quality, dashboard, kpiValues, insights } = args;
  const visible = table.schema.filter((c) => !c.excluded);
  const time = visible.find((c) => c.role === "time" && c.type === "date" && profiles[c.key]?.dateRange);
  let period: ReportModel["period"] = null;
  if (time) {
    const t = table.num[time.key];
    let min = Infinity;
    let max = -Infinity;
    for (const i of rows) {
      const d = t[i];
      if (d === null) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    if (Number.isFinite(min)) {
      const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
      period = { from: iso(min), to: iso(max), column: time.name };
    }
  }
  const periodNote = period ? `${fmtDate(period.from)} to ${fmtDate(period.to)} (based on ${period.column})` : "No date column was found, so no reporting period is stated.";

  const kpis = dashboard.kpis.map((d) => {
    const v = kpiValues.find((k) => k.id === d.id);
    const c = v?.comparison;
    return {
      name: d.name,
      value: v?.display ?? "—",
      formula: v?.formula ?? "",
      description: d.description,
      comparison: c ? `${c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : "No change"}${c.changePct !== null && c.direction !== "flat" ? ` ${fmtPercent(Math.abs(c.changePct))}` : ""} (${c.label})` : undefined,
    };
  });

  const measures = visible.filter((c) => c.role === "measure" && isNumericType(c));
  const primary = measures.find((m) => defaultAgg(m) === "sum") ?? measures[0];
  const dims = visible.filter((c) => c.role === "dimension" && c.type !== "text" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 100);
  const categories: CategoryTable[] = dims.slice(0, 3).map((d) => {
    const useSum = primary && defaultAgg(primary) === "sum";
    const groups = groupBy(table, rows, d.key, useSum ? primary.key : undefined, useSum ? "sum" : "count");
    const total = groups.reduce((a, g) => a + g.value, 0) || 1;
    return {
      title: useSum ? `${primary.name} by ${d.name}` : `Rows by ${d.name}`,
      dimension: d.name,
      measure: useSum ? `Total ${primary.name}` : "Rows",
      rows: groups.slice(0, 15).map((g) => ({ label: g.key, value: useSum ? fmtValue(g.value, primary) : fmtNumber(g.value), share: fmtPercent((g.value / total) * 100) })),
    };
  });

  const exceptions = insights.observations.filter((o) => o.kind === "outlier" || o.kind === "change" || o.kind === "concentration").map((o) => o.text);
  const keyKpis = kpis.filter((k) => k.value !== "—").slice(0, 4);
  const executiveSummary = [
    `${meta.name} contains ${fmtNumber(rows.length)} records across ${visible.length} columns${period ? `, covering ${fmtDate(period.from)} to ${fmtDate(period.to)}` : ""}.`,
    ...(keyKpis.length ? [`Headline figures: ${keyKpis.map((k) => `${k.name} ${k.value}`).join("; ")}.`] : []),
    ...insights.observations.slice(0, 2).map((o) => o.text),
    `Data quality score is ${quality.score}/100.`,
  ];

  const limit = args.appendixRows ?? 100;
  return {
    title: args.title?.trim() || `${meta.name} — MIS Report`,
    generatedAt: new Date().toISOString(),
    period,
    periodNote,
    executiveSummary,
    overview: [
      { label: "Source file", value: meta.fileName + (meta.sheetName && meta.sheetName !== meta.fileName.replace(/\.[^.]+$/, "") ? ` (sheet: ${meta.sheetName})` : "") },
      { label: "Records analysed", value: fmtNumber(rows.length) },
      { label: "Columns analysed", value: String(visible.length) },
      { label: "Detected data type", value: meta.domain.domain === "generic" ? "General data (no specific domain detected)" : meta.domain.label },
      { label: "Reporting period", value: periodNote },
    ],
    columns: visible.map((c) => ({ name: c.name, type: c.type, role: c.role, missing: fmtPercent(profiles[c.key]?.missingPct ?? 0) })),
    kpis,
    charts: dashboard.charts.filter((c) => c.type !== "table"),
    categories,
    exceptions,
    quality: { score: quality.score, formula: quality.scoreFormula, issues: quality.issues.slice(0, 12).map((i) => ({ severity: i.severity, message: i.message })) },
    insights: insights.observations.map((o) => o.text),
    recommendations: insights.recommendations.map((r) => r.text),
    appendix: { headers: visible.map((c) => c.name), rows: rows.slice(0, limit).map((i) => visible.map((c) => table.str[c.key][i])), total: rows.length },
    filtersNote: args.filtersNote ?? null,
  };
}
