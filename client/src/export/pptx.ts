/**
 * PowerPoint export. A plain, corporate 16:9 deck: title slide, summary with KPI
 * tiles, one slide per captured visual, category tables, insights and data quality.
 * Built in the browser with pptxgenjs; nothing is uploaded.
 */
import PptxGenJS from "pptxgenjs";
import type { ReportModel } from "../engine/report";
import { fmtDate } from "../engine/format";

export interface DeckImage {
  title: string;
  png: string;
  width: number;
  height: number;
  note?: string;
}

const NAVY = "0B1B36";
const INK = "141A2E";
const SOFT = "566074";
const FAINT = "8A93A6";
const LINE = "E3E7EF";
const ACCENT = "1D4E89";
const TEAL = "2A9D8F";
const FONT = "Calibri";
const W = 13.333;
const H = 7.5;

function frame(pptx: PptxGenJS, title: string, subtitle: string | undefined, footer: string, page: number) {
  const s = pptx.addSlide();
  s.background = { color: "FFFFFF" };
  s.addShape("rect", { x: 0, y: 0, w: W, h: 0.08, fill: { color: NAVY }, line: { color: NAVY } });
  s.addText(title, { x: 0.5, y: 0.3, w: W - 1, h: 0.55, fontFace: FONT, fontSize: 24, bold: true, color: INK, margin: 0 });
  if (subtitle) s.addText(subtitle, { x: 0.5, y: 0.85, w: W - 1, h: 0.35, fontFace: FONT, fontSize: 12, color: SOFT, margin: 0 });
  s.addShape("line", { x: 0.5, y: H - 0.5, w: W - 1, h: 0, line: { color: LINE, width: 0.75 } });
  s.addText(footer, { x: 0.5, y: H - 0.45, w: W - 2, h: 0.3, fontFace: FONT, fontSize: 9, color: FAINT, margin: 0 });
  s.addText(String(page), { x: W - 1.5, y: H - 0.45, w: 1, h: 0.3, fontFace: FONT, fontSize: 9, color: FAINT, align: "right", margin: 0 });
  return s;
}

const fit = (iw: number, ih: number, bw: number, bh: number) => {
  const r = Math.min(bw / iw, bh / ih);
  return { w: iw * r, h: ih * r };
};

