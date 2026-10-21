/** Column profiling and data quality checks (all deterministic). */
import type { ColumnProfile, ColumnSchema, NumericStats, QualityIssue, QualityReport, Table } from "./types";
import { epochDayToIso } from "./values";
import { isNumericType } from "./table";

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function numericStats(values: number[]): NumericStats | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let sq = 0;
  let cube = 0;
  for (const v of sorted) {
    sq += (v - mean) ** 2;
    cube += (v - mean) ** 3;
  }
  const std = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  let outlierLow = 0;
  let outlierHigh = 0;
  if (iqr > 0 && n >= 8) for (const v of sorted) v < lowFence ? outlierLow++ : v > highFence ? outlierHigh++ : 0;
  const skew = n > 2 && std > 0 ? cube / n / std ** 3 : 0;
  // Histogram: Freedman–Diaconis-ish bin count, clamped 5–20.
  const min = sorted[0];
  const max = sorted[n - 1];
  const bins = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(n))));
  const width = max > min ? (max - min) / bins : 1;
  const histogram = Array.from({ length: max > min ? bins : 1 }, (_, i) => ({ from: min + i * width, to: max > min ? min + (i + 1) * width : max, count: 0 }));
  for (const v of sorted) {
    const idx = max > min ? Math.min(bins - 1, Math.floor((v - min) / width)) : 0;
    histogram[idx].count++;
  }
  return { sum, mean, median: quantile(sorted, 0.5), min, max, std, q1, q3, outliers: outlierLow + outlierHigh, outlierLow, outlierHigh, skew, histogram };
}

export function profileColumn(table: Table, col: ColumnSchema): ColumnProfile {
  const str = table.str[col.key];
  const total = str.length;
  const counts = new Map<string, number>();
  let count = 0;
  for (const v of str) {
    if (v === null) continue;
    count++;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const missing = total - count;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, c]) => ({ value, count: c }));
  const profile: ColumnProfile = {
    key: col.key,
    count,
    missing,
    missingPct: total ? (missing / total) * 100 : 0,
    distinct: counts.size,
    uniqueRatio: count ? counts.size / count : 0,
    invalid: 0,
    top,
    sample: [...counts.keys()].slice(0, 5),
  };
  const nums = table.num[col.key];
  if (nums) {
    const valid = nums.filter((v): v is number => v !== null);
    profile.invalid = count - valid.length;
    if (col.type === "date" && valid.length) {
      let min = Infinity;
      let max = -Infinity;
      for (const v of valid) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      profile.dateRange = { min: epochDayToIso(min), max: epochDayToIso(max), days: max - min + 1 };
    } else if (isNumericType(col)) {
      profile.numeric = numericStats(valid);
    }
  }
  return profile;
}

export function profileTable(table: Table): Record<string, ColumnProfile> {
  return Object.fromEntries(table.schema.map((c) => [c.key, profileColumn(table, c)]));
}

/**
 * Quality score = 100 − penalties, where:
 *   missing cells:   up to 40 pts (missing % × 2, capped)
 *   duplicate rows:  up to 25 pts (duplicate % × 2.5, capped)
 *   invalid values:  up to 20 pts (invalid % × 2, capped)
 *   mixed/constant/empty columns: 3 pts each, up to 15
 */
export const QUALITY_FORMULA = "100 − min(40, 2 × missing%) − min(25, 2.5 × duplicate-row%) − min(20, 2 × invalid-value%) − min(15, 3 × problem columns)";

