/**
 * Refreshing a dataset from its source file. In Chrome and Edge a file can be
 * "linked" once (File System Access API) and re-read later without asking again,
 * for as long as this tab is open. Elsewhere the user picks the file again.
 * The dashboard, KPIs and column choices are kept when the columns are the same.
 */
import type { DatasetRecord } from "../engine/types";
import { analyzeRecord } from "../engine/pipeline";
import { analyzeFile, inspectFile } from "./upload";
import { getDataset, saveDataset } from "../storage/db";

interface PickerWindow {
  showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]>;
}
const handles = new Map<string, FileSystemFileHandle>();

export const canLinkFiles = () => typeof window !== "undefined" && typeof (window as PickerWindow).showOpenFilePicker === "function";
export const linkedFileName = (id: string) => handles.get(id)?.name ?? null;
export const unlinkFile = (id: string) => handles.delete(id);

export async function linkFile(id: string): Promise<string> {
  const picker = (window as PickerWindow).showOpenFilePicker!;
  const [h] = await picker({
    multiple: false,
    types: [{ description: "Spreadsheets and reports", accept: { "application/octet-stream": [".xlsx", ".xls", ".xlsm", ".csv", ".tsv", ".txt", ".json", ".pdf"] } }],
  });
  handles.set(id, h);
  return h.name;
}

export interface RefreshResult {
  rows: number;
  before: number;
  sameColumns: boolean;
  fileName: string;
}

/** Re-reads the linked file (or the given file) and replaces the dataset's rows. */
export async function refreshDataset(id: string, file?: File): Promise<RefreshResult> {
  const record = await getDataset(id);
  if (!record) throw new Error("This dataset isn't open any more.");
  let f = file;
  if (!f) {
    const h = handles.get(id);
    if (!h) throw new Error("No file is linked to this dataset.");
    const perm = await (h as unknown as { queryPermission?: (o: unknown) => Promise<string> }).queryPermission?.({ mode: "read" });
    if (perm && perm !== "granted") throw new Error(`The browser needs permission again to read “${h.name}”. Use “Refresh now” once.`);
    f = await h.getFile();
  }
  const sheets = await inspectFile(f);
  const sheet = sheets.find((s) => s.name === record.sheetName && s.rows > 0) ?? sheets.find((s) => s.rows > 0);
  if (!sheet) throw new Error(`“${f.name}” has no data rows.`);
  const { datasets } = await analyzeFile(f, [sheet.name], () => {});
  const fresh = datasets[0];
  if (!fresh) throw new Error(`Couldn't read “${f.name}”.`);
  const now = new Date().toISOString();
  const sameColumns = fresh.headers.length === record.headers.length && fresh.headers.every((h, i) => h === record.headers[i]);
  const next: DatasetRecord = sameColumns
    ? { ...record, rows: fresh.rows, rowCount: fresh.rowCount, sizeBytes: fresh.sizeBytes, warnings: fresh.warnings, updatedAt: now, refreshedAt: now }
    : { ...fresh, id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: now, refreshedAt: now };
  next.qualityScore = analyzeRecord(next).quality.score;
  await saveDataset(next);
  return { rows: next.rowCount, before: record.rowCount, sameColumns, fileName: f.name };
}