export async function reportPptx(model: ReportModel, images: DeckImage[], logo?: string): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Smart MIS by INGOVIQ AI";
  pptx.company = "INGOVIQ AI";
  pptx.title = model.title;

  const period = model.period ? `${fmtDate(model.period.from)} – ${fmtDate(model.period.to)}` : "";
  const generated = fmtDate(model.generatedAt.slice(0, 10));
  const footer = `${model.title}${period ? ` · ${period}` : ""}`;
  let page = 1;

  // 1. Title
  const t = pptx.addSlide();
  t.background = { color: NAVY };
  if (logo) t.addImage({ data: logo, x: 0.7, y: 0.6, w: 2.6, h: 0.81 });
  t.addShape("rect", { x: 0.7, y: 2.75, w: 0.09, h: 1.45, fill: { color: "05C0FC" }, line: { color: "05C0FC" } });
  t.addText(model.title, { x: 1.0, y: 2.6, w: W - 2, h: 1.0, fontFace: FONT, fontSize: 36, bold: true, color: "FFFFFF", margin: 0, valign: "top" });
  t.addText([period || "All records", model.filtersNote ? `Filters: ${model.filtersNote}` : ""].filter(Boolean).join("   ·   "), {
    x: 1.0,
    y: 3.65,
    w: W - 2,
    h: 0.5,
    fontFace: FONT,
    fontSize: 16,
    color: "C3CDE0",
    margin: 0,
  });
  t.addText(`Generated ${generated} · Smart MIS`, { x: 0.7, y: H - 0.9, w: W - 1.4, h: 0.4, fontFace: FONT, fontSize: 11, color: "7D8CAB", margin: 0 });

  // 2. Summary + KPI tiles
  const kpis = model.kpis.filter((k) => k.value !== "—").slice(0, 8);
  const s = frame(pptx, "Executive summary", model.periodNote, footer, ++page);
  const cols = Math.min(4, Math.max(1, kpis.length));
  const tileW = (W - 1 - (cols - 1) * 0.2) / cols;
  kpis.forEach((k, i) => {
    const x = 0.5 + (i % cols) * (tileW + 0.2);
    const y = 1.45 + Math.floor(i / cols) * 1.35;
    s.addShape("rect", { x, y, w: tileW, h: 1.15, fill: { color: "F8F9FC" }, line: { color: LINE, width: 0.75 } });
    s.addShape("rect", { x, y, w: 0.06, h: 1.15, fill: { color: ACCENT }, line: { color: ACCENT } });
    s.addText(k.name.toUpperCase(), { x: x + 0.2, y: y + 0.1, w: tileW - 0.3, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: SOFT, margin: 0 });
    s.addText(k.value, { x: x + 0.2, y: y + 0.4, w: tileW - 0.3, h: 0.45, fontFace: FONT, fontSize: 20, bold: true, color: INK, margin: 0, fit: "shrink" });
    if (k.comparison) {
      const down = k.comparison.startsWith("Down");
      s.addText(k.comparison, {
        x: x + 0.2,
        y: y + 0.83,
        w: tileW - 0.3,
        h: 0.25,
        fontFace: FONT,
        fontSize: 9,
        color: down ? "C2362F" : k.comparison.startsWith("Up") ? "1F8A5B" : FAINT,
        margin: 0,
        fit: "shrink",
      });
    }
  });
  const rowsUsed = Math.ceil(kpis.length / cols);
  const textY = 1.45 + rowsUsed * 1.35 + 0.1;
  if (model.executiveSummary.length && textY < H - 1.2) {
    s.addText(
      model.executiveSummary.slice(0, 6).map((p) => ({ text: p, options: { bullet: { indent: 14 }, paraSpaceAfter: 6 } })),
      { x: 0.5, y: textY, w: W - 1, h: H - 0.7 - textY, fontFace: FONT, fontSize: 13, color: INK, valign: "top", margin: 0, fit: "shrink" },
    );
  }

  // 3. Visuals — one per slide, sized to fit
  for (const img of images) {
    const sl = frame(pptx, img.title, img.note, footer, ++page);
    const box = { x: 0.5, y: 1.35, w: W - 1, h: H - 2.05 };
    const { w, h } = fit(img.width, img.height, box.w, box.h);
    sl.addImage({ data: img.png, x: box.x + (box.w - w) / 2, y: box.y, w, h });
  }

  // 4. Category tables (two per slide)
  for (let i = 0; i < model.categories.length; i += 2) {
    const pair = model.categories.slice(i, i + 2);
    const sl = frame(pptx, "Category analysis", pair.map((c) => c.title).join("  ·  "), footer, ++page);
    pair.forEach((c, j) => {
      const x = 0.5 + j * ((W - 1) / 2 + 0.1);
      const w = (W - 1) / pair.length - (pair.length > 1 ? 0.1 : 0);
      const head = [c.dimension, c.measure, "Share"].map((h) => ({ text: h, options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } }));
      const body = c.rows
        .slice(0, 12)
        .map((r, k) => [r.label, r.value, r.share].map((v, n) => ({ text: v, options: { align: (n ? "right" : "left") as "right" | "left", fill: { color: k % 2 ? "F8F9FC" : "FFFFFF" } } })));
      sl.addText(c.title, { x, y: 1.3, w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: INK, margin: 0 });
      sl.addTable([head, ...body], { x, y: 1.7, w, colW: [w * 0.5, w * 0.3, w * 0.2], fontFace: FONT, fontSize: 10, color: INK, border: { type: "solid", color: LINE, pt: 0.5 }, rowH: 0.3 });
    });
  }

  // 5. Insights & recommendations
  if (model.insights.length || model.recommendations.length) {
    const sl = frame(pptx, "Key insights", "Calculated from the data; every number can be traced to its column.", footer, ++page);
    const half = (W - 1.3) / 2;
    sl.addText("What the data shows", { x: 0.5, y: 1.35, w: half, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: ACCENT, margin: 0 });
    sl.addText(
      (model.insights.length ? model.insights : ["No notable patterns were found."]).slice(0, 7).map((p) => ({ text: p, options: { bullet: { indent: 14 }, paraSpaceAfter: 6 } })),
      { x: 0.5, y: 1.8, w: half, h: H - 2.5, fontFace: FONT, fontSize: 12, color: INK, valign: "top", margin: 0, fit: "shrink" },
    );
    sl.addText("Recommended actions", { x: 0.8 + half, y: 1.35, w: half, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: TEAL, margin: 0 });
    sl.addText(
      (model.recommendations.length ? model.recommendations : ["No actions suggested."]).slice(0, 7).map((p) => ({ text: p, options: { bullet: { indent: 14 }, paraSpaceAfter: 6 } })),
      { x: 0.8 + half, y: 1.8, w: half, h: H - 2.5, fontFace: FONT, fontSize: 12, color: INK, valign: "top", margin: 0, fit: "shrink" },
    );
  }

  // 6. Data quality
  const q = frame(pptx, "Data quality", model.quality.formula, footer, ++page);
  q.addText(String(model.quality.score), {
    x: 0.5,
    y: 1.4,
    w: 2.2,
    h: 1.1,
    fontFace: FONT,
    fontSize: 54,
    bold: true,
    color: model.quality.score >= 80 ? "1F8A5B" : model.quality.score >= 60 ? "A96200" : "C2362F",
    margin: 0,
  });
  q.addText("out of 100", { x: 0.5, y: 2.45, w: 2.2, h: 0.3, fontFace: FONT, fontSize: 11, color: SOFT, margin: 0 });
  const issues = model.quality.issues.slice(0, 10);
  if (issues.length) {
    q.addTable(
      [
        [
          { text: "Severity", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
          { text: "Issue", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
        ],
        ...issues.map((i, k) => [
          { text: i.severity, options: { color: i.severity === "high" ? "C2362F" : i.severity === "medium" ? "A96200" : SOFT, fill: { color: k % 2 ? "F8F9FC" : "FFFFFF" } } },
          { text: i.message, options: { fill: { color: k % 2 ? "F8F9FC" : "FFFFFF" } } },
        ]),
      ],
      { x: 3.1, y: 1.4, w: W - 3.6, colW: [1.2, W - 4.8], fontFace: FONT, fontSize: 10, color: INK, border: { type: "solid", color: LINE, pt: 0.5 } },
    );
  } else q.addText("No data quality issues were found.", { x: 3.1, y: 1.5, w: 8, h: 0.4, fontFace: FONT, fontSize: 14, color: INK, margin: 0 });

  return (await pptx.write({ outputType: "blob" })) as Blob;
}
