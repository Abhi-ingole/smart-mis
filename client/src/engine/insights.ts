/**
 * Deterministic insights: every sentence is built from computed numbers, and each
 * number is listed as evidence. Observations are kept separate from recommendations,
 * and nothing claims a cause.
 */
import type { ColumnProfile, ColumnSchema, DomainGuess, Insight, KpiDef, KpiValue, QualityReport, Recommendation, Table } from "./types";
import { defaultAgg, groupBy, pairs, pearson, timeSeries } from "./analytics";
import { fmtNumber, fmtPercent, fmtValue } from "./format";
import { isNumericType } from "./table";

export interface InsightResult {
  observations: Insight[];
  recommendations: Recommendation[];
}

const pctChange = (a: number, b: number) => (b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);

export function generateInsights(table: Table, rows: number[], profiles: Record<string, ColumnProfile>, quality: QualityReport | undefined, domain: DomainGuess): InsightResult {
  const schema = table.schema.filter((c) => !c.excluded);
  const out: Insight[] = [];
  const recs: Recommendation[] = [];
  let id = 0;
  const push = (i: Omit<Insight, "id">) => {
    const ins = { ...i, id: `i${id++}` };
    out.push(ins);
    return ins;
  };
  if (!rows.length) return { observations: [], recommendations: [] };

  const measures = schema.filter((c) => c.role === "measure" && isNumericType(c) && (profiles[c.key]?.count ?? 0) > 0);
  const primary = [...measures].sort((a, b) => rank(b) - rank(a))[0];
  function rank(c: ColumnSchema) {
    const pick = (domain.domain === "sales" && c.semantic === "revenue") || (domain.domain === "hr" && c.semantic === "salary") || (domain.domain === "academic" && c.semantic === "score") || (domain.domain === "finance" && c.semantic === "cost");
    return (pick ? 10 : 0) + (c.type === "currency" ? 3 : 0) + (c.semantic !== "none" ? 1 : 0);
  }
  const dims = schema.filter((c) => c.role === "dimension" && c.type !== "text" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 100);
  const time = schema.find((c) => c.role === "time" && c.type === "date" && profiles[c.key]?.dateRange);

  // 1. Trend over time
  if (time) {
    const agg = primary ? defaultAgg(primary) : "count";
    const { points, bucket, lastPartial } = timeSeries(table, rows, time.key, primary?.key, agg);
    let valued = points.filter((p) => p.value !== null && p.count > 0);
    const what = primary ? `${agg === "sum" ? "Total" : "Average"} ${primary.name}` : "The number of records";
    const fmt = (v: number) => (primary ? fmtValue(v, primary) : fmtNumber(v));
    if (lastPartial && valued.length >= 3 && valued[valued.length - 1] === points[points.length - 1]) {
      const p = valued[valued.length - 1];
      push({ kind: "missing", text: `${p.label} is only partly covered by the data, so it is left out of period comparisons.`, evidence: [{ label: "Partial period", value: p.label }], importance: 3 });
      valued = valued.slice(0, -1);
    }
    if (valued.length >= 2) {
      const last = valued[valued.length - 1];
      const prev = valued[valued.length - 2];
      const ch = pctChange(last.value!, prev.value!);
      if (ch !== null) {
        const ins = push({
          kind: "change",
          text: `${what} was ${fmt(last.value!)} in ${last.label}, ${ch >= 0 ? "up" : "down"} ${fmtPercent(Math.abs(ch))} from ${fmt(prev.value!)} in ${prev.label}.`,
          evidence: [
            { label: last.label, value: fmt(last.value!) },
            { label: prev.label, value: fmt(prev.value!) },
            { label: "Change", value: fmtPercent(Math.abs(ch)) },
          ],
          importance: Math.min(10, 4 + Math.abs(ch) / 10),
        });
        if (ch <= -15) recs.push({ id: `r${recs.length}`, text: `Review what changed in ${last.label}: ${what.toLowerCase()} fell ${fmtPercent(Math.abs(ch))} versus ${prev.label}. Check whether that period's data is complete first.`, basedOn: ins.id });
      }
      if (valued.length >= 3) {
        const peak = valued.reduce((a, b) => (b.value! > a.value! ? b : a));
        const low = valued.reduce((a, b) => (b.value! < a.value! ? b : a));
        push({
          kind: "trend",
          text: `Across ${valued.length} ${bucket}s with data, ${what.toLowerCase()} peaked in ${peak.label} (${fmt(peak.value!)}) and was lowest in ${low.label} (${fmt(low.value!)}).`,
          evidence: [
            { label: `Peak (${peak.label})`, value: fmt(peak.value!) },
            { label: `Lowest (${low.label})`, value: fmt(low.value!) },
            { label: `${bucket}s with data`, value: String(valued.length) },
          ],
          importance: 5,
        });
      }
      const gaps = points.filter((p) => p.count === 0).length;
      if (gaps > 0 && points.length > 2) {
        push({ kind: "missing", text: `${gaps} of ${points.length} ${bucket}s between the first and last date have no records.`, evidence: [{ label: `Empty ${bucket}s`, value: String(gaps) }, { label: `Total ${bucket}s`, value: String(points.length) }], importance: 3 });
      }
    }
  }

  // 2. Top / bottom categories and concentration
  const PREF = ["region", "category", "product", "department", "subject", "status", "result", "payment", "gender"];
  const rankedDims = dims
    .filter((d) => (profiles[d.key]?.distinct ?? 0) <= 30)
    .sort((a, b) => (PREF.includes(b.semantic) ? 1 : 0) - (PREF.includes(a.semantic) ? 1 : 0) || (profiles[a.key]?.distinct ?? 0) - (profiles[b.key]?.distinct ?? 0));
  for (const d of rankedDims.slice(0, 2)) {
    const useSum = primary && defaultAgg(primary) === "sum";
    const groups = groupBy(table, rows, d.key, useSum ? primary!.key : undefined, useSum ? "sum" : "count").filter((g) => g.key !== "(blank)");
    if (groups.length < 2) continue;
    const total = groups.reduce((a, g) => a + g.value, 0);
    if (total <= 0) continue;
    const top = groups[0];
    const bottom = groups[groups.length - 1];
    const share = (top.value / total) * 100;
    const fmt = (v: number) => (useSum ? fmtValue(v, primary) : fmtNumber(v));
    const metric = useSum ? primary!.name : "rows";
    const ins = push({
      kind: share >= 50 ? "concentration" : "top",
      text: `${top.key} leads ${d.name} with ${fmt(top.value)} ${useSum ? `of ${metric}` : "rows"} — ${fmtPercent(share)} of the total across ${groups.length} ${d.name} values.`,
      evidence: [
        { label: top.key, value: fmt(top.value) },
        { label: "Share of total", value: fmtPercent(share) },
        { label: `${d.name} values`, value: String(groups.length) },
      ],
      importance: share >= 50 ? 8 : 6,
    });
    if (share >= 50 && groups.length >= 3) recs.push({ id: `r${recs.length}`, text: `${top.key} accounts for ${fmtPercent(share)} of ${metric}. Consider how dependent results are on this single ${d.name}.`, basedOn: ins.id });
    if (groups.length >= 3) {
      const bshare = (bottom.value / total) * 100;
      push({ kind: "bottom", text: `${bottom.key} is the smallest ${d.name}, with ${fmt(bottom.value)} (${fmtPercent(bshare)} of the total).`, evidence: [{ label: bottom.key, value: fmt(bottom.value) }, { label: "Share", value: fmtPercent(bshare) }], importance: 4 });
    }
    // Averages differ meaningfully between groups (for averaged measures)
    if (primary && defaultAgg(primary) === "avg") {
      const avg = groupBy(table, rows, d.key, primary.key, "avg").filter((g) => g.key !== "(blank)" && g.count >= 3);
      if (avg.length >= 2) {
        const hi = avg[0];
        const lo = avg[avg.length - 1];
        push({ kind: "top", text: `Average ${primary.name} is highest for ${hi.key} (${fmtValue(hi.value, primary)}) and lowest for ${lo.key} (${fmtValue(lo.value, primary)}).`, evidence: [{ label: hi.key, value: fmtValue(hi.value, primary) }, { label: lo.key, value: fmtValue(lo.value, primary) }], importance: 6 });
      }
    }
  }

  // 3. Distribution shape and outliers
  for (const m of measures.slice(0, 4)) {
    const s = profiles[m.key]?.numeric;
    if (!s) continue;
    if (s.outliers > 0) {
      const ins = push({
        kind: "outlier",
        text: `${m.name} has ${fmtNumber(s.outliers)} unusual value(s) outside the typical range of ${fmtValue(s.q1, m)} to ${fmtValue(s.q3, m)} (middle half of the data); the largest is ${fmtValue(s.max, m)}.`,
        evidence: [
          { label: "Unusual values", value: fmtNumber(s.outliers) },
          { label: "25th percentile", value: fmtValue(s.q1, m) },
          { label: "75th percentile", value: fmtValue(s.q3, m) },
          { label: "Maximum", value: fmtValue(s.max, m) },
        ],
        importance: 5,
      });
      recs.push({ id: `r${recs.length}`, text: `Check the ${fmtNumber(s.outliers)} unusual ${m.name} value(s) for entry errors before relying on the average.`, basedOn: ins.id });
    }
    if (Math.abs(s.skew) > 1 && s.mean !== 0) {
      push({
        kind: "distribution",
        text: `${m.name} is ${s.skew > 0 ? "skewed by a few large values" : "skewed by a few small values"}: the median is ${fmtValue(s.median, m)} while the average is ${fmtValue(s.mean, m)}.`,
        evidence: [{ label: "Median", value: fmtValue(s.median, m) }, { label: "Average", value: fmtValue(s.mean, m) }],
        importance: 4,
      });
    }
  }

  // 4. Strong relationships between measures (correlation, not causation)
  const ms = measures.slice(0, 6);
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++) {
      const { x, y } = pairs(table, rows, ms[i].key, ms[j].key);
      const r = pearson(x, y);
      if (r !== null && Math.abs(r) >= 0.7 && Math.abs(r) < 0.999) {
        push({ kind: "correlation", text: `${ms[i].name} and ${ms[j].name} move ${r > 0 ? "together" : "in opposite directions"} (correlation ${r.toFixed(2)}). This shows association, not cause.`, evidence: [{ label: "Correlation", value: r.toFixed(2) }, { label: "Rows compared", value: fmtNumber(x.length) }], importance: 5 });
      }
    }

  // 5. Data quality
  if (quality) {
    const missingCols = schema.filter((c) => (profiles[c.key]?.missingPct ?? 0) >= 5);
    for (const c of missingCols.slice(0, 3)) {
      const p = profiles[c.key]!;
      const ins = push({ kind: "missing", text: `${c.name} is missing in ${fmtNumber(p.missing)} rows (${fmtPercent(p.missingPct)}), so results that use it cover fewer records.`, evidence: [{ label: "Missing rows", value: fmtNumber(p.missing) }, { label: "Missing %", value: fmtPercent(p.missingPct) }], importance: p.missingPct >= 20 ? 7 : 4 });
      recs.push({ id: `r${recs.length}`, text: `Fill or collect the missing ${c.name} values (${fmtPercent(p.missingPct)} empty) — see Data Quality for fill options.`, basedOn: ins.id });
    }
    if (quality.duplicateRows > 0) {
      const ins = push({ kind: "quality", text: `${fmtNumber(quality.duplicateRows)} row(s) are exact duplicates of other rows and are counted in totals.`, evidence: [{ label: "Duplicate rows", value: fmtNumber(quality.duplicateRows) }], importance: 6 });
      recs.push({ id: `r${recs.length}`, text: `Inspect the ${fmtNumber(quality.duplicateRows)} duplicate row(s); remove them if they are accidental copies so totals aren't inflated.`, basedOn: ins.id });
    }
  }

  out.sort((a, b) => b.importance - a.importance);
  return { observations: out.slice(0, 12), recommendations: recs.slice(0, 6) };
}

/** Compact, number-carrying summary for the optional AI layer (no raw rows). */
export function buildFacts(name: string, table: Table, rows: number[], domain: DomainGuess, kpiDefs: KpiDef[], kpiValues: KpiValue[], insights: InsightResult, quality?: QualityReport) {
  const visible = table.schema.filter((c) => !c.excluded);
  return {
    dataset: name,
    rows: rows.length,
    columns: visible.map((c) => ({ name: c.name, type: c.type, role: c.role })),
    detected_domain: domain.domain === "generic" ? "not determined" : domain.label,
    kpis: kpiDefs.map((d) => {
      const v = kpiValues.find((k) => k.id === d.id);
      return { name: d.name, value: v?.display ?? "—", formula: v?.formula, ...(v?.comparison ? { comparison: `${v.comparison.label}: ${v.comparison.changePct === null ? "n/a" : fmtPercent(Math.abs(v.comparison.changePct)) + (v.comparison.direction === "down" ? " lower" : " higher")}` } : {}) };
    }),
    observations: insights.observations.map((o) => o.text),
    data_quality: quality ? { score: quality.score, duplicate_rows: quality.duplicateRows, completeness: fmtPercent(quality.completeness) } : undefined,
  };
}
