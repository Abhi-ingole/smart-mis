/**
 * File parser: CSV (Papa Parse), Excel .xlsx/.xls (SheetJS), JSON, and PDF tables (pdf.js, loaded on demand).
 * Runs in the browser (inside a Web Worker) — the file never leaves the device.
 */
import Papa from "papaparse";
import * as XLSX from "@e965/xlsx";
import type { Cell, ParsedFile, RawSheet } from "./types";

export const LIMITS = {
  maxFileBytes: 30 * 1024 * 1024,
  maxRows: 300_000,
  maxCols: 500,
  maxCells: 6_000_000,
};

export class ParseError extends Error {}

const EXT_KIND: Record<string, ParsedFile["kind"]> = { csv: "csv", tsv: "csv", txt: "csv", xlsx: "xlsx", xlsm: "xlsx", xls: "xls", json: "json", pdf: "pdf" };

/** Extensions the upload engine can read directly (ZIP archives and folders are unpacked into these). */
export const SUPPORTED_EXTS = Object.keys(EXT_KIND);

/** Validates name, size and file signature before any parsing. */
export function detectKind(fileName: string, size: number, head: Uint8Array): ParsedFile["kind"] {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const kind = EXT_KIND[ext];
  if (!kind) throw new ParseError(`"${fileName}" isn't a supported file. Upload Excel (.xlsx, .xls), CSV, JSON, PDF or a ZIP of them.`);
  if (size === 0) throw new ParseError(`"${fileName}" is empty.`);
  if (size > LIMITS.maxFileBytes) throw new ParseError(`"${fileName}" is ${(size / 1048576).toFixed(1)} MB. The limit for in-browser analysis is ${LIMITS.maxFileBytes / 1048576} MB — split the file or remove unused columns.`);
  const is = (...b: number[]) => b.every((v, i) => head[i] === v);
  const zip = is(0x50, 0x4b, 0x03, 0x04);
  const ole = is(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  if (kind === "xlsx" && !zip) throw new ParseError(`"${fileName}" doesn't look like a real Excel workbook (the file content doesn't match .xlsx).`);
  if (kind === "xls" && !ole && !zip) {
    // Some systems export HTML or CSV with an .xls name; SheetJS can still read those, so allow text.
    if (head.includes(0)) throw new ParseError(`"${fileName}" doesn't look like a real Excel file.`);
  }
  if (kind === "pdf" && !(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) {
    // "%PDF" can follow a few junk bytes in some exports; accept it anywhere in the first 1 KB.
    if (!new TextDecoder("latin1").decode(head.subarray(0, 1024)).includes("%PDF")) throw new ParseError(`"${fileName}" doesn't look like a real PDF.`);
  }
  if (kind === "json" && (zip || ole || head.subarray(0, 4096).includes(0))) throw new ParseError(`"${fileName}" is a binary file, not JSON.`);
  if (kind === "csv") {
    if (zip || ole) throw new ParseError(`"${fileName}" is a binary file, not CSV. If it's an Excel file, rename it to .xlsx/.xls.`);
    if (head.subarray(0, 4096).includes(0)) throw new ParseError(`"${fileName}" contains binary data and can't be read as CSV.`);
  }
  return kind;
}

function cellToValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // Dates are read as UTC (see sheet_to_json UTC option); round to the minute to drop float noise.
    const t = new Date(Math.round(v.getTime() / 60000) * 60000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    const hasTime = t.getUTCHours() || t.getUTCMinutes();
    return hasTime ? `${d}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` : d;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const s = String(v).replace(/ /g, " ");
  return s.trim() === "" ? null : s;
}

const isBlank = (c: Cell) => c === null || (typeof c === "string" && c.trim() === "");
const looksNumeric = (c: Cell) => typeof c === "number" || (typeof c === "string" && /^[\s₹$€£-]*[\d,.]+%?\s*$/.test(c));

/** Turns a cell matrix into headers + rows, handling titles, missing and duplicate headers. */
export function buildSheet(name: string, matrix: Cell[][]): RawSheet {
  const warnings: string[] = [];
  let rows = matrix.filter((r) => r.some((c) => !isBlank(c)));
  if (rows.length === 0) return { name, headers: [], rows: [], warnings: ["This sheet is empty."] };

  // Skip title rows (e.g. "Monthly Sales Report") sitting above the real header.
  const width = (r: Cell[]) => r.filter((c) => !isBlank(c)).length;
  const maxWidth = Math.max(...rows.slice(0, 20).map(width));
  let start = 0;
  while (start < Math.min(5, rows.length - 1) && width(rows[start]) <= Math.max(1, Math.floor(maxWidth / 3)) && width(rows[start + 1]) > width(rows[start])) {
    warnings.push(`Skipped title row ${start + 1} ("${String(rows[start].find((c) => !isBlank(c)) ?? "").slice(0, 40)}").`);
    start++;
  }
  rows = rows.slice(start);

  const first = rows[0];
  const nonBlank = first.filter((c) => !isBlank(c));
  const numericShare = nonBlank.filter(looksNumeric).length / Math.max(1, nonBlank.length);
  const hasHeader = nonBlank.length > 0 && numericShare < 0.5;

  let colCount = rows.reduce((m, r) => Math.max(m, r.length), 0); // no spread: sheets can have 100k+ rows
  // Trim columns that are empty everywhere (common in Excel exports).
  while (colCount > 0 && rows.every((r) => isBlank(r[colCount - 1] ?? null))) colCount--;
  if (colCount > LIMITS.maxCols) throw new ParseError(`Sheet "${name}" has ${colCount} columns. The limit is ${LIMITS.maxCols}.`);

  let headers: string[];
  if (hasHeader) {
    headers = Array.from({ length: colCount }, (_, i) => {
      const h = first[i];
      return isBlank(h ?? null) ? "" : String(h).replace(/\s+/g, " ").trim();
    });
    rows = rows.slice(1);
  } else {
    headers = Array.from({ length: colCount }, () => "");
    warnings.push("No header row found — columns were named Column 1, Column 2, … Rename them on the Data Quality page.");
  }
  const seen = new Map<string, number>();
  headers = headers.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    if (!h && hasHeader) warnings.push(`Column ${i + 1} has no header; named it "${name}".`);
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      const renamed = `${name} (${n})`;
      warnings.push(`Duplicate column name "${name}" renamed to "${renamed}".`);
      name = renamed;
    }
    return name;
  });

  let ragged = 0;
  const out = rows.map((r) => {
    if (r.length > colCount && r.slice(colCount).some((c) => !isBlank(c))) ragged++;
    const row = r.slice(0, colCount);
    while (row.length < colCount) row.push(null);
    return row.map((c) => (isBlank(c) ? null : c));
  });
  if (ragged) warnings.push(`${ragged} row(s) had more values than headers; the extra values were ignored.`);
  if (out.length > LIMITS.maxRows) throw new ParseError(`Sheet "${name}" has ${out.length.toLocaleString("en-IN")} rows. The limit for in-browser analysis is ${LIMITS.maxRows.toLocaleString("en-IN")}.`);
  if (out.length * colCount > LIMITS.maxCells) throw new ParseError(`Sheet "${name}" is too large (${(out.length * colCount).toLocaleString("en-IN")} cells). Remove unused columns or split the file.`);
  if (out.length === 0) warnings.push("The sheet has a header row but no data rows.");
  return { name, headers, rows: out, warnings };
}

