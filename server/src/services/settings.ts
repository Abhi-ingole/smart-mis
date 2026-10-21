import { prisma } from "../lib/db";
import { DEFAULT_TZ } from "../lib/dates";
import { parseWorkRules, type WorkRules } from "../lib/workingDays";

export interface CompanySettings {
  timezone: string;
  autoSendEnabled: boolean;
  autoSendTime: string; // HH:MM
  reminderTime: string; // HH:MM
  reportEmails: string[];
  reportWhatsapp: string[];
  workRules: WorkRules;
  allowImageAi: boolean;
  logo: string | null; // data: URL
  lastAutoSendDate: string | null;
}

export const SETTING_DEFAULTS: Record<string, string> = {
  timezone: DEFAULT_TZ,
  auto_send_enabled: "true",
  auto_send_time: "19:00",
  reminder_time: "18:00",
  report_emails: "[]",
  report_whatsapp: "[]",
  work_rules: JSON.stringify({ weekdaysOff: [0], saturdaysOff: [2, 4] }),
  allow_image_ai: "false",
  logo: "",
  last_auto_send_date: "",
};

function parseList(v: string | undefined): string[] {
  try {
    const a = JSON.parse(v ?? "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getRawSettings(companyId: number): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { companyId } });
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getSettings(companyId: number): Promise<CompanySettings> {
  const s = await getRawSettings(companyId);
  return {
    timezone: s.timezone || DEFAULT_TZ,
    autoSendEnabled: s.auto_send_enabled === "true",
    autoSendTime: s.auto_send_time,
    reminderTime: s.reminder_time,
    reportEmails: parseList(s.report_emails),
    reportWhatsapp: parseList(s.report_whatsapp),
    workRules: parseWorkRules(s.work_rules),
    allowImageAi: s.allow_image_ai === "true",
    logo: s.logo || null,
    lastAutoSendDate: s.last_auto_send_date || null,
  };
}

export async function setSetting(companyId: number, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value },
    update: { value },
  });
}

export async function holidayMap(companyId: number): Promise<Map<string, string>> {
  const rows = await prisma.holiday.findMany({ where: { companyId }, select: { date: true, name: true } });
  return new Map(rows.map((h) => [h.date, h.name]));
}
