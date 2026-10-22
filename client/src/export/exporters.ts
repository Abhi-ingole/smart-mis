/**
 * Exports: CSV (formula-injection safe), Excel workbook, and PDF report.
 * Everything is generated in the browser — no upload needed.
 */
import * as XLSX from "@e965/xlsx";
import type { Table } from "../engine/types";
import type { ReportModel } from "../engine/report";
import { fmtDate } from "../engine/format";

/** Cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheet apps don't run them as formulas. */
export function safeCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

export function tableCsv(table: Table, rows: number[]): string {
  const visible = table.schema.filter((c) => !c.excluded);
  return toCsv(
    visible.map((c) => c.name),
    rows.map((i) => visible.map((c) => table.str[c.key][i])),
  );
}

export function download(name: string, data: BlobPart | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeAoa = (aoa: (string | number | boolean | null)[][]) => aoa.map((r) => r.map((v) => (typeof v === "string" ? safeCell(v) : v ?? "")));

function sheet(aoa: (string | number | boolean | null)[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(safeAoa(aoa));
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

/** Excel workbook: Summary, KPIs, Categories, Insights, Data quality, Data. */
export function reportWorkbook(model: ReportModel, table: Table, rows: number[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        [model.title],
        [`Generated ${fmtDate(model.generatedAt.slice(0, 10))}`],
        ["Reporting period", model.periodNote],
        ...(model.filtersNote ? [["Filters", model.filtersNote]] : []),
        [],
        ["Executive summary"],
        ...model.executiveSummary.map((s) => [s]),
        [],
        ["Dataset overview"],
        ...model.overview.map((o) => [o.label, o.value]),
      ],
      [28, 90],
    ),
    "Summary",
  );
  XLSX.utils.book_append_sheet(wb, sheet([["KPI", "Value", "Comparison", "Formula", "Description"], ...model.kpis.map((k) => [k.name, k.value, k.comparison ?? "", k.formula, k.description])], [30, 22, 30, 50, 60]), "KPIs");
  const cats: (string | null)[][] = [];
  for (const c of model.categories) {
    cats.push([c.title], [c.dimension, c.measure, "Share"], ...c.rows.map((r) => [r.label, r.value, r.share]), []);
  }
  if (cats.length) XLSX.utils.book_append_sheet(wb, sheet(cats, [32, 20, 12]), "Categories");
  XLSX.utils.book_append_sheet(
    wb,
    sheet([["Key insights (observations)"], ...model.insights.map((s) => [s]), [], ["Recommendations"], ...model.recommendations.map((s) => [s]), [], ["Exceptions and anomalies"], ...model.exceptions.map((s) => [s])], [120]),
    "Insights",
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet([["Quality score", model.quality.score], ["Formula", model.quality.formula], [], ["Severity", "Issue"], ...model.quality.issues.map((i) => [i.severity, i.message]), [], ["Column", "Type", "Role", "Missing"], ...model.columns.map((c) => [c.name, c.type, c.role, c.missing])], [14, 100, 14, 10]),
    "Data quality",
  );
  // Full (cleaned, filtered) data with real numbers where the column is numeric.
  const visible = table.schema.filter((c) => !c.excluded);
  const dataAoa: (string | number | null)[][] = [visible.map((c) => c.name)];
  for (const i of rows) {
    dataAoa.push(
      visible.map((c) => {
        const n = table.num[c.key]?.[i];
        if (n !== undefined && n !== null && (c.type === "number" || c.type === "currency" || c.type === "percentage")) return n;
        return table.str[c.key][i];
      }),
    );
  }
  XLSX.utils.book_append_sheet(wb, sheet(dataAoa), "Data");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

/** jsPDF's built-in fonts only cover Latin-1 (WinAnsi). Map common symbols; others become "?". */
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfText(s: string): string {
  return s
    .replace(/₹\s?(?=[\d-])/g, "Rs. ")
    .replace(/₹/g, "Rs")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[−‒]/g, "-")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[↑▲]/g, "^")
    .replace(/[↓▼]/g, "v")
    .replace(/≈/g, "~")
    .replace(/[^\x00-\xff]/g, (ch) => (WINANSI_EXTRA.has(ch) ? ch : "?"));
}

