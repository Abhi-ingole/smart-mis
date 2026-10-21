/**
 * Turns an uploaded vendor file into candidate numbers for the daily entry.
 * Order of preference:
 *   1. Per-recipient tables (CSV/XLSX): counted exactly in code.
 *   2. AI (Groq) on masked text, every value checked against the line it came from.
 *   3. Rule-based keyword matching (works with no API key).
 * The user always reviews and confirms the numbers before anything is saved.
 */
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { chat, parseJsonReply, AiUnavailableError } from "../lib/groq";
import { config, isAiEnabled } from "../lib/config";
import { maskPII, PII_COLUMN_RE } from "../lib/mask";
import type { FileKind } from "../lib/fileCheck";

export type Channel = "wa" | "email";
export type FieldKey = "waRecipients" | "waDelivered" | "emailSent" | "emailOpened";

export const CHANNEL_FIELDS: Record<Channel, FieldKey[]> = {
  wa: ["waRecipients", "waDelivered"],
  email: ["emailSent", "emailOpened"],
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  waRecipients: "WhatsApp recipients (sent)",
  waDelivered: "WhatsApp delivered",
  emailSent: "Emails sent",
  emailOpened: "Emails opened",
};

export interface ExtractedField {
  value: number | null;
  source: string | null;
}

export interface ExtractionResult {
  channel: Channel;
  method: "rows" | "ai" | "rules" | "ai-vision" | "none";
  model?: string;
  fields: Partial<Record<FieldKey, ExtractedField>>;
  warnings: string[];
  preview: string[];
}

interface Table {
  headers: string[];
  rows: string[][];
}

// ── Reading files ───────────────────────────────────────────

export async function pdfToText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export function csvToTable(buf: Buffer): Table {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = (parsed.data as string[][]).map((r) => r.map((c) => String(c ?? "").trim()));
  const [headers = [], ...rows] = data;
  return { headers, rows: rows.slice(0, 200_000) };
}

export async function xlsxToTable(buf: Buffer): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const all: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
        if (o.result !== undefined) return String(o.result);
        if (o.text !== undefined) return String(o.text);
        if (o.richText) return o.richText.map((t) => t.text).join("");
        if (v instanceof Date) return v.toISOString().slice(0, 10);
      }
      return String(v).trim();
    });
    all.push(values);
  });
  const [headers = [], ...rows] = all;
  return { headers, rows: rows.slice(0, 200_000) };
}

// ── Number helpers ──────────────────────────────────────────

/** Integers in a string, skipping percentages, decimals and date/time fragments. */
export function integersIn(s: string): number[] {
  const out: number[] = [];
  const re = /\d[\d,]*(?:\.\d+)?\s*%?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const raw = m[0].trim();
    const before = s[m.index - 1] ?? "";
    const after = s[m.index + m[0].length] ?? "";
    if (raw.endsWith("%") || raw.includes(".")) continue;
    if (/[-/:]/.test(before) || /[-/:]/.test(after)) continue; // dates, times, ranges
    const digits = raw.replace(/,/g, "");
    if (!/^\d+$/.test(digits)) continue;
    out.push(Number(digits));
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ── Tables → counts or text ─────────────────────────────────

function dropPiiColumns(t: Table): Table {
  const keep = t.headers.map((h, i) => ({ h, i })).filter(({ h }) => !PII_COLUMN_RE.test(h));
  return { headers: keep.map((k) => k.h), rows: t.rows.map((r) => keep.map((k) => r[k.i] ?? "")) };
}

const findCol = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h));

