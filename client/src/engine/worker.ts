/// <reference lib="webworker" />
/**
 * Upload worker: parsing and analysis run off the main thread so the page stays
 * responsive. Progress messages are sent as each real stage completes.
 */
import { parseFile, ParseError } from "./parse";
import { analyzeSheet, STAGES } from "./pipeline";
import type { AnalysisProgress, DatasetRecord, ParsedFile, RawSheet } from "./types";

export type WorkerRequest =
  | { type: "inspect"; file: File }
  | { type: "analyze"; file: File; sheets: string[] };

export type WorkerResponse =
  | { type: "progress"; progress: AnalysisProgress; sheet?: string }
  | { type: "inspected"; fileName: string; sheets: { name: string; rows: number; cols: number; warnings: string[] }[] }
  | { type: "done"; datasets: DatasetRecord[]; skipped: { sheet: string; reason: string }[] }
  | { type: "error"; message: string };

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

// Cache the last parsed file so "inspect" then "analyze" doesn't parse twice.
let cache: { key: string; sheets: RawSheet[]; kind: ParsedFile["kind"] } | null = null;
const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    post({ type: "progress", progress: { stage: "read", label: STAGES[0].label, done: 0, total: STAGES.length, detail: msg.file.name } });
    let parsed = cache && cache.key === keyOf(msg.file) ? cache : null;
    if (!parsed) {
      const p = await parseFile(msg.file);
      parsed = { key: keyOf(msg.file), sheets: p.sheets, kind: p.kind };
      cache = parsed;
    }
    if (msg.type === "inspect") {
      post({ type: "inspected", fileName: msg.file.name, sheets: parsed.sheets.map((s) => ({ name: s.name, rows: s.rows.length, cols: s.headers.length, warnings: s.warnings })) });
      return;
    }
    const chosen = parsed.sheets.filter((s) => msg.sheets.includes(s.name));
    const datasets: DatasetRecord[] = [];
    const skipped: { sheet: string; reason: string }[] = [];
    for (const sheet of chosen) {
      if (!sheet.rows.length || !sheet.headers.length) {
        skipped.push({ sheet: sheet.name, reason: sheet.warnings[0] ?? "No data rows." });
        continue;
      }
      datasets.push(
        analyzeSheet(sheet, { fileName: msg.file.name, kind: parsed.kind, sizeBytes: msg.file.size }, (progress) => post({ type: "progress", progress, sheet: sheet.name }), chosen.length),
      );
    }
    post({ type: "progress", progress: { stage: "done", label: "Done", done: STAGES.length, total: STAGES.length } });
    post({ type: "done", datasets, skipped });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : `Couldn't analyse "${msg.file.name}": ${(err as Error).message}`;
    post({ type: "error", message });
  }
};
