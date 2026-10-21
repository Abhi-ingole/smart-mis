/**
 * Core data model shared by the analysis engine, storage and UI.
 * The engine is plain TypeScript (no React) so it runs in a Web Worker and in tests.
 */

/** A raw spreadsheet cell after parsing. Dates from Excel arrive as ISO strings. */
export type Cell = string | number | boolean | null;

export interface RawSheet {
  name: string;
  headers: string[];
  rows: Cell[][];
  /** Problems found while reading (generated headers, renamed duplicates, ragged rows…). */
  warnings: string[];
}

export interface ParsedFile {
  fileName: string;
  kind: "csv" | "xlsx" | "xls";
  sizeBytes: number;
  sheets: RawSheet[];
}

export type ColType = "number" | "currency" | "percentage" | "date" | "boolean" | "category" | "text" | "identifier";
export type Role = "measure" | "dimension" | "time" | "identifier" | "ignore";

/** Business meaning of a column, used to pick relevant KPIs. Never used to invent values. */
export type Semantic =
  | "revenue"
  | "cost"
  | "profit"
  | "price"
  | "quantity"
  | "salary"
  | "score"
  | "age"
  | "rating"
  | "duration"
  | "person"
  | "employee_id"
  | "student_id"
  | "order_id"
  | "customer"
  | "product"
  | "category"
  | "region"
  | "department"
  | "status"
  | "gender"
  | "subject"
  | "result"
  | "payment"
  | "date"
  | "none";

export type DateOrder = "ymd" | "dmy" | "mdy";

export interface Ambiguity {
  kind: "date-order" | "money" | "percent-scale" | "id-or-measure" | "mixed-type";
  question: string;
  options: { value: string; label: string }[];
  /** The value currently in use until the user answers. */
  current: string;
  resolved: boolean;
}

export interface ColumnSchema {
  /** Stable key (c0, c1, …) — survives renames. */
  key: string;
  index: number;
  originalName: string;
  name: string;
  type: ColType;
  detectedType: ColType;
  role: Role;
  semantic: Semantic;
  excluded: boolean;
  /** 0–1: share of non-empty values that match the type. */
  confidence: number;
  dateOrder?: DateOrder;
  percentScale?: "fraction" | "whole";
  currencySymbol?: string;
  ambiguity?: Ambiguity;
  notes: string[];
}

export interface NumericStats {
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
  q1: number;
  q3: number;
  outliers: number;
  outlierLow: number;
  outlierHigh: number;
  skew: number;
  histogram: { from: number; to: number; count: number }[];
}

export interface ColumnProfile {
  key: string;
  count: number; // non-empty
  missing: number;
  missingPct: number;
  distinct: number;
  uniqueRatio: number;
  invalid: number; // non-empty values that don't parse as the column's type
  top: { value: string; count: number }[];
  numeric?: NumericStats;
  dateRange?: { min: string; max: string; days: number };
  sample: string[];
}

export interface QualityIssue {
  id: string;
  severity: "high" | "medium" | "low";
  kind: "missing" | "duplicates" | "duplicate-ids" | "invalid" | "mixed" | "outliers" | "constant" | "empty-column" | "whitespace";
  columnKey?: string;
  message: string;
  affectedRows: number;
  suggestion?: string;
}

export interface QualityReport {
  score: number; // 0–100
  scoreFormula: string;
  completeness: number; // % non-missing cells
  duplicateRows: number;
  duplicateGroups: number[][]; // row indexes (first 50 groups)
  issues: QualityIssue[];
}

export interface DomainGuess {
  domain: "sales" | "hr" | "academic" | "finance" | "inventory" | "marketing" | "generic";
  label: string;
  confidence: number;
  evidence: string[];
}

export type Agg = "count" | "countDistinct" | "sum" | "avg" | "min" | "max" | "median" | "ratio" | "share" | "topShare" | "missingPct" | "quality";

export interface KpiFilter {
  columnKey: string;
  values: string[]; // matched case-insensitively against the cell text
}

export interface KpiDef {
  id: string;
  name: string;
  agg: Agg;
  columnKey?: string;
  /** For ratio: numerator / denominator, each an aggregate. */
  numerator?: { agg: Agg; columnKey?: string; filter?: KpiFilter };
  denominator?: { agg: Agg; columnKey?: string; filter?: KpiFilter };
  filter?: KpiFilter;
  format: "number" | "currency" | "percent" | "decimal";
  description: string;
  custom?: boolean;
}

export interface KpiValue {
  id: string;
  value: number | null;
  display: string;
  formula: string;
  sourceColumns: string[];
  comparison?: { label: string; previous: number; changePct: number | null; direction: "up" | "down" | "flat" };
}

export type ChartType = "bar" | "line" | "area" | "pie" | "donut" | "scatter" | "histogram" | "stacked" | "heatmap" | "table";
export type TimeBucket = "day" | "week" | "month" | "quarter" | "year";

export interface ChartSpec {
  id: string;
  type: ChartType;
  title: string;
  /** Dimension / time / numeric-x column. */
  x?: string;
  /** Measure column (absent → count of rows). */
  y?: string;
  agg: "sum" | "avg" | "count" | "min" | "max" | "median";
  /** Second dimension for stacked bars and heatmaps. */
  series?: string;
  bucket?: TimeBucket;
  limit?: number;
  reason: string;
}

export interface Filters {
  categories: Record<string, string[]>; // columnKey → allowed values
  dateColumn?: string;
  dateFrom?: string;
  dateTo?: string;
}

export type CleaningOp =
  | { kind: "trim"; columnKey?: string }
  | { kind: "removeDuplicates" }
  | { kind: "fillMissing"; columnKey: string; method: "value" | "mean" | "median" | "mode" | "zero"; value?: string }
  | { kind: "dropMissingRows"; columnKey: string }
  | { kind: "replaceValue"; columnKey: string; from: string; to: string };

export interface DashboardConfig {
  kpis: KpiDef[];
  charts: ChartSpec[];
}

/** Everything saved for one dataset. The original rows are never modified. */
export interface DatasetMeta {
  id: string;
  name: string;
  fileName: string;
  sheetName: string;
  kind: ParsedFile["kind"] | "merged" | "demo";
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  colCount: number;
  sizeBytes: number;
  headers: string[];
  schema: ColumnSchema[];
  ops: CleaningOp[];
  dashboard: DashboardConfig;
  domain: DomainGuess;
  qualityScore: number;
  warnings: string[];
  storage: "local";
}

export interface DatasetRecord extends DatasetMeta {
  rows: Cell[][];
}

/** A cleaned, typed view of the data that everything downstream reads. */
export interface Table {
  schema: ColumnSchema[];
  /** Raw cells after cleaning operations (same column order as schema). */
  rows: Cell[][];
  /** Typed accessors per column key, aligned with rows. number for numeric/date (epoch days), string otherwise. */
  num: Record<string, (number | null)[]>;
  str: Record<string, (string | null)[]>;
}

export interface Insight {
  id: string;
  kind: "trend" | "change" | "outlier" | "top" | "bottom" | "distribution" | "concentration" | "missing" | "correlation" | "quality";
  text: string;
  /** Numbers in the text, with where they came from — so every number can be traced. */
  evidence: { label: string; value: string }[];
  importance: number;
}

export interface Recommendation {
  id: string;
  text: string;
  basedOn: string; // insight id
}

export interface AnalysisProgress {
  stage: "read" | "types" | "profile" | "quality" | "kpis" | "charts" | "dashboard" | "report" | "done" | "error";
  label: string;
  done: number;
  total: number;
  detail?: string;
}
