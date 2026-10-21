import { useMemo } from "react";
import type { DatasetRecord, Filters } from "../engine/types";
import type { Analysis } from "../engine/pipeline";
import { allRows } from "../engine/analytics";
import { filterRows } from "../engine/table";
import { evaluateKpis } from "../engine/kpi";
import { generateInsights } from "../engine/insights";
import { parseDate } from "../engine/values";

export const EMPTY_FILTERS: Filters = { categories: {} };

export function isoToDay(s: string) {
  return parseDate(s) ?? 0;
}

export function filtersActive(f: Filters) {
  return Object.values(f.categories).some((v) => v.length) || Boolean(f.dateFrom || f.dateTo);
}

export function describeFilters(f: Filters, record: DatasetRecord): string | null {
  const name = (k: string) => record.schema.find((c) => c.key === k)?.name ?? k;
  const parts = Object.entries(f.categories)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${name(k)}: ${v.length > 3 ? `${v.slice(0, 3).join(", ")} +${v.length - 3}` : v.join(", ")}`);
  if (f.dateColumn && (f.dateFrom || f.dateTo)) parts.push(`${name(f.dateColumn)}: ${f.dateFrom ?? "start"} to ${f.dateTo ?? "end"}`);
  return parts.length ? parts.join("; ") : null;
}

/** One place that turns (dataset, analysis, filters) into rows, KPI values and insights. */
export function useView(record: DatasetRecord, analysis: Analysis, filters: Filters) {
  const rows = useMemo(() => (filtersActive(filters) ? filterRows(analysis.table, filters, isoToDay) : allRows(analysis.table)), [analysis.table, filters]);
  const timeKey = useMemo(() => record.schema.find((c) => c.role === "time" && c.type === "date" && !c.excluded && analysis.profiles[c.key]?.dateRange)?.key, [record.schema, analysis.profiles]);
  const kpiValues = useMemo(() => evaluateKpis(record.dashboard.kpis, analysis.table, rows, { quality: analysis.quality }, timeKey), [record.dashboard.kpis, analysis, rows, timeKey]);
  const insights = useMemo(() => generateInsights(analysis.table, rows, analysis.profiles, analysis.quality, analysis.domain), [analysis, rows]);
  return { rows, kpiValues, insights, timeKey };
}