/** Per-recipient exports: one row per message. Count rows instead of asking the AI. */
function countRows(t: Table, channel: Channel): ExtractionResult | null {
  if (t.rows.length < 2) return null;
  const nonEmpty = t.rows.filter((r) => r.some((c) => c !== ""));
  if (channel === "wa") {
    const status = findCol(t.headers, /status|delivery/i);
    if (status === -1) return null;
    const values = nonEmpty.map((r) => (r[status] ?? "").toLowerCase());
    if (values.some((v) => /^\d[\d,]*$/.test(v))) return null; // a summary table, not per-recipient
    const delivered = values.filter((v) => /deliver|read|seen/.test(v) && !/un-?deliver|not\s*deliver/.test(v)).length;
    return {
      channel,
      method: "rows",
      fields: {
        waRecipients: { value: nonEmpty.length, source: `Counted ${nonEmpty.length} data rows` },
        waDelivered: { value: delivered, source: `Counted ${delivered} rows where "${t.headers[status]}" is Delivered/Read` },
      },
      warnings: [],
      preview: [],
    };
  }
  const opened = findCol(t.headers, /^(opened|opens?|open(ed)?\s*\?|is\s*opened|open\s*count)$/i);
  const status = findCol(t.headers, /status|event|activity/i);
  if (opened === -1 && status === -1) return null;
  const isYes = (v: string) => /^(yes|y|true|1|opened|open)$/i.test(v.trim()) || (/^\d+$/.test(v.trim()) && Number(v) > 0);
  let openedCount: number;
  let how: string;
  if (opened !== -1) {
    const vals = nonEmpty.map((r) => r[opened] ?? "");
    if (vals.some((v) => /^\d{3,}[\d,]*$/.test(v.replace(/,/g, "")) && Number(v.replace(/,/g, "")) > 1)) return null;
    openedCount = vals.filter(isYes).length;
    how = `Counted ${openedCount} rows where "${t.headers[opened]}" is yes`;
  } else {
    const vals = nonEmpty.map((r) => (r[status] ?? "").toLowerCase());
    if (vals.some((v) => /^\d[\d,]*$/.test(v))) return null;
    openedCount = vals.filter((v) => /open|click/.test(v)).length;
    how = `Counted ${openedCount} rows where "${t.headers[status]}" is Opened/Clicked`;
  }
  return {
    channel,
    method: "rows",
    fields: {
      emailSent: { value: nonEmpty.length, source: `Counted ${nonEmpty.length} data rows` },
      emailOpened: { value: openedCount, source: how },
    },
    warnings: [],
    preview: [],
  };
}

/** Summary tables become "Header: value" lines that the text extractors understand. */
export function tableToText(t: Table): string {
  const clean = dropPiiColumns(t);
  if (clean.headers.length === 0) return "";
  // Key/value style (2 columns)
  const labelRows = clean.rows.length > 0 && clean.rows.every((r) => !/^\d[\d,]*$/.test((r[0] ?? "").trim()));
  if (clean.headers.length === 2 && labelRows) {
    return [clean.headers.join(": "), ...clean.rows.map((r) => `${r[0]}: ${r[1]}`)].join("\n");
  }
  // Column style: total each numeric column
  const lines: string[] = [];
  clean.headers.forEach((h, i) => {
    const nums = clean.rows.map((r) => (r[i] ?? "").replace(/,/g, "")).filter((v) => /^\d+$/.test(v));
    if (nums.length && nums.length === clean.rows.filter((r) => (r[i] ?? "") !== "").length) {
      const total = nums.reduce((a, b) => a + Number(b), 0);
      lines.push(`${h}: ${total}${clean.rows.length > 1 ? ` (total of ${nums.length} rows)` : ""}`);
    }
  });
  return lines.join("\n");
}

// ── Rule-based extraction ───────────────────────────────────

const RULES: Record<FieldKey, RegExp[]> = {
  waRecipients: [
    /total\s*(recipients|numbers|contacts|messages|submitted|sent)/i,
    /\b(recipients|submitted|attempted)\b/i,
    /\b(messages?\s*sent|total\s*sent|sent)\b/i,
    /\btotal\b/i,
  ],
  waDelivered: [/(?<!un|not\s)delivered/i],
  emailSent: [/\b(emails?\s*sent|total\s*sent|sent)\b/i, /\b(recipients|processed|requests)\b/i, /(?<!un)delivered/i],
  emailOpened: [/unique\s*opens?/i, /\b(opened|opens|open)\b(?!\s*rate)/i],
};

