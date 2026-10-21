import { prisma } from "../lib/db";
import { fmtInt, fmtPct, KPI_KEYS, KPI_LABELS, fmtKpi, type KpiChange, type KpiKey, type Kpis } from "../lib/kpi";
import { monthOf, prettyDate } from "../lib/dates";
import { companyContext, daySnapshot, monthProgress, type DaySnapshot } from "./mis";
import { generateSummary } from "./summary";

export interface ReportKpis {
  companyName: string;
  date: string;
  prettyDate: string;
  kpis: Kpis;
  changes: Record<KpiKey, KpiChange>;
  previousDate: string | null;
  previousLabel: string;
  campaigns: DaySnapshot["campaigns"];
  monthToDate: Awaited<ReturnType<typeof monthProgress>>;
  summarySource: "ai" | "template";
  summaryModel?: string;
}

const arrow = (c: KpiChange) => (c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "•");

export function buildWhatsappText(r: ReportKpis, summary: string): string {
  const k = r.kpis;
  const c = r.changes;
  return [
    `*Daily MIS Report — ${r.companyName}*`,
    `📅 ${r.prettyDate}`,
    ``,
    `*WhatsApp*`,
    `• Sent: ${fmtInt(k.waSent)} (${c.waSent.words})`,
    `• Delivered: ${fmtInt(k.waDelivered)} (${c.waDelivered.words})`,
    `• Delivery: ${fmtPct(k.deliveryPct)} (${c.deliveryPct.words})`,
    ``,
    `*Email*`,
    `• Sent: ${fmtInt(k.emailSent)} (${c.emailSent.words})`,
    `• Opened: ${fmtInt(k.emailOpened)} (${c.emailOpened.words})`,
    `• Open rate: ${fmtPct(k.openPct)} (${c.openPct.words})`,
    ``,
    `*Summary*`,
    summary,
    ``,
    `_Sent via Smart MIS_`,
  ].join("\n");
}

export function waMeLink(text: string, number?: string): string {
  const n = (number ?? "").replace(/\D/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Email-safe HTML (inline styles, tables) — also the fallback when no PNG is attached. */
export function buildEmailHtml(r: ReportKpis, summary: string, opts: { logo?: string | null; imageCid?: string } = {}): string {
  const color = (c: KpiChange) => (c.direction === "up" ? "#047857" : c.direction === "down" ? "#b91c1c" : "#475569");
  const cells = KPI_KEYS.map(
    (key) => `<td style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;width:33%;vertical-align:top">
      <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${esc(KPI_LABELS[key])}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px">${esc(fmtKpi(key, r.kpis[key]))}</div>
      <div style="font-size:12px;color:${color(r.changes[key])};margin-top:2px">${arrow(r.changes[key])} ${esc(r.changes[key].words)}</div>
    </td>`,
  );
  const rows = [cells.slice(0, 3), cells.slice(3, 6)].map((c) => `<tr>${c.join("")}</tr>`).join("");
  const campaigns = r.campaigns.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
        <tr style="background:#f1f5f9;text-align:left"><th style="padding:6px 8px">Campaign</th><th style="padding:6px 8px;text-align:right">WA sent</th><th style="padding:6px 8px;text-align:right">WA delivered</th><th style="padding:6px 8px;text-align:right">Emails sent</th><th style="padding:6px 8px;text-align:right">Opened</th></tr>
        ${r.campaigns
          .map(
            (c) =>
              `<tr><td style="padding:6px 8px;border-top:1px solid #e2e8f0">${esc(c.campaign)}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right">${fmtInt(c.waRecipients)}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right">${fmtInt(c.waDelivered)}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right">${fmtInt(c.emailSent)}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right">${fmtInt(c.emailOpened)}</td></tr>`,
          )
          .join("")}
      </table>`
    : "";
  const logo = opts.logo && /^data:image\/(png|jpeg);base64,/.test(opts.logo) ? `<img src="cid:company-logo" alt="" style="height:36px;margin-right:10px;vertical-align:middle">` : "";
  const image = opts.imageCid ? `<p style="margin:16px 0"><img src="cid:${opts.imageCid}" alt="Report card" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px"></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">
      ${logo}<span style="font-size:18px;font-weight:700;vertical-align:middle">${esc(r.companyName)}</span>
      <div style="font-size:13px;opacity:.9;margin-top:4px">Daily MIS Report · ${esc(r.prettyDate)}</div>
    </div>
    <div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px">
      <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px">${rows}</table>
      <h3 style="font-size:14px;margin:16px 8px 6px">Summary</h3>
      <p style="font-size:14px;line-height:1.6;margin:0 8px">${esc(summary)}</p>
      ${campaigns}
      ${image}
      <p style="font-size:11px;color:#94a3b8;margin-top:20px">All figures are calculated from the entered data. Generated by Smart MIS.</p>
    </div>
  </div></body></html>`;
}

/** Builds and stores a report for one day. */
export async function createReport(companyId: number, date: string, kind: "manual" | "auto", userId: number | null) {
  const ctx = await companyContext(companyId);
  const snap = await daySnapshot(companyId, date, ctx);
  const mtd = await monthProgress(companyId, monthOf(date), date);
  const summary = await generateSummary({
    companyName: ctx.company.name,
    date,
    kpis: snap.kpis,
    changes: snap.changes,
    previousLabel: snap.previousLabel,
    monthToDate: mtd.hasTarget ? mtd.items : [],
  });
  const kpisJson: ReportKpis = {
    companyName: ctx.company.name,
    date,
    prettyDate: prettyDate(date),
    kpis: snap.kpis,
    changes: snap.changes,
    previousDate: snap.previousDate,
    previousLabel: snap.previousLabel,
    campaigns: snap.campaigns,
    monthToDate: mtd,
    summarySource: summary.source,
    summaryModel: summary.model,
  };
  const whatsappText = buildWhatsappText(kpisJson, summary.text);
  const report = await prisma.report.create({
    data: { companyId, reportDate: date, kind, kpisJson: JSON.stringify(kpisJson), summary: summary.text, whatsappText, createdBy: userId },
  });
  return { report, data: kpisJson, logo: ctx.settings.logo, settings: ctx.settings };
}

export function parseReport(r: { kpisJson: string }): ReportKpis {
  return JSON.parse(r.kpisJson) as ReportKpis;
}
