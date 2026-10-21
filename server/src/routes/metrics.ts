import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { canEdit, requireAuth } from "../middleware/auth";
import { dateStr, idParam, validate } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { metricSchema, type MetricInput } from "../lib/validation";
import { addDays, todayIn } from "../lib/dates";
import { getSettings } from "../services/settings";
import { ownsUpload } from "../services/uploads";
import { pct } from "../lib/kpi";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

const publicFields = {
  id: true,
  reportDate: true,
  campaign: true,
  waRecipients: true,
  waDelivered: true,
  emailSent: true,
  emailOpened: true,
  notes: true,
  waSourceFile: true,
  emailSourceFile: true,
  waExtractedJson: true,
  emailExtractedJson: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function schemaFor(companyId: number) {
  const { timezone } = await getSettings(companyId);
  return metricSchema(() => todayIn(timezone));
}

async function assertFilesOwned(companyId: number, input: MetricInput) {
  for (const f of [input.waSourceFile, input.emailSourceFile]) {
    if (!(await ownsUpload(companyId, f))) throw new HttpError(400, "Referenced source file was not found.");
  }
}

// List entries for one date or a date range
metricsRouter.get(
  "/",
  validate({ query: z.object({ date: dateStr.optional(), from: dateStr.optional(), to: dateStr.optional() }) }),
  async (req, res) => {
    const { date, from, to } = req.valid.query as { date?: string; from?: string; to?: string };
    const companyId = req.user!.companyId;
    const where = date ? { companyId, reportDate: date } : { companyId, reportDate: { gte: from ?? "0000-00-00", lte: to ?? "9999-12-31" } };
    const rows = await prisma.dailyMetric.findMany({ where, select: publicFields, orderBy: [{ reportDate: "desc" }, { campaign: "asc" }], take: 2000 });
    res.json({ entries: rows });
  },
);

// Campaign names used before (for autocomplete)
metricsRouter.get("/campaigns", validate(), async (req, res) => {
  const rows = await prisma.dailyMetric.findMany({ where: { companyId: req.user!.companyId }, distinct: ["campaign"], select: { campaign: true }, orderBy: { campaign: "asc" }, take: 200 });
  res.json({ campaigns: rows.map((r) => r.campaign) });
});

// CSV / Excel export
metricsRouter.get(
  "/export",
  validate({ query: z.object({ from: dateStr.optional(), to: dateStr.optional(), format: z.enum(["csv", "xlsx"]).default("csv") }) }),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const { timezone } = await getSettings(companyId);
    const today = todayIn(timezone);
    const { from = addDays(today, -29), to = today, format } = req.valid.query as { from?: string; to?: string; format: "csv" | "xlsx" };
    const rows = await prisma.dailyMetric.findMany({ where: { companyId, reportDate: { gte: from, lte: to } }, orderBy: [{ reportDate: "asc" }, { campaign: "asc" }] });
    const header = ["Date", "Campaign", "WA sent", "WA delivered", "Delivery %", "Emails sent", "Emails opened", "Open %", "Notes"];
    const data = rows.map((r) => [r.reportDate, r.campaign, r.waRecipients, r.waDelivered, pct(r.waDelivered, r.waRecipients), r.emailSent, r.emailOpened, pct(r.emailOpened, r.emailSent), r.notes ?? ""]);
    await audit(req, { action: "export", entity: "daily_metrics", details: { from, to, format, rows: rows.length } });
    const filename = `smart-mis_${from}_to_${to}.${format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    if (format === "csv") {
      // Prefix cells that start with formula characters to prevent CSV injection in Excel.
      const cell = (v: unknown) => {
        let s = String(v ?? "");
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.send("﻿" + [header, ...data].map((r) => r.map(cell).join(",")).join("\r\n"));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Daily MIS");
    ws.addRow(header).font = { bold: true };
    data.forEach((r) => ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v))));
    ws.columns.forEach((c) => (c.width = 16));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  },
);

// Create
metricsRouter.post("/", canEdit, async (req, res, next) => {
  const schema = await schemaFor(req.user!.companyId);
  validate({ body: schema })(req, res, async () => {
    try {
      const input = req.valid.body as MetricInput;
      const companyId = req.user!.companyId;
      await assertFilesOwned(companyId, input);
      const existing = await prisma.dailyMetric.findUnique({
        where: { companyId_reportDate_campaign: { companyId, reportDate: input.reportDate, campaign: input.campaign } },
        select: publicFields,
      });
      if (existing) {
        res.status(409).json({ error: "An entry for this date and campaign already exists.", code: "DUPLICATE", existing });
        return;
      }
      const created = await prisma.dailyMetric.create({
        data: { ...input, notes: input.notes ?? null, companyId, createdBy: req.user!.id, updatedBy: req.user!.id },
        select: publicFields,
      });
      await audit(req, { action: "create", entity: "daily_metric", entityId: created.id, details: input });
      res.status(201).json({ entry: created });
    } catch (e) {
      next(e);
    }
  });
});

// Update
metricsRouter.put("/:id", canEdit, async (req, res, next) => {
  const schema = await schemaFor(req.user!.companyId);
  validate({ body: schema, params: idParam })(req, res, async () => {
    try {
      const input = req.valid.body as MetricInput;
      const { id } = req.valid.params as { id: number };
      const companyId = req.user!.companyId;
      const current = await prisma.dailyMetric.findFirst({ where: { id, companyId } });
      if (!current) throw new HttpError(404, "Entry not found.");
      await assertFilesOwned(companyId, input);
      const clash = await prisma.dailyMetric.findFirst({ where: { companyId, reportDate: input.reportDate, campaign: input.campaign, NOT: { id } }, select: { id: true } });
      if (clash) throw new HttpError(409, "Another entry already uses this date and campaign.");
      const updated = await prisma.dailyMetric.update({
        where: { id: current.id },
        data: { ...input, notes: input.notes ?? null, updatedBy: req.user!.id },
        select: publicFields,
      });
      const before = { waRecipients: current.waRecipients, waDelivered: current.waDelivered, emailSent: current.emailSent, emailOpened: current.emailOpened, reportDate: current.reportDate, campaign: current.campaign };
      await audit(req, { action: "update", entity: "daily_metric", entityId: id, details: { before, after: input } });
      res.json({ entry: updated });
    } catch (e) {
      next(e);
    }
  });
});

// Delete
metricsRouter.delete("/:id", canEdit, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const companyId = req.user!.companyId;
  const current = await prisma.dailyMetric.findFirst({ where: { id, companyId } });
  if (!current) throw new HttpError(404, "Entry not found.");
  await prisma.dailyMetric.delete({ where: { id: current.id } });
  await audit(req, { action: "delete", entity: "daily_metric", entityId: id, details: { reportDate: current.reportDate, campaign: current.campaign } });
  res.json({ ok: true });
});

// Single entry
metricsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const entry = await prisma.dailyMetric.findFirst({ where: { id, companyId: req.user!.companyId }, select: publicFields });
  if (!entry) throw new HttpError(404, "Entry not found.");
  res.json({ entry });
});
