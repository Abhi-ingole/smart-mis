import { useState } from "react";
import { toJpeg } from "html-to-image";
import type { ExportKind } from "../components/ExportMenu";
import { useToast } from "../components/ui";
import { buildReport, type ReportModel, type SectionId } from "../engine/report";
import type { Analysis } from "../engine/pipeline";
import type { DatasetRecord, KpiValue } from "../engine/types";
import type { InsightResult } from "../engine/insights";
import { download, reportPdf, reportWorkbook, tableCsv } from "../export/exporters";
import logoUrl from "../assets/ingoviq-logo-light.png";

const ALL_SECTIONS = new Set<SectionId>(["summary", "overview", "kpis", "trends", "categories", "exceptions", "quality", "insights", "recommendations", "appendix"]);
export const safeName = (s: string) =>
  s
    .replace(/[^\w\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "report";

export interface CapturedImage {
  title: string;
  png: string;
  width: number;
  height: number;
  note?: string;
}

/** Pictures of every element marked data-capture inside `root`, in page order. */
export async function captureVisuals(root: ParentNode = document): Promise<CapturedImage[]> {
  const out: CapturedImage[] = [];
  for (const node of root.querySelectorAll<HTMLElement>("[data-capture]")) {
    if (!node.offsetWidth || !node.offsetHeight) continue;
    const png = await toJpeg(node, {
      pixelRatio: 1.8,
      quality: 0.9,
      backgroundColor: "#ffffff",
      cacheBust: true,
      // Toggle buttons belong on screen, not in a report.
      filter: (n) => !(n instanceof HTMLElement && (n.getAttribute("role") === "radiogroup" || n.classList.contains("no-capture"))),
    });
    out.push({ title: node.dataset.captureTitle ?? "", note: node.dataset.captureNote, png, width: node.offsetWidth, height: node.offsetHeight });
  }
  return out;
}

async function logoData(): Promise<string | undefined> {
  try {
    const blob = await (await fetch(logoUrl)).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => res(undefined);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export interface ExportInput {
  record: DatasetRecord;
  analysis: Analysis;
  rows: number[];
  kpiValues: KpiValue[];
  insights: InsightResult;
  filtersNote: string | null;
  title?: string;
  sections?: Set<SectionId>;
  appendixRows?: number;
  /** Where to look for [data-capture] visuals. */
  root?: () => ParentNode | null | undefined;
}

export function buildModel(i: ExportInput): ReportModel {
  return buildReport({
    meta: i.record,
    title: i.title,
    table: i.analysis.table,
    rows: i.rows,
    profiles: i.analysis.profiles,
    quality: i.analysis.quality,
    dashboard: i.record.dashboard,
    kpiValues: i.kpiValues,
    insights: i.insights,
    filtersNote: i.filtersNote,
    appendixRows: i.appendixRows ?? 50,
  });
}

/** Creates the file for an export format and returns it (used by the export menu and by scheduled reports). */
export async function makeExport(kind: ExportKind, i: ExportInput): Promise<{ name: string; blob: Blob }> {
  const model = buildModel(i);
  const base = safeName(model.title);
  const sections = i.sections ?? ALL_SECTIONS;
  if (kind === "csv") return { name: `${base} - data.csv`, blob: new Blob([tableCsv(i.analysis.table, i.rows)], { type: "text/csv;charset=utf-8" }) };
  if (kind === "xlsx")
    return { name: `${base}.xlsx`, blob: new Blob([reportWorkbook(model, i.analysis.table, i.rows) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
  const root = i.root ? i.root() : document;
  const images = sections.has("trends") && root ? await captureVisuals(root) : [];
  if (kind === "pdf") return { name: `${base}.pdf`, blob: await reportPdf(model, images, sections) };
  const { reportPptx } = await import("../export/pptx");
  return { name: `${base}.pptx`, blob: await reportPptx(model, images, await logoData()) };
}

/**
 * Export with progress state. Charts are re-rendered without animation (`capturing`)
 * before they are photographed, so the pictures are complete.
 */
export function useExport(input: () => ExportInput) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [capturing, setCapturing] = useState(false);
  const toast = useToast();
  const run = async (kind: ExportKind) => {
    setBusy(kind);
    const visual = kind === "pdf" || kind === "pptx";
    if (visual) {
      setCapturing(true);
      await new Promise((r) => setTimeout(r, 900));
    }
    try {
      const { name, blob } = await makeExport(kind, input());
      download(name, blob, blob.type);
      toast("success", `${name} downloaded.`);
    } catch (e) {
      toast("error", `Couldn't create the file: ${(e as Error).message}`);
    } finally {
      setCapturing(false);
      setBusy(null);
    }
  };
  return { run, busy, capturing };
}
