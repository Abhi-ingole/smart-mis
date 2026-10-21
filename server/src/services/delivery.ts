import { prisma } from "../lib/db";
import { prettyDate } from "../lib/dates";
import { buildEmailHtml, parseReport } from "./report";
import { dataUrlAttachment, sendMail, type MailAttachment } from "./mailer";
import { getSettings } from "./settings";
import { sendWhatsappText } from "./whatsappCloud";

function appendSent(prev: string | null, add: string) {
  const parts = new Set((prev ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  parts.add(add);
  return [...parts].join(",");
}

/** Emails a stored report to the company's report recipients. */
export async function emailReport(companyId: number, reportId: number, image?: string | null) {
  const report = await prisma.report.findFirst({ where: { id: reportId, companyId } });
  if (!report) throw new Error("Report not found.");
  const settings = await getSettings(companyId);
  const data = parseReport(report);
  const attachments: MailAttachment[] = [];
  const logo = dataUrlAttachment(settings.logo, "logo.png", "company-logo");
  if (logo) attachments.push(logo);
  const card = dataUrlAttachment(image, `mis-report-${report.reportDate}.png`, "report-card");
  if (card) attachments.push(card);
  const html = buildEmailHtml(data, report.summary, { logo: logo ? settings.logo : null, imageCid: card ? "report-card" : undefined });
  const sent = await sendMail({
    to: settings.reportEmails,
    subject: `Daily MIS Report — ${data.companyName} — ${prettyDate(report.reportDate)}`,
    html,
    text: report.whatsappText.replace(/\*/g, "").replace(/_/g, ""),
    attachments,
  });
  await prisma.report.update({
    where: { id: report.id },
    data: { sentVia: appendSent(report.sentVia, "email"), sentTo: appendSent(report.sentTo, sent.to.join(",")) },
  });
  return sent;
}

export async function whatsappReport(companyId: number, reportId: number) {
  const report = await prisma.report.findFirst({ where: { id: reportId, companyId } });
  if (!report) throw new Error("Report not found.");
  const settings = await getSettings(companyId);
  if (!settings.reportWhatsapp.length) throw new Error("No WhatsApp numbers are set. Add them in Settings → Report recipients.");
  const results = await sendWhatsappText(settings.reportWhatsapp, report.whatsappText);
  const okTo = results.filter((r) => r.ok).map((r) => r.to);
  if (okTo.length) {
    await prisma.report.update({
      where: { id: report.id },
      data: { sentVia: appendSent(report.sentVia, "whatsapp_api"), sentTo: appendSent(report.sentTo, okTo.join(",")) },
    });
  }
  return results;
}
