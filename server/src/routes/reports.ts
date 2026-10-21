import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { isAiEnabled, isMailConfigured, isWaCloudConfigured } from "../lib/config";
import { canEdit, requireAuth } from "../middleware/auth";
import { dateStr, idParam, validate } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { todayIn } from "../lib/dates";
import { createReport, parseReport, waMeLink } from "../services/report";
import { emailReport, whatsappReport } from "../services/delivery";
import { getSettings } from "../services/settings";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function present(r: { id: number; reportDate: string; kind: string; kpisJson: string; summary: string; whatsappText: string; sentVia: string | null; sentTo: string | null; createdAt: Date }, waNumbers: string[]) {
  return {
    id: r.id,
    reportDate: r.reportDate,
    kind: r.kind,
    data: parseReport(r),
    summary: r.summary,
    whatsappText: r.whatsappText,
    waLinks: waNumbers.length ? waNumbers.map((n) => ({ number: n, url: waMeLink(r.whatsappText, n) })) : [{ number: "", url: waMeLink(r.whatsappText) }],
    sentVia: r.sentVia,
    sentTo: r.sentTo,
    createdAt: r.createdAt,
  };
}

reportsRouter.get("/capabilities", validate(), (_req, res) => {
  res.json({ ai: isAiEnabled(), email: isMailConfigured(), whatsappApi: isWaCloudConfigured() });
});

// History
reportsRouter.get("/", validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), date: dateStr.optional() }) }), async (req, res) => {
  const { limit, date } = req.valid.query as { limit: number; date?: string };
  const rows = await prisma.report.findMany({
    where: { companyId: req.user!.companyId, ...(date ? { reportDate: date } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, reportDate: true, kind: true, summary: true, sentVia: true, sentTo: true, createdAt: true },
  });
  res.json({ reports: rows });
});

reportsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const r = await prisma.report.findFirst({ where: { id, companyId: req.user!.companyId } });
  if (!r) throw new HttpError(404, "Report not found.");
  const settings = await getSettings(req.user!.companyId);
  res.json({ report: present(r, settings.reportWhatsapp), logo: settings.logo });
});

// Generate (builds KPIs in code + AI summary) and store
reportsRouter.post("/", canEdit, validate({ body: z.object({ date: dateStr }) }), async (req, res) => {
  const { date } = req.valid.body as { date: string };
  const companyId = req.user!.companyId;
  const settings = await getSettings(companyId);
  if (date > todayIn(settings.timezone)) throw new HttpError(400, "Cannot create a report for a future date.");
  const { report } = await createReport(companyId, date, "manual", req.user!.id);
  await audit(req, { action: "create", entity: "report", entityId: report.id, details: { date, kind: "manual" } });
  res.status(201).json({ report: present(report, settings.reportWhatsapp), logo: settings.logo });
});

// Email now (optionally with the PNG made in the browser)
reportsRouter.post(
  "/:id/email",
  canEdit,
  validate({
    params: idParam,
    body: z.object({ image: z.string().max(8_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Image must be a PNG data URL").optional() }),
  }),
  async (req, res) => {
    const { id } = req.valid.params as { id: number };
    const { image } = req.valid.body as { image?: string };
    try {
      const sent = await emailReport(req.user!.companyId, id, image);
      await audit(req, { action: "send_email", entity: "report", entityId: id, details: { to: sent.to } });
      res.json({ ok: true, to: sent.to });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  },
);

// Optional WhatsApp Cloud API send
reportsRouter.post("/:id/whatsapp", canEdit, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  if (!isWaCloudConfigured()) throw new HttpError(400, "WhatsApp Cloud API is not configured. Use 'Open in WhatsApp' instead.");
  try {
    const results = await whatsappReport(req.user!.companyId, id);
    await audit(req, { action: "send_whatsapp", entity: "report", entityId: id, details: { results } });
    res.json({ results });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// Record that the user copied/opened the WhatsApp text (for the history column)
reportsRouter.post("/:id/shared", canEdit, validate({ params: idParam, body: z.object({ via: z.enum(["whatsapp_link", "copy", "png", "pdf"]) }) }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const { via } = req.valid.body as { via: string };
  const r = await prisma.report.findFirst({ where: { id, companyId: req.user!.companyId } });
  if (!r) throw new HttpError(404, "Report not found.");
  if (via === "whatsapp_link") {
    const parts = new Set((r.sentVia ?? "").split(",").filter(Boolean));
    parts.add("whatsapp_link");
    await prisma.report.update({ where: { id }, data: { sentVia: [...parts].join(",") } });
  }
  await audit(req, { action: "share", entity: "report", entityId: id, details: { via } });
  res.json({ ok: true });
});
