/**
 * The analysis pipeline. Stages report real progress as they finish.
 * Used by the Web Worker on upload and by the UI to re-analyse after edits.
 */
import type { AnalysisProgress, ColumnProfile, DatasetRecord, DomainGuess, ParsedFile, QualityReport, RawSheet, Table } from "./types";
import { inferSchema } from "./infer";
import { applyOps, buildTable } from "./table";
import { assessQuality, profileTable } from "./profile";
import { detectDomain } from "./semantic";
import { recommendKpis } from "./kpi";
import { recommendCharts } from "./charts";

export const STAGES: { stage: AnalysisProgress["stage"]; label: string }[] = [
  { stage: "read", label: "Reading spreadsheet" },
  { stage: "types", label: "Detecting data types" },
  { stage: "profile", label: "Profiling columns" },
  { stage: "quality", label: "Checking data quality" },
  { stage: "kpis", label: "Identifying KPIs" },
  { stage: "charts", label: "Recommending charts" },
  { stage: "dashboard", label: "Building dashboard" },
  { stage: "report", label: "Preparing report" },
];

export type ProgressFn = (p: AnalysisProgress) => void;

const stageIndex = (s: AnalysisProgress["stage"]) => STAGES.findIndex((x) => x.stage === s);

export function newId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Turns one parsed sheet into a saved-ready dataset with an auto-generated dashboard. */
export function analyzeSheet(sheet: RawSheet, file: Pick<ParsedFile, "fileName" | "kind" | "sizeBytes">, onProgress: ProgressFn = () => {}, sheetCount = 1): DatasetRecord {
  const tick = (stage: AnalysisProgress["stage"], detail?: string) => onProgress({ stage, label: STAGES[stageIndex(stage)]?.label ?? stage, done: stageIndex(stage), total: STAGES.length, detail });
  if (!sheet.headers.length || !sheet.rows.length) throw new Error(`Sheet "${sheet.name}" has no data to analyse.`);

  tick("types", `${sheet.headers.length} columns`);
  const schema = inferSchema(sheet.headers, sheet.rows);

  tick("profile", `${sheet.rows.length.toLocaleString("en-IN")} rows`);
  const table = buildTable(schema, sheet.rows);
  const profiles = profileTable(table);

  tick("quality");
  const quality = assessQuality(table, profiles);

  tick("kpis");
  const domain = detectDomain(schema);
  const kpis = recommendKpis(schema, profiles, domain, table);

  tick("charts");
  const charts = recommendCharts(schema, profiles, domain, table);

  tick("dashboard");
  const now = new Date().toISOString();
  const base = file.fileName.replace(/\.[^.]+$/, "");
  const record: DatasetRecord = {
    id: newId(),
    name: sheetCount > 1 ? `${base} — ${sheet.name}` : base,
    fileName: file.fileName,
    sheetName: sheet.name,
    kind: file.kind,
    createdAt: now,
    updatedAt: now,
    rowCount: sheet.rows.length,
    colCount: sheet.headers.length,
    sizeBytes: file.sizeBytes,
    headers: sheet.headers,
    schema,
    ops: [],
    dashboard: { kpis, charts },
    domain,
    qualityScore: quality.score,
    warnings: sheet.warnings,
    storage: "local",
    rows: sheet.rows,
  };
  tick("report");
  return record;
}

export interface Analysis {
  table: Table;
  profiles: Record<string, ColumnProfile>;
  quality: QualityReport;
  domain: DomainGuess;
}

/** Recomputes the working table from original rows + schema edits + cleaning steps. */
export function analyzeRecord(record: Pick<DatasetRecord, "schema" | "rows" | "ops">): Analysis {
  const rows = applyOps(record.rows, record.schema, record.ops);
  const table = buildTable(record.schema, rows);
  const profiles = profileTable(table);
  const quality = assessQuality(table, profiles);
  const domain = detectDomain(record.schema);
  return { table, profiles, quality, domain };
}