export function extractByRules(text: string, channel: Channel): ExtractionResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fields: Partial<Record<FieldKey, ExtractedField>> = {};
  for (const key of CHANNEL_FIELDS[channel]) {
    let found: ExtractedField = { value: null, source: null };
    outer: for (const re of RULES[key]) {
      for (const line of lines) {
        const m = re.exec(line);
        if (!m) continue;
        if (/^\s*(rate|%|percent)/i.test(line.slice(m.index + m[0].length))) continue; // "Delivered rate: 95%"
        const nums = integersIn(line.slice(m.index + m[0].length));
        if (nums.length) {
          found = { value: nums[0], source: line.slice(0, 200) };
          break outer;
        }
      }
    }
    fields[key] = found;
  }
  return { channel, method: "rules", fields, warnings: [], preview: [] };
}

// ── AI extraction ───────────────────────────────────────────

const FIELD_HINTS: Record<FieldKey, string> = {
  waRecipients: "total WhatsApp messages sent / submitted / total recipients",
  waDelivered: "WhatsApp messages delivered (include 'read' if the report counts read as delivered; NOT failed/undelivered)",
  emailSent: "total emails sent (or processed/requests if no 'sent' figure)",
  emailOpened: "emails opened (prefer unique opens; NOT open rate %)",
};

/** Checks that an AI-reported value really appears in the quoted line, and the line in the text. */
export function verifyFromSource(text: string, value: unknown, sourceLine: unknown): ExtractedField | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  if (typeof sourceLine !== "string" || !sourceLine.trim()) return null;
  const nText = normalize(text);
  const nLine = normalize(sourceLine);
  if (!nText.includes(nLine)) return null;
  if (!integersIn(sourceLine).includes(value)) return null;
  return { value, source: sourceLine.trim().slice(0, 200) };
}

async function extractByAi(text: string, channel: Channel): Promise<ExtractionResult> {
  const keys = CHANNEL_FIELDS[channel];
  const masked = maskPII(text).slice(0, 12_000);
  const schema = Object.fromEntries(keys.map((k) => [k, { value: "integer or null", source_line: "exact line copied from the report" }]));
  const { text: reply, model } = await chat(
    [
      {
        role: "system",
        content:
          "You read campaign delivery reports and return counts as JSON. Copy numbers exactly as written; never calculate, estimate or invent. If a figure is not present, use null. source_line must be copied verbatim from the report.",
      },
      {
        role: "user",
        content: `Channel: ${channel === "wa" ? "WhatsApp" : "Email"}\nFind:\n${keys.map((k) => `- ${k}: ${FIELD_HINTS[k]}`).join("\n")}\n\nReturn JSON exactly like ${JSON.stringify(schema)}\n\nREPORT TEXT (personal data masked):\n"""\n${masked}\n"""`,
      },
    ],
    { json: true, temperature: 0, maxTokens: 600 },
  );
  const parsed = parseJsonReply<Record<string, { value?: unknown; source_line?: unknown }>>(reply) ?? {};
  const fields: Partial<Record<FieldKey, ExtractedField>> = {};
  const warnings: string[] = [];
  for (const k of keys) {
    const item = parsed[k];
    const verified = item ? verifyFromSource(masked, item.value, item.source_line) : null;
    if (item && item.value !== null && item.value !== undefined && !verified) {
      warnings.push(`AI value for ${FIELD_LABELS[k]} could not be matched to a line in the file and was discarded.`);
    }
    fields[k] = verified ?? { value: null, source: null };
  }
  return { channel, method: "ai", model, fields, warnings, preview: [] };
}

