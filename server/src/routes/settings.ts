import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { adminOnly, requireAuth, ROLES } from "../middleware/auth";
import { dateStr, email, idParam, monthStr, password, timeStr, validate, count } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { checkUpload } from "../lib/fileCheck";
import { getSettings, setSetting } from "../services/settings";
import { uploadMiddleware } from "../services/uploads";
import { sendMail } from "../services/mailer";
import { isValidDate } from "../lib/dates";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// Company basics every role needs (name, logo, timezone, work rules)
settingsRouter.get("/public", validate(), async (req, res) => {
  const companyId = req.user!.companyId;
  const [company, s] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, name: true } }), getSettings(companyId)]);
  res.json({ company, logo: s.logo, timezone: s.timezone, reminderTime: s.reminderTime, autoSendTime: s.autoSendTime, workRules: s.workRules });
});

settingsRouter.get("/", adminOnly, validate(), async (req, res) => {
  const companyId = req.user!.companyId;
  const [company, s] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, name: true } }), getSettings(companyId)]);
  res.json({ company, settings: s });
});

const phone = z.string().trim().regex(/^\+?\d[\d\s-]{7,18}$/, "Use digits with country code, e.g. 919812345678").transform((s) => s.replace(/\D/g, ""));

settingsRouter.put(
  "/",
  adminOnly,
  validate({
    body: z.object({
      companyName: z.string().trim().min(2).max(100).optional(),
      autoSendEnabled: z.boolean().optional(),
      autoSendTime: timeStr.optional(),
      reminderTime: timeStr.optional(),
      reportEmails: z.array(email).max(20).optional(),
      reportWhatsapp: z.array(phone).max(20).optional(),
      workRules: z.object({ weekdaysOff: z.array(z.number().int().min(0).max(6)).max(6), saturdaysOff: z.array(z.number().int().min(1).max(5)).max(5) }).optional(),
      allowImageAi: z.boolean().optional(),
      timezone: z
        .string()
        .max(64)
        .refine((tz) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, "Unknown time zone")
        .optional(),
    }),
  }),
  async (req, res) => {
    const b = req.valid.body as Record<string, unknown>;
    const companyId = req.user!.companyId;
    if (b.companyName) await prisma.company.update({ where: { id: companyId }, data: { name: b.companyName as string } });
    const map: Record<string, (v: any) => string> = {
      autoSendEnabled: (v) => String(v),
      autoSendTime: (v) => v,
      reminderTime: (v) => v,
      reportEmails: (v) => JSON.stringify([...new Set(v as string[])]),
      reportWhatsapp: (v) => JSON.stringify([...new Set(v as string[])]),
      workRules: (v) => JSON.stringify(v),
      allowImageAi: (v) => String(v),
      timezone: (v) => v,
    };
    const keyName: Record<string, string> = {
      autoSendEnabled: "auto_send_enabled",
      autoSendTime: "auto_send_time",
      reminderTime: "reminder_time",
      reportEmails: "report_emails",
      reportWhatsapp: "report_whatsapp",
      workRules: "work_rules",
      allowImageAi: "allow_image_ai",
      timezone: "timezone",
    };
    for (const [k, fn] of Object.entries(map)) {
      if (b[k] !== undefined) await setSetting(companyId, keyName[k], fn(b[k]));
    }
    await audit(req, { action: "update", entity: "settings", details: b });
    res.json({ settings: await getSettings(companyId) });
  },
);

// Logo: PNG/JPG up to 500 KB, stored as a data URL so report images can embed it
settingsRouter.post("/logo", adminOnly, uploadMiddleware, validate({ body: z.object({}).optional() }), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "Choose an image.");
  const check = checkUpload(file, ["png", "jpg"], 500 * 1024);
  if (!check.ok) throw new HttpError(400, check.reason === "File too large. Maximum size is 10 MB." ? "Logo must be 500 KB or smaller." : (check.reason ?? "Invalid image."));
  const dataUrl = `data:${check.kind === "png" ? "image/png" : "image/jpeg"};base64,${file.buffer.toString("base64")}`;
  await setSetting(req.user!.companyId, "logo", dataUrl);
  await audit(req, { action: "update", entity: "logo", details: { size: file.size } });
  res.json({ logo: dataUrl });
});

