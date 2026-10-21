import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { dateStr, validate } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { addDays, daysBetween, monthOf, todayIn } from "../lib/dates";
import { companyContext, daySnapshot, missingToday, monthProgress, rangeTotals, trend } from "../services/mis";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  requireAuth,
  validate({ query: z.object({ from: dateStr.optional(), to: dateStr.optional(), date: dateStr.optional() }) }),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const ctx = await companyContext(companyId);
    const today = todayIn(ctx.settings.timezone);
    let { from, to, date } = req.valid.query as { from?: string; to?: string; date?: string };
    to = to && to < today ? to : today;
    from = from ?? addDays(to, -29);
    if (from > to) throw new HttpError(400, "'From' date must be before 'To' date.");
    if (daysBetween(from, to) > 366) throw new HttpError(400, "Date range can be at most one year.");

    // KPI cards show one day: the requested date, else the latest day with data in the range.
    if (!date) {
      const latest = await prisma.dailyMetric.findFirst({ where: { companyId, reportDate: { gte: from, lte: to } }, orderBy: { reportDate: "desc" }, select: { reportDate: true } });
      date = latest?.reportDate ?? to;
    }
    const [snapshot, points, progress, reminder] = await Promise.all([
      daySnapshot(companyId, date, ctx),
      trend(companyId, from, to, ctx.settings, ctx.holidays),
      monthProgress(companyId, monthOf(date), date),
      missingToday(companyId, ctx),
    ]);

    res.json({
      company: ctx.company,
      today,
      range: { from, to },
      snapshot,
      trend: points,
      totals: rangeTotals(points),
      targets: progress,
      reminder,
    });
  },
);