export function assessQuality(table: Table, profiles: Record<string, ColumnProfile>): QualityReport {
  const cols = table.schema.filter((c) => !c.excluded);
  const rows = table.rows;
  const n = rows.length;
  const issues: QualityIssue[] = [];

  // Exact duplicate rows (all columns, before exclusions — that's what "duplicate record" means).
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = JSON.stringify(r);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const duplicateRows = dupGroups.reduce((a, g) => a + g.length - 1, 0);
  if (duplicateRows > 0) {
    issues.push({
      id: "dup-rows",
      severity: duplicateRows / n > 0.05 ? "high" : "medium",
      kind: "duplicates",
      message: `${duplicateRows.toLocaleString("en-IN")} duplicate row(s) — exact copies of another row (${dupGroups.length.toLocaleString("en-IN")} group(s)).`,
      affectedRows: duplicateRows,
      suggestion: "Review them, then use “Remove duplicate rows” if they are accidental copies.",
    });
  }

  let missingCells = 0;
  let invalidCells = 0;
  let problemCols = 0;
  for (const c of cols) {
    const p = profiles[c.key];
    if (!p) continue;
    missingCells += p.missing;
    invalidCells += p.invalid;
    if (p.count === 0) {
      problemCols++;
      issues.push({ id: `empty-${c.key}`, severity: "medium", kind: "empty-column", columnKey: c.key, message: `"${c.name}" is completely empty.`, affectedRows: n, suggestion: "Exclude it from analysis." });
      continue;
    }
    if (p.missingPct >= 1) {
      issues.push({
        id: `missing-${c.key}`,
        severity: p.missingPct >= 20 ? "high" : p.missingPct >= 5 ? "medium" : "low",
        kind: "missing",
        columnKey: c.key,
        message: `"${c.name}" is empty in ${p.missing.toLocaleString("en-IN")} of ${n.toLocaleString("en-IN")} rows (${p.missingPct.toFixed(1)}%).`,
        affectedRows: p.missing,
        suggestion: isNumericType(c) ? "Fill with the median/mean, use 0 if empty means none, or leave as missing." : "Fill with a label such as “Unknown”, or remove those rows.",
      });
    }
    if (p.invalid > 0) {
      issues.push({
        id: `invalid-${c.key}`,
        severity: p.invalid / Math.max(1, p.count) > 0.05 ? "high" : "medium",
        kind: c.type === "date" ? "invalid" : "mixed",
        columnKey: c.key,
        message: `${p.invalid.toLocaleString("en-IN")} value(s) in "${c.name}" aren't valid ${c.type === "date" ? "dates" : "numbers"} and are ignored in calculations.`,
        affectedRows: p.invalid,
        suggestion: "Correct them in the source file, replace them here, or change the column type.",
      });
      problemCols++;
    }
    if (p.distinct === 1 && p.count > 1 && n > 2) {
      problemCols++;
      issues.push({ id: `const-${c.key}`, severity: "low", kind: "constant", columnKey: c.key, message: `"${c.name}" has the same value (“${p.top[0]?.value}”) in every row.`, affectedRows: p.count, suggestion: "It can't explain differences; consider excluding it." });
    }
    if (c.role === "identifier" && p.distinct < p.count) {
      const dupIds = p.count - p.distinct;
      issues.push({
        id: `dupid-${c.key}`,
        severity: "medium",
        kind: "duplicate-ids",
        columnKey: c.key,
        message: `"${c.name}" looks like an ID but ${dupIds.toLocaleString("en-IN")} value(s) repeat.`,
        affectedRows: dupIds,
        suggestion: "Check whether these are repeated records, or whether the column isn't really a unique ID.",
      });
    }
    if (p.numeric && p.numeric.outliers > 0) {
      issues.push({
        id: `outliers-${c.key}`,
        severity: "low",
        kind: "outliers",
        columnKey: c.key,
        message: `${p.numeric.outliers.toLocaleString("en-IN")} unusual value(s) in "${c.name}" (outside the typical range by the 1.5 × IQR rule).`,
        affectedRows: p.numeric.outliers,
        suggestion: "Check whether they are real or data-entry errors before acting on averages.",
      });
    }
    const raw = table.rows;
    let spaced = 0;
    for (const r of raw) {
      const v = r[c.index];
      if (typeof v === "string" && v !== v.replace(/\s+/g, " ").trim()) spaced++;
    }
    if (spaced > 0) {
      issues.push({ id: `ws-${c.key}`, severity: "low", kind: "whitespace", columnKey: c.key, message: `${spaced.toLocaleString("en-IN")} value(s) in "${c.name}" have extra spaces, which can split one category into several.`, affectedRows: spaced, suggestion: "Use “Trim extra spaces”." });
    }
  }

  const totalCells = Math.max(1, n * cols.length);
  const missingPct = (missingCells / totalCells) * 100;
  const dupPct = n ? (duplicateRows / n) * 100 : 0;
  const invalidPct = (invalidCells / totalCells) * 100;
  const score = Math.max(0, Math.round(100 - Math.min(40, 2 * missingPct) - Math.min(25, 2.5 * dupPct) - Math.min(20, 2 * invalidPct) - Math.min(15, 3 * problemCols)));
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || b.affectedRows - a.affectedRows);
  return { score, scoreFormula: QUALITY_FORMULA, completeness: 100 - missingPct, duplicateRows, duplicateGroups: dupGroups.slice(0, 50), issues };
}
