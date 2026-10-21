/** Builds the numbers behind the dashboard and the daily report. */
import { prisma } from "../lib/db";
import { allChanges, computeKpis, pct, type KpiChange, type KpiKey, type Kpis } from "../lib/kpi";
import { addDays, dateRange, minutesOf, monthOf, nowParts, shortDay } from "../lib/dates";
import { isWorkingDay, offReason, previousWorkingDay } from "../lib/workingDays";
import { getSettings, holidayMap, type CompanySettings } from "./settings";

export interface DaySnapshot {
  date: string;
  kpis: Kpis;
  previousDate: string | null;
  previousLabel: string;
  previousKpis: Kpis | null;
  changes: Record<KpiKey, KpiChange>;
  workingDay: boolean;
  offReason: string | null;
  campaigns: { campaign: string; waRecipients: number; waDelivered: number; emailSent: number; emailOpened: number }[];
}

export async function companyContext(companyId: number) {
  const [settings, holidays, company] = await Promise.all([
    getSettings(companyId),
    holidayMap(companyId),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, name: true } }),
  ]);
  return { settings, holidays, company };
}

export type CompanyContext = Awaited<ReturnType<typeof companyContext>>;

async function rowsFor(companyId: number, date: string) {
  return prisma.dailyMetric.findMany({
    where: { companyId, reportDate: date },
    select: { campaign: true, waRecipients: true, waDelivered: true, emailSent: true, emailOpened: true },
    orderBy: { campaign: "asc" },
  });
}

export async function daySnapshot(companyId: number, date: string, ctx?: CompanyContext): Promise<DaySnapshot> {
  const c = ctx ?? (await companyContext(companyId));
  const holidaySet = new Set(c.holidays.keys());
  const rows = await rowsFor(companyId, date);
  const kpis = computeKpis(rows);
  const previousDate = previousWorkingDay(date, c.settings.workRules, holidaySet);
  const previousKpis = previousDate ? computeKpis(await rowsFor(companyId, previousDate)) : null;
  const previousLabel = previousDate ? shortDay(previousDate) : "previous day";
  return {
    date,
    kpis,
    previousDate,
    previousLabel,
    previousKpis,
    changes: allChanges(kpis, previousKpis, previousLabel),
    workingDay: isWorkingDay(date, c.settings.workRules, holidaySet),
    offReason: offReason(date, c.settings.workRules, c.holidays),
    campaigns: rows,
  };
}

export interface TargetProgress {
  key: "waRecipients" | "waDelivered" | "emailSent" | "emailOpened" | "deliveryPct" | "openPct";
  label: string;
  target: number;
  actual: number;
  progressPct: number; // actual / target × 100 (for % KPIs: actual rate vs target rate)
  isRate: boolean;
}

export async function monthProgress(companyId: number, month: string, upTo: string): Promise<{ month: string; hasTarget: boolean; items: TargetProgress[] }> {
  const target = await prisma.target.findUnique({ where: { companyId_month: { companyId, month } } });
  const rows = await prisma.dailyMetric.findMany({
    where: { companyId, reportDate: { gte: `${month}-01`, lte: upTo < `${month}-31` ? upTo : `${month}-31` } },
    select: { waRecipients: true, waDelivered: true, emailSent: true, emailOpened: true },
  });
  const k = computeKpis(rows);
  const t = target ?? { waRecipients: 0, waDelivered: 0, emailSent: 0, emailOpened: 0, deliveryPct: 0, openPct: 0 };
  const item = (key: TargetProgress["key"], label: string, actual: number, tgt: number, isRate = false): TargetProgress => ({
    key,
    label,
    target: tgt,
    actual,
    progressPct: tgt ? Math.round((actual / tgt) * 1000) / 10 : 0,
    isRate,
  });
  return {
    month,
    hasTarget: Boolean(target),
    items: [
      item("waRecipients", "WA sent", k.waSent, t.waRecipients),
      item("waDelivered", "WA delivered", k.waDelivered, t.waDelivered),
      item("deliveryPct", "Delivery %", k.deliveryPct, t.deliveryPct, true),
      item("emailSent", "Emails sent", k.emailSent, t.emailSent),
      item("emailOpened", "Emails opened", k.emailOpened, t.emailOpened),
      item("openPct", "Open %", k.openPct, t.openPct, true),
    ],
  };
}

export async function trend(companyId: number, from: string, to: string, settings: CompanySettings, holidays: Map<string, string>) {
  const rows = await prisma.dailyMetric.findMany({
    where: { companyId, reportDate: { gte: from, lte: to } },
    select: { reportDate: true, waRecipients: true, waDelivered: true, emailSent: true, emailOpened: true },
  });
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.reportDate, [...(byDate.get(r.reportDate) ?? []), r]);
  const set = new Set(holidays.keys());
  return dateRange(from, to)
    .filter((d) => byDate.has(d) || isWorkingDay(d, settings.workRules, set))
    .map((d) => {
      const k = computeKpis(byDate.get(d) ?? []);
      return { date: d, waSent: k.waSent, waDelivered: k.waDelivered, deliveryPct: k.deliveryPct, emailSent: k.emailSent, emailOpened: k.emailOpened, openPct: k.openPct, entries: k.entries };
    });
}

/** Should the "today's data is missing" banner show? */
export async function missingToday(companyId: number, ctx: CompanyContext, now = new Date()) {
  const { date, time } = nowParts(ctx.settings.timezone, now);
  const working = isWorkingDay(date, ctx.settings.workRules, new Set(ctx.holidays.keys()));
  if (!working) return { missing: false, today: date, reminderTime: ctx.settings.reminderTime };
  const pastReminder = minutesOf(time) >= minutesOf(ctx.settings.reminderTime);
  if (!pastReminder) return { missing: false, today: date, reminderTime: ctx.settings.reminderTime };
  const n = await prisma.dailyMetric.count({ where: { companyId, reportDate: date } });
  return { missing: n === 0, today: date, reminderTime: ctx.settings.reminderTime };
}

export function rangeTotals(points: { waSent: number; waDelivered: number; emailSent: number; emailOpened: number }[]) {
  const t = points.reduce(
    (a, p) => ({ waSent: a.waSent + p.waSent, waDelivered: a.waDelivered + p.waDelivered, emailSent: a.emailSent + p.emailSent, emailOpened: a.emailOpened + p.emailOpened }),
    { waSent: 0, waDelivered: 0, emailSent: 0, emailOpened: 0 },
  );
  return { ...t, deliveryPct: pct(t.waDelivered, t.waSent), openPct: pct(t.emailOpened, t.emailSent) };
}

export { addDays, monthOf };