settingsRouter.delete("/logo", adminOnly, validate(), async (req, res) => {
  await setSetting(req.user!.companyId, "logo", "");
  await audit(req, { action: "delete", entity: "logo" });
  res.json({ ok: true });
});

settingsRouter.post("/test-email", adminOnly, validate(), async (req, res) => {
  const s = await getSettings(req.user!.companyId);
  try {
    const sent = await sendMail({ to: s.reportEmails, subject: "Smart MIS test email", html: "<p>This is a test email from Smart MIS. Email delivery is working.</p>" });
    await audit(req, { action: "send_test_email", entity: "settings", details: { to: sent.to } });
    res.json({ ok: true, to: sent.to });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// ── Targets ─────────────────────────────────────────────────
export const targetsRouter = Router();
targetsRouter.use(requireAuth);

targetsRouter.get("/", validate(), async (req, res) => {
  const targets = await prisma.target.findMany({ where: { companyId: req.user!.companyId }, orderBy: { month: "desc" } });
  res.json({ targets });
});

const pctField = z.coerce.number().min(0).max(100);
targetsRouter.put(
  "/:month",
  adminOnly,
  validate({
    params: z.object({ month: monthStr }),
    body: z.object({ waRecipients: count, waDelivered: count, emailSent: count, emailOpened: count, deliveryPct: pctField, openPct: pctField }).refine((v) => v.waDelivered <= v.waRecipients && v.emailOpened <= v.emailSent, {
      message: "Delivered/opened targets cannot exceed sent targets",
    }),
  }),
  async (req, res) => {
    const { month } = req.valid.params as { month: string };
    const data = req.valid.body as { waRecipients: number; waDelivered: number; emailSent: number; emailOpened: number; deliveryPct: number; openPct: number };
    const companyId = req.user!.companyId;
    const target = await prisma.target.upsert({ where: { companyId_month: { companyId, month } }, create: { ...data, companyId, month }, update: data });
    await audit(req, { action: "upsert", entity: "target", entityId: target.id, details: { month, ...data } });
    res.json({ target });
  },
);

targetsRouter.delete("/:month", adminOnly, validate({ params: z.object({ month: monthStr }) }), async (req, res) => {
  const { month } = req.valid.params as { month: string };
  const r = await prisma.target.deleteMany({ where: { companyId: req.user!.companyId, month } });
  if (!r.count) throw new HttpError(404, "Target not found.");
  await audit(req, { action: "delete", entity: "target", details: { month } });
  res.json({ ok: true });
});

// ── Holidays ────────────────────────────────────────────────
export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

holidaysRouter.get("/", validate(), async (req, res) => {
  const holidays = await prisma.holiday.findMany({ where: { companyId: req.user!.companyId }, orderBy: { date: "asc" } });
  res.json({ holidays });
});

holidaysRouter.post("/", adminOnly, validate({ body: z.object({ date: dateStr.refine(isValidDate, "Not a real date"), name: z.string().trim().min(1).max(100) }) }), async (req, res) => {
  const { date, name } = req.valid.body as { date: string; name: string };
  const companyId = req.user!.companyId;
  const exists = await prisma.holiday.findUnique({ where: { companyId_date: { companyId, date } } });
  if (exists) throw new HttpError(409, "A holiday already exists on this date.");
  const holiday = await prisma.holiday.create({ data: { companyId, date, name } });
  await audit(req, { action: "create", entity: "holiday", entityId: holiday.id, details: { date, name } });
  res.status(201).json({ holiday });
});

holidaysRouter.delete("/:id", adminOnly, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const h = await prisma.holiday.findFirst({ where: { id, companyId: req.user!.companyId } });
  if (!h) throw new HttpError(404, "Holiday not found.");
  await prisma.holiday.delete({ where: { id: h.id } });
  await audit(req, { action: "delete", entity: "holiday", entityId: id, details: { date: h.date, name: h.name } });
  res.json({ ok: true });
});

// ── Users ───────────────────────────────────────────────────
export const usersRouter = Router();
usersRouter.use(requireAuth, adminOnly);

const userSelect = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, lockedUntil: true, createdAt: true } as const;
const role = z.enum(ROLES as [string, ...string[]]);

usersRouter.get("/", validate(), async (req, res) => {
  const users = await prisma.user.findMany({ where: { companyId: req.user!.companyId }, select: userSelect, orderBy: { createdAt: "asc" } });
  res.json({ users });
});

usersRouter.post("/", validate({ body: z.object({ name: z.string().trim().min(1).max(100), email, role, password }) }), async (req, res) => {
  const { name, email: em, role: r, password: pw } = req.valid.body as { name: string; email: string; role: string; password: string };
  if (await prisma.user.findUnique({ where: { email: em } })) throw new HttpError(409, "A user with this email already exists.");
  const user = await prisma.user.create({ data: { companyId: req.user!.companyId, name, email: em, role: r, passwordHash: await bcrypt.hash(pw, 12) }, select: userSelect });
  await audit(req, { action: "create", entity: "user", entityId: user.id, details: { name, email: em, role: r } });
  res.status(201).json({ user });
});

async function assertKeepsAnAdmin(companyId: number, changingUserId: number) {
  const admins = await prisma.user.count({ where: { companyId, role: "admin", active: true, NOT: { id: changingUserId } } });
  if (admins === 0) throw new HttpError(400, "The company must keep at least one active admin.");
}

usersRouter.patch(
  "/:id",
  validate({ params: idParam, body: z.object({ name: z.string().trim().min(1).max(100).optional(), role: role.optional(), active: z.boolean().optional() }) }),
  async (req, res) => {
    const { id } = req.valid.params as { id: number };
    const body = req.valid.body as { name?: string; role?: string; active?: boolean };
    const companyId = req.user!.companyId;
    const target = await prisma.user.findFirst({ where: { id, companyId } });
    if (!target) throw new HttpError(404, "User not found.");
    const demoting = target.role === "admin" && ((body.role && body.role !== "admin") || body.active === false);
    if (demoting) await assertKeepsAnAdmin(companyId, id);
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...body,
        // Changing role or deactivating ends that user's existing sessions.
        ...(body.role !== undefined || body.active === false ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: userSelect,
    });
    await audit(req, { action: "update", entity: "user", entityId: id, details: { before: { role: target.role, active: target.active, name: target.name }, after: body } });
    res.json({ user });
  },
);

usersRouter.post("/:id/reset-password", validate({ params: idParam, body: z.object({ password }) }), async (req, res) => {
  const { id } = req.valid.params as { id: number };
  const { password: pw } = req.valid.body as { password: string };
  const target = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
  if (!target) throw new HttpError(404, "User not found.");
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 12), tokenVersion: { increment: 1 }, failedAttempts: 0, lockedUntil: null } });
  await audit(req, { action: "reset_password", entity: "user", entityId: id });
  res.json({ ok: true });
});

// ── Audit log (read-only) ───────────────────────────────────
export const auditRouter = Router();
auditRouter.use(requireAuth, adminOnly);
auditRouter.get("/", validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) }), async (req, res) => {
  const { limit } = req.valid.query as { limit: number };
  const rows = await prisma.auditLog.findMany({ where: { companyId: req.user!.companyId }, orderBy: { createdAt: "desc" }, take: limit });
  const users = await prisma.user.findMany({ where: { companyId: req.user!.companyId }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json({ entries: rows.map((r) => ({ ...r, userName: r.userId ? (names.get(r.userId) ?? `#${r.userId}`) : null })) });
});
