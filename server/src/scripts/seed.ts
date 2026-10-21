/**
 * Development seed: one demo company, 3 users, 45 days of FAKE metrics,
 * 2 monthly targets and 3 holidays. Refuses to run in production.
 */
import bcrypt from "bcryptjs";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { addDays, monthOf, todayIn } from "../lib/dates";
import { DEFAULT_WORK_RULES, isWorkingDay } from "../lib/workingDays";
import { SETTING_DEFAULTS } from "../services/settings";

const DEMO_PASSWORD = "Demo@123";

/** Small deterministic PRNG so every seed run produces the same demo data. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export async function seed() {
  if (config.isProd) {
    console.error("[seed] Refusing to seed demo data when NODE_ENV=production.");
    process.exit(1);
  }

  const existing = await prisma.company.findFirst({ where: { name: "Demo Marketing Co" } });
  if (existing) {
    console.log("[seed] Demo company already exists — removing it and re-seeding.");
    await prisma.company.delete({ where: { id: existing.id } });
  }

  const company = await prisma.company.create({ data: { name: "Demo Marketing Co" } });
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const users = [
    { name: "Asha Admin", email: "admin@demo.com", role: "admin" },
    { name: "Manoj Member", email: "member@demo.com", role: "member" },
    { name: "Vikram Viewer", email: "viewer@demo.com", role: "viewer" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, companyId: company.id, passwordHash: hash },
      update: { ...u, companyId: company.id, passwordHash: hash, active: true, failedAttempts: 0, lockedUntil: null },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@demo.com" } });

  const tz = SETTING_DEFAULTS.timezone;
  const today = todayIn(tz);

  // Holidays (fake/demo): one inside the data window, one recent, one upcoming.
  const holidays = [
    { date: addDays(today, -19), name: "Demo Festival Holiday" },
    { date: addDays(today, -33), name: "Demo Public Holiday" },
    { date: addDays(today, 18), name: "Upcoming Demo Holiday" },
  ];
  for (const h of holidays) await prisma.holiday.create({ data: { ...h, companyId: company.id } });
  const holidaySet = new Set(holidays.map((h) => h.date));

  // Settings
  const settings: Record<string, string> = {
    ...SETTING_DEFAULTS,
    report_emails: JSON.stringify(["boss@example.com"]),
    report_whatsapp: JSON.stringify(["919800000000"]),
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.create({ data: { companyId: company.id, key, value } });
  }

  // 45 days of fake metrics (working days only; yesterday-and-earlier so "today" is left for the user to add)
  const rand = rng(20261021);
  const campaigns = ["Festive Offer", "Product Updates", "Weekly Newsletter"];
  let count = 0;
  for (let i = 45; i >= 1; i--) {
    const date = addDays(today, -i);
    if (!isWorkingDay(date, DEFAULT_WORK_RULES, holidaySet)) continue;
    const perDay = rand() < 0.35 ? 2 : 1;
    for (let c = 0; c < perDay; c++) {
      const campaign = campaigns[(i + c) % campaigns.length];
      const trend = 1 + (45 - i) * 0.004; // gentle growth
      const waRecipients = Math.round((6000 + rand() * 6000) * trend);
      const waDelivered = Math.round(waRecipients * (0.9 + rand() * 0.07));
      const emailSent = Math.round((4000 + rand() * 5000) * trend);
      const emailOpened = Math.round(emailSent * (0.16 + rand() * 0.12));
      await prisma.dailyMetric.create({
        data: {
          companyId: company.id,
          reportDate: date,
          campaign,
          waRecipients,
          waDelivered,
          emailSent,
          emailOpened,
          notes: c === 0 && rand() < 0.15 ? "Sample note: vendor report arrived late" : null,
          createdBy: admin.id,
          updatedBy: admin.id,
        },
      });
      count++;
    }
  }

  // Targets for this month and last month
  const thisMonth = monthOf(today);
  const lastMonth = monthOf(addDays(`${thisMonth}-01`, -1));
  for (const month of [lastMonth, thisMonth]) {
    await prisma.target.create({
      data: {
        companyId: company.id,
        month,
        waRecipients: 320000,
        waDelivered: 300000,
        emailSent: 230000,
        emailOpened: 52000,
        deliveryPct: 94,
        openPct: 22,
      },
    });
  }

  await prisma.auditLog.create({
    data: { companyId: company.id, userId: admin.id, action: "seed", entity: "company", entityId: String(company.id), detailsJson: JSON.stringify({ metrics: count }) },
  });

  console.log(`[seed] Company "${company.name}" (id ${company.id}) with ${count} fake metric entries.`);
  console.log(`[seed] Users: admin@demo.com, member@demo.com, viewer@demo.com — password ${DEMO_PASSWORD} (development only)`);
}

if (require.main === module) {
  seed()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
