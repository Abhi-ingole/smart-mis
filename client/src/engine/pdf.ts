/**
 * PDF table reader. Rebuilds a table from the positions of the text on each page,
 * so vendor reports, bank statements and exported MIS PDFs become a normal sheet.
 * Runs inside the upload Web Worker; the PDF never leaves the browser.
 *
 * Works for PDFs that contain real text. Scanned PDFs (photos of paper) have no
 * text layer and are reported as such rather than guessed at.
 */
import type { Cell, RawSheet } from "./types";
import { buildSheet, ParseError } from "./parse";

export const PDF_LIMITS = { maxPages: 300 };

interface Seg {
  text: string;
  x0: number;
  x1: number;
}
interface Line {
  y: number;
  size: number;
  segs: Seg[];
}
interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

/** Loads pdf.js lazily with its "fake worker" (same thread), so no extra worker file or CDN is needed. */
function loadPdfJs(): Promise<PdfJs> {
  lib ??= (async () => {
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>;
  })();
  return lib;
}

/** Splits a text run that uses runs of spaces for alignment into separate words. */
function splitRun(str: string, x: number, w: number, size: number): Word[] {
  const parts = str.split(/(\s{3,})/);
  if (parts.length === 1) return [{ text: str.trim(), x, w, y: 0, size }];
  const perChar = w / Math.max(1, str.length);
  const out: Word[] = [];
  let pos = 0;
  for (const p of parts) {
    if (p.trim() && !/^\s+$/.test(p)) out.push({ text: p.trim(), x: x + pos * perChar, w: p.length * perChar, y: 0, size });
    pos += p.length;
  }
  return out;
}

function toLines(words: Word[]): Line[] {
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; words: Word[] }[] = [];
  for (const w of words) {
    const tol = Math.max(2, w.size * 0.5);
    const line = lines.find((l) => Math.abs(l.y - w.y) <= tol);
    if (line) line.words.push(w);
    else lines.push({ y: w.y, size: w.size, words: [w] });
  }
  return lines.map((l) => {
    const sorted = l.words.sort((a, b) => a.x - b.x);
    const gapLimit = Math.max(4, l.size * 0.8);
    const segs: Seg[] = [];
    for (const w of sorted) {
      const last = segs[segs.length - 1];
      if (last && w.x - last.x1 <= gapLimit) {
        last.text += (w.x - last.x1 > l.size * 0.15 ? " " : "") + w.text;
        last.x1 = Math.max(last.x1, w.x + w.w);
      } else {
        segs.push({ text: w.text, x0: w.x, x1: w.x + w.w });
      }
    }
    return { y: l.y, size: l.size, segs };
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Finds the main table: the most common number of columns decides the layout,
 * then every multi-column line is aligned to those columns by horizontal overlap.
 */
export function linesToMatrix(lines: Line[]): { matrix: Cell[][]; ignored: number } {
  const multi = lines.filter((l) => l.segs.length >= 2);
  const freq = new Map<number, number>();
  for (const l of multi) freq.set(l.segs.length, (freq.get(l.segs.length) ?? 0) + 1);
  let cols = 0;
  let best = 0;
  for (const [n, c] of freq) if (c > best || (c === best && n > cols)) [cols, best] = [n, c];
  if (cols < 2 || best < 2) return { matrix: [], ignored: lines.length };

  const anchor = multi.filter((l) => l.segs.length === cols);
  const ranges = Array.from({ length: cols }, (_, j) => ({
    x0: Math.min(...anchor.map((l) => l.segs[j].x0)),
    x1: Math.max(...anchor.map((l) => l.segs[j].x1)),
    c: median(anchor.map((l) => (l.segs[j].x0 + l.segs[j].x1) / 2)),
  }));

  const matrix: Cell[][] = [];
  for (const l of multi) {
    if (l.segs.length > cols + 2) continue;
    const row: (string | null)[] = Array.from({ length: cols }, () => null);
    for (const s of l.segs) {
      let j = 0;
      let bestOverlap = -1;
      for (let k = 0; k < cols; k++) {
        const ov = Math.min(s.x1, ranges[k].x1) - Math.max(s.x0, ranges[k].x0);
        if (ov > bestOverlap) [bestOverlap, j] = [ov, k];
      }
      if (bestOverlap <= 0) {
        const mid = (s.x0 + s.x1) / 2;
        j = ranges.reduce((bi, r, k) => (Math.abs(r.c - mid) < Math.abs(ranges[bi].c - mid) ? k : bi), 0);
      }
      row[j] = row[j] ? `${row[j]} ${s.text}` : s.text;
    }
    matrix.push(row);
  }

  // Header rows repeated at the top of every page: keep only the first one.
  const key = (r: Cell[]) => r.map((c) => String(c ?? "").toLowerCase()).join("\u0001");
  const head = matrix.length ? key(matrix[0]) : "";
  const deduped = matrix.filter((r, i) => i === 0 || key(r) !== head);
  return { matrix: deduped, ignored: lines.length - multi.length };
}

export async function parsePdf(data: ArrayBuffer | Uint8Array, name: string): Promise<RawSheet[]> {
  const pdfjs = await loadPdfJs();
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as Error;
    if (err.name === "PasswordException") throw new ParseError(`"${name}" is password-protected. Remove the password and upload it again.`);
    throw new ParseError(`Couldn't open "${name}" as a PDF: ${err.message}`);
  }
  if (doc.numPages > PDF_LIMITS.maxPages) {
    await task.destroy();
    throw new ParseError(`"${name}" has ${doc.numPages} pages. The limit is ${PDF_LIMITS.maxPages}.`);
  }

  const lines: Line[] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const words: Word[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [a, b, , , x, y] = item.transform as number[];
      const size = Math.hypot(a, b) || item.height || 10;
      chars += item.str.trim().length;
      for (const w of splitRun(item.str, x, item.width, size)) words.push({ ...w, y });
    }
    // Pages are stacked so lines from different pages never merge.
    for (const l of toLines(words)) lines.push({ ...l, y: l.y - p * 100_000 });
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();

  if (chars < 20) throw new ParseError(`"${name}" looks like a scanned image — it has no readable text. Upload the original Excel/CSV, or a PDF exported from software (not a scan).`);

  const { matrix, ignored } = linesToMatrix(lines);
  if (matrix.length < 2) throw new ParseError(`No table was found in "${name}". Smart MIS reads PDFs that contain a table of rows and columns.`);

  const sheet = buildSheet(name.replace(/\.pdf$/i, ""), matrix);
  sheet.warnings.unshift(`Table rebuilt from a PDF (${pages} page${pages > 1 ? "s" : ""}). Check a few numbers against the original.`);
  if (ignored > 0) sheet.warnings.push(`${ignored} line(s) outside the table (titles, notes, page numbers) were ignored.`);
  return [sheet];
}
