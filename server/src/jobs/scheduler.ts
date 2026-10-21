/**
 * Background jobs (node-cron, inside the backend — no n8n needed):
 *  - every minute: for each company, at its auto-send time on a working day,
 *    build the report and email it; if no data was entered, email the admins an alert.
 *  - 23:00 Asia/Kolkata: SQLite backup to BACKUP_DIR, keeping the newest BACKUP_KEEP files.
 */
import cron from "node-cron";
import { prisma } from "../lib/db";
import { nowParts, prettyDate } from "../lib/dates";
import { isWorkingDay } from "../lib/workingDays";
import { audit } from "../lib/audit";
import { getSettings, holidayMap, setSetting } from "../services/settings";
import { createReport } from "../services/report";
import { emailReport } from "../services/delivery";
import { sendMail } from "../services/mailer";
import { backupDatabase } from "./backup";

let running = false;

export async function autoSendTick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    for (const company of companies) {
      try {
        await autoSendForCompany(company.id, company.name, now);
      } catch (e) {
        console.error(`[cron] auto-send failed for company ${company.id}:`, (e as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

export async function autoSendForCompany(companyId: number, companyName: string, now = new Date()) {
  const s = await getSettings(companyId);
  if (!s.autoSendEnabled) return { skipped: "disabled" };
  const { date, time } = nowParts(s.timezone, now);
  if (time !== s.autoSendTime) return { skipped: "not-time" };
  if (s.lastAutoSendDate === date) return { skipped: "already-sent" };
  const holidays = await holidayMap(companyId);
  if (!isWorkingDay(date, s.workRules, new Set(holidays.keys()))) return { skipped: "non-working-day" };

  // Mark first so a slow send can't be triggered twice.
  await setSetting(companyId, "last_auto_send_date", date);

  const entries = await prisma.dailyMetric.count({ where: { companyId, reportDate: date } });
  if (entries === 0) {
    const admins = await prisma.user.findMany({ where: { companyId, role: "admin", active: true }, select: { email: true } });
    try {
      await sendMail({
        to: admins.map((a) => a.email),
        subject: `Smart MIS: data missing for ${prettyDate(date)}`,
        html: `<p>No daily data was entered for <b>${prettyDate(date)}</b> by ${s.autoSendTime}, so the automatic MIS report for <b>${companyName.replace(/[<>&]/g, "")}</b> was not sent.</p><p>Add today's numbers in Smart MIS and send the report from the Reports page.</p>`,
      });
    } catch (e) {
      console.error(`[cron] data-missing alert failed for company ${companyId}:`, (e as Error).message);
    }
    await audit(null, { companyId, action: "auto_send_skipped", entity: "report", details: { date, reason: "data_missing" } });
    return { skipped: "data-missing" };
  }

  const { report } = await createReport(companyId, date, "auto", null);
  try {
    const sent = await emailReport(companyId, report.id);
    await audit(null, { companyId, action: "auto_send", entity: "report", entityId: report.id, details: { date, to: sent.to } });
    return { sent: sent.to };
  } catch (e) {
    await audit(null, { companyId, action: "auto_send_failed", entity: "report", entityId: report.id, details: { date, error: (e as Error).message } });
    throw e;
  }
}

export function startJobs() {
  cron.schedule("* * * * *", () => void autoSendTick(), { name: "auto-send" });
  cron.schedule(
    "0 23 * * *",
    () => {
      backupDatabase().catch((e) => console.error("[backup] failed:", (e as Error).message));
    },
    { timezone: "Asia/Kolkata", name: "backup" },
  );
  console.log("[cron] scheduler started (auto-send check every minute, backup daily at 23:00 Asia/Kolkata)");
}
