import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { makeCompany, sampleMetric } from "./helpers";
import { autoSendForCompany } from "../src/jobs/scheduler";
import { backupDatabase } from "../src/jobs/backup";
import { setSetting } from "../src/services/settings";
import { config } from "../src/lib/config";
import { sqliteFilePath } from "../src/lib/db";

// 2026-10-21 13:30 UTC = 19:00 in Asia/Kolkata (a Wednesday)
const AT_SEVEN_PM = new Date("2026-10-21T13:30:00Z");

describe("auto-send scheduler", () => {
  it("sends the report at the set time on a working day, once", async () => {
    const { company } = await makeCompany("Cron Co");
    await setSetting(company.id, "report_emails", JSON.stringify(["boss@cron.test"]));
    await prisma.dailyMetric.create({ data: { ...sampleMetric({ reportDate: "2026-10-21" }), companyId: company.id } as never });

    expect(await autoSendForCompany(company.id, "Cron Co", new Date("2026-10-21T13:00:00Z"))).toEqual({ skipped: "not-time" });
    expect(await autoSendForCompany(company.id, "Cron Co", AT_SEVEN_PM)).toEqual({ sent: ["boss@cron.test"] });
    expect(await autoSendForCompany(company.id, "Cron Co", AT_SEVEN_PM)).toEqual({ skipped: "already-sent" });
    const reports = await prisma.report.findMany({ where: { companyId: company.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0].kind).toBe("auto");
  });

  it("alerts admins instead when data is missing", async () => {
    const { company } = await makeCompany("Empty Co");
    expect(await autoSendForCompany(company.id, "Empty Co", AT_SEVEN_PM)).toEqual({ skipped: "data-missing" });
    expect(await prisma.report.count({ where: { companyId: company.id } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { companyId: company.id, action: "auto_send_skipped" } });
    expect(log).not.toBeNull();
  });

  it("does nothing on a non-working day", async () => {
    const { company } = await makeCompany("Holiday Co");
    await prisma.holiday.create({ data: { companyId: company.id, date: "2026-10-21", name: "Test holiday" } });
    expect(await autoSendForCompany(company.id, "Holiday Co", AT_SEVEN_PM)).toEqual({ skipped: "non-working-day" });
  });
});

describe("backups", () => {
  it("writes a backup and keeps only the newest N", async () => {
    const dir = path.join(config.backupDir, "keep-test");
    for (let i = 0; i < 4; i++) {
      await backupDatabase({ dbFile: sqliteFilePath(), dir, keep: 2, now: new Date(Date.UTC(2026, 9, 1 + i, 17, 30)) });
    }
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(["smart-mis-20261003-173000.db", "smart-mis-20261004-173000.db"]);
  });
});