export function parseCsvText(text: string, name = "Sheet1"): RawSheet {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) return { name, headers: [], rows: [], warnings: ["The file is empty."] };
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t", "|"] });
  const matrix = (result.data as unknown[][]).map((r) => r.map(cellToValue));
  const sheet = buildSheet(name, matrix);
  const serious = result.errors.filter((e) => e.type === "Quotes" || e.type === "Delimiter");
  if (serious.length) {
    if (serious.length > Math.max(5, matrix.length * 0.1)) {
      throw new ParseError(`This CSV looks malformed (${serious[0].message} near row ${(serious[0].row ?? 0) + 1}). Check quotes and separators, or re-export it from Excel.`);
    }
    sheet.warnings.push(`${serious.length} malformed line(s) were read as best as possible (first near row ${(serious[0].row ?? 0) + 1}).`);
  }
  const delim = result.meta.delimiter;
  if (delim && delim !== ",") sheet.warnings.push(`Detected "${delim === "\t" ? "tab" : delim}" as the separator.`);
  return sheet;
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array): RawSheet[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: true, dense: true, UTC: true, sheetRows: LIMITS.maxRows + 25 });
  } catch (e) {
    throw new ParseError(`Couldn't open this workbook: ${(e as Error).message}. If it's password-protected, remove the password and try again.`);
  }
  if (!wb.SheetNames.length) throw new ParseError("This workbook has no sheets.");
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false, UTC: true }).map((r) => (r as unknown[]).map(cellToValue));
    return buildSheet(sheetName, matrix);
  });
}

/** JSON: an array of records, or an object holding one (e.g. {"data": [...]}). Nested objects become "parent.child" columns. */
export function parseJsonText(text: string, name = "Data"): RawSheet {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new ParseError(`This JSON can't be read: ${(e as Error).message}`);
  }
  const findArray = (v: unknown, depth = 0): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && depth < 3) {
      const arrays = Object.values(v).map((x) => findArray(x, depth + 1)).filter((x): x is unknown[] => !!x);
      return arrays.sort((a, b) => b.length - a.length)[0] ?? null;
    }
    return null;
  };
  const arr = findArray(data);
  if (!arr || !arr.length) throw new ParseError("This JSON has no list of records to analyse.");
  if (arr.every((r) => Array.isArray(r))) return buildSheet(name, (arr as unknown[][]).map((r) => r.map(cellToValue)));
  const flat = (o: unknown, prefix = "", out: Record<string, unknown> = {}) => {
    if (o && typeof o === "object" && !Array.isArray(o) && !(o instanceof Date)) {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) flat(v, `${prefix}${k}.`, out);
        else out[`${prefix}${k}`] = Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : v;
      }
    } else out[prefix ? prefix.slice(0, -1) : "value"] = o;
    return out;
  };
  const records = arr.map((r) => flat(r));
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), headers.push(k));
  return buildSheet(name, [headers, ...records.map((r) => headers.map((h) => cellToValue(r[h])))]);
}

export async function parseFile(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }, onStatus?: (text: string) => void): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8192));
  const kind = detectKind(file.name, file.size, head);
  let sheets: RawSheet[];
  const base = (file.name.split(/[\\/›]/).pop() ?? file.name).trim().replace(/\.[^.]+$/, "");
  if (kind === "csv") {
    const text = new TextDecoder("utf-8").decode(buf);
    sheets = [parseCsvText(text, base)];
  } else if (kind === "json") {
    sheets = [parseJsonText(new TextDecoder("utf-8").decode(buf), base)];
  } else if (kind === "pdf") {
    const { parsePdf } = await import("./pdf");
    sheets = await parsePdf(buf, file.name, (p, n) => onStatus?.(`reading PDF page ${p.toLocaleString("en-IN")} of ${n.toLocaleString("en-IN")}…`));
  } else {
    sheets = parseWorkbook(buf);
  }
  if (sheets.every((s) => s.rows.length === 0)) throw new ParseError(`"${file.name}" has no data rows.`);
  return { fileName: file.name, kind, sizeBytes: file.size, sheets };
}