/** PDF report. Chart images (PNG data URLs) are captured from the on-screen preview. */
export async function reportPdf(model: ReportModel, chartImages: { title: string; png: string; width: number; height: number }[], include: Set<string>): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;
  const ink: [number, number, number] = [23, 30, 46];
  const soft: [number, number, number] = [92, 102, 122];
  const accent: [number, number, number] = [59, 79, 216];

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t: string) => {
    ensure(90);
    y += 8;
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...ink).text(pdfText(t), M, y);
    y += 6;
    doc.setDrawColor(...accent).setLineWidth(1.5).line(M, y, M + 36, y);
    y += 14;
  };
  const para = (t: string, size = 10, color = soft) => {
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(t), W - 2 * M) as string[];
    for (const line of lines) {
      ensure(size + 4);
      doc.text(line, M, y);
      y += size + 4;
    }
    y += 2;
  };
  const bullets = (items: string[]) => items.forEach((t) => para(`•  ${t}`));
  const table = (head: string[], body: (string | null)[][], widths?: Record<number, number>) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(pdfText)],
      body: body.map((r) => r.map((v) => pdfText(v ?? ""))),
      margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 4, textColor: ink, overflow: "linebreak" },
      headStyles: { fillColor: [238, 241, 252], textColor: ink, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 251, 253] },
      columnStyles: widths ? Object.fromEntries(Object.entries(widths).map(([k, w]) => [k, { cellWidth: w }])) : undefined,
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;
  };

  // Title block
  doc.setFillColor(...accent).rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(...ink);
  const titleLines = doc.splitTextToSize(pdfText(model.title), W - 2 * M) as string[];
  y = 56;
  titleLines.forEach((l) => {
    doc.text(l, M, y);
    y += 24;
  });
  para(`Reporting period: ${model.periodNote}`, 10);
  para(`Generated ${fmtDate(model.generatedAt.slice(0, 10))} · Smart MIS`, 9);
  if (model.filtersNote) para(`Filters applied: ${model.filtersNote}`, 9);

  if (include.has("summary")) {
    heading("Executive summary");
    bullets(model.executiveSummary);
  }
  if (include.has("overview")) {
    heading("Dataset overview");
    table(["Item", "Detail"], model.overview.map((o) => [o.label, o.value]), { 0: 140 });
  }
  if (include.has("kpis")) {
    heading("Key performance indicators");
    table(["KPI", "Value", "Comparison", "Formula"], model.kpis.map((k) => [k.name, k.value, k.comparison ?? "—", k.formula]), { 0: 120, 1: 90, 2: 110 });
  }
  if (include.has("trends") && chartImages.length) {
    heading("Trends and visual analysis");
    // Charts at their on-screen size (1 px ≈ 0.75 pt); small charts sit two per row.
    const full = W - 2 * M;
    const gap = 16;
    let col = 0;
    let rowH = 0;
    for (const img of chartImages) {
      let w = Math.min(full, img.width * 0.75);
      let h = (img.height / img.width) * w;
      if (h > 300) {
        w = (w * 300) / h;
        h = 300;
      }
      const half = (full - gap) / 2;
      const twoUp = w <= half + 1;
      if (twoUp) {
        w = Math.min(w, half);
        h = (img.height / img.width) * w;
      }
      if (!twoUp || col === 0) {
        if (col === 1) {
          y += rowH + 16;
          col = 0;
          rowH = 0;
        }
        ensure(h + 24);
      }
      const x = twoUp && col === 1 ? M + half + gap : M;
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...ink).text(pdfText(img.title).slice(0, twoUp ? 60 : 120), x, y);
      doc.addImage(img.png, img.png.startsWith("data:image/jpeg") ? "JPEG" : "PNG", x, y + 6, w, h, undefined, "FAST");
      if (twoUp && col === 0) {
        col = 1;
        rowH = h + 6;
      } else {
        y += Math.max(rowH, h + 6) + 16;
        col = 0;
        rowH = 0;
      }
    }
    if (col === 1) y += rowH + 16;
  }
  if (include.has("categories") && model.categories.length) {
    heading("Category analysis");
    for (const c of model.categories) {
      para(c.title, 10, ink);
      table([c.dimension, c.measure, "Share"], c.rows.map((r) => [r.label, r.value, r.share]));
    }
  }
  if (include.has("exceptions")) {
    heading("Exceptions and anomalies");
    model.exceptions.length ? bullets(model.exceptions) : para("No notable exceptions were found by the automatic checks.");
  }
  if (include.has("quality")) {
    heading("Data quality summary");
    para(`Quality score: ${model.quality.score}/100. Formula: ${model.quality.formula}.`);
    if (model.quality.issues.length) table(["Severity", "Issue"], model.quality.issues.map((i) => [i.severity, i.message]), { 0: 60 });
    else para("No data quality issues were found.");
  }
  if (include.has("insights")) {
    heading("Key insights");
    model.insights.length ? bullets(model.insights) : para("Not enough data for automatic insights.");
  }
  if (include.has("recommendations")) {
    heading("Recommendations");
    model.recommendations.length ? bullets(model.recommendations) : para("No evidence-based recommendations for this dataset.");
  }
  if (include.has("appendix")) {
    heading(`Detailed data appendix (first ${model.appendix.rows.length} of ${model.appendix.total.toLocaleString("en-IN")} rows)`);
    const maxCols = 8;
    const head = model.appendix.headers.slice(0, maxCols);
    table(head, model.appendix.rows.map((r) => r.slice(0, maxCols)));
    if (model.appendix.headers.length > maxCols) para(`${model.appendix.headers.length - maxCols} more column(s) are in the Excel export.`, 8);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...soft).text(pdfText(`${model.title} · page ${p} of ${pages}`), M, H - 20);
  }
  return doc.output("blob");
}
