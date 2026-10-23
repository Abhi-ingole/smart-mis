import { useMemo } from "react";
import type { DatasetRecord, Filters } from "../engine/types";
import type { Analysis } from "../engine/pipeline";
import { allRows } from "../engine/analytics";
import { filterRows } from "../engine/table";
import { computeKpi, evaluateKpis } from "../engine/kpi";
import { priorPeriod, rowsIn, type PeriodOption } from "../engine/executive";
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

export const findTimeKey = (record: DatasetRecord, analysis: Analysis) => record.schema.find((c) => c.role === "time" && c.type === "date" && !c.excluded && analysis.profiles[c.key]?.dateRange)?.key;

/**
 * One place that turns (dataset, analysis, filters, selected year) into rows, KPI values and insights.
 * With a year selected, KPIs are compared with the same stretch of the previous year
 * (like-for-like: if the year has data up to August, last year is cut at August too).
 */
export function useView(record: DatasetRecord, analysis: Analysis, filters: Filters, period: PeriodOption | null = null) {
  const allFiltered = useMemo(() => (filtersActive(filters) ? filterRows(analysis.table, filters, isoToDay) : allRows(analysis.table)), [analysis.table, filters]);
  const timeKey = useMemo(() => findTimeKey(record, analysis), [record, analysis]);
  const rows = useMemo(() => (period && timeKey ? rowsIn(analysis.table, allFiltered, timeKey, period) : allFiltered), [analysis.table, allFiltered, timeKey, period]);
  const prior = useMemo(() => {
    if (!period || !timeKey) return null;
    const t = analysis.table.num[timeKey];
    let last = -Infinity;
    for (const i of rows) {
      const d = t[i];
      if (d !== null && d !== undefined && d > last) last = d;
    }
    if (!Number.isFinite(last)) return null;
    const p = priorPeriod(period);
    const full = last >= period.end - 1;
    const end = full ? p.end : p.start + (last - period.start) + 1;
    const r = rowsIn(analysis.table, allFiltered, timeKey, { start: p.start, end });
    return r.length ? { rows: r, label: full ? "vs previous year" : "vs same period last year" } : null;
  }, [analysis.table, allFiltered, timeKey, period, rows]);
  const kpiValues = useMemo(() => {
    const ctx = { quality: analysis.quality };
    const vals = evaluateKpis(record.dashboard.kpis, analysis.table, rows, ctx, timeKey);
    if (!period) return vals;
    return vals.map((v, i) => {
      const def = record.dashboard.kpis[i];
      if (!prior || def.agg === "quality" || def.agg === "topShare" || def.agg === "missingPct") return { ...v, comparison: undefined };
      const before = computeKpi(def, analysis.table, prior.rows, ctx).value;
      if (v.value === null || before === null) return { ...v, comparison: undefined };
      const changePct = before !== 0 ? ((v.value - before) / Math.abs(before)) * 100 : null;
      return { ...v, comparison: { label: prior.label, previous: before, changePct, direction: v.value > before ? "up" : v.value < before ? "down" : "flat" } as const };
    });
  }, [record.dashboard.kpis, analysis, rows, timeKey, period, prior]);
  const insights = useMemo(() => generateInsights(analysis.table, rows, analysis.profiles, analysis.quality, analysis.domain), [analysis, rows]);
  return { rows, allRows: allFiltered, kpiValues, insights, timeKey, prior };
}