async function extractFromImage(buf: Buffer, kind: FileKind, channel: Channel): Promise<ExtractionResult> {
  const keys = CHANNEL_FIELDS[channel];
  const dataUrl = `data:${kind === "png" ? "image/png" : "image/jpeg"};base64,${buf.toString("base64")}`;
  const { text: reply, model } = await chat(
    [
      {
        role: "system",
        content: "You read screenshots of campaign dashboards. Return only aggregate counts as JSON. Never output phone numbers, email addresses or names.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Channel: ${channel === "wa" ? "WhatsApp" : "Email"}. Find ${keys.map((k) => `${k} (${FIELD_HINTS[k]})`).join("; ")}. Return JSON {${keys.map((k) => `"${k}": {"value": integer|null, "source_line": "label text next to the number"}`).join(", ")}}.` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    { models: config.groq.visionModels, json: true, temperature: 0, maxTokens: 400 },
  );
  const parsed = parseJsonReply<Record<string, { value?: unknown; source_line?: unknown }>>(reply) ?? {};
  const fields: Partial<Record<FieldKey, ExtractedField>> = {};
  for (const k of keys) {
    const v = parsed[k]?.value;
    const src = typeof parsed[k]?.source_line === "string" ? maskPII(String(parsed[k]!.source_line)).slice(0, 120) : null;
    fields[k] = typeof v === "number" && Number.isInteger(v) && v >= 0 ? { value: v, source: src ? `Screenshot: "${src}"` : "Screenshot" } : { value: null, source: null };
  }
  return { channel, method: "ai-vision", model, fields, warnings: ["Read from a screenshot — please double-check every number against the image."], preview: [] };
}

// ── Entry point ─────────────────────────────────────────────

const hasAny = (r: ExtractionResult) => Object.values(r.fields).some((f) => f && f.value !== null);

export async function extractFile(buf: Buffer, kind: FileKind, channel: Channel, opts: { allowImageAi: boolean }): Promise<ExtractionResult> {
  const warnings: string[] = [];

  if (kind === "png" || kind === "jpg") {
    if (!isAiEnabled()) {
      return { channel, method: "none", fields: {}, warnings: ["AI is not configured, so screenshots can't be read. Enter the numbers manually."], preview: [] };
    }
    if (!opts.allowImageAi) {
      return {
        channel,
        method: "none",
        fields: {},
        warnings: ["Screenshot reading is turned off in Settings (images can't be masked for phone numbers/emails before sending to AI). Enter the numbers manually, or upload the PDF/CSV instead."],
        preview: [],
      };
    }
    try {
      return await extractFromImage(buf, kind, channel);
    } catch (e) {
      return { channel, method: "none", fields: {}, warnings: [`Could not read the screenshot: ${(e as Error).message.slice(0, 160)}`], preview: [] };
    }
  }

  let text = "";
  if (kind === "pdf") {
    text = await pdfToText(buf);
    if (!text.trim()) warnings.push("This PDF has no selectable text (it may be a scanned image). Enter the numbers manually.");
  } else {
    const table = kind === "csv" ? csvToTable(buf) : await xlsxToTable(buf);
    const counted = countRows(table, channel);
    if (counted) return counted;
    text = tableToText(table);
  }

  const masked = maskPII(text);
  const preview = masked
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 25);

  const rules = extractByRules(masked, channel);
  if (isAiEnabled() && masked.trim()) {
    try {
      const ai = await extractByAi(masked, channel);
      // Fill any field the AI could not verify with the rule-based value.
      for (const k of CHANNEL_FIELDS[channel]) {
        if (ai.fields[k]?.value === null && rules.fields[k]?.value !== null) {
          ai.fields[k] = rules.fields[k];
          ai.warnings.push(`${FIELD_LABELS[k]} filled by keyword matching.`);
        }
      }
      return { ...ai, warnings: [...warnings, ...ai.warnings], preview };
    } catch (e) {
      const msg = e instanceof AiUnavailableError ? "AI unavailable" : "AI error";
      warnings.push(`${msg} — used keyword matching instead.`);
    }
  }
  if (!hasAny(rules) && masked.trim()) warnings.push("No numbers recognised automatically. Enter them manually.");
  return { ...rules, warnings, preview };
}
