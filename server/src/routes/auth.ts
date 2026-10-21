import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { config } from "../lib/config";
import { clearSessionCookie, issueCsrfToken, requireAuth, setSessionCookie } from "../middleware/auth";
import { email, password, validate } from "../middleware/validate";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// A real bcrypt hash of a random string, used to keep timing equal for unknown emails.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-" + Math.random(), 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts from this network. Try again in 15 minutes." },
});

export const authRouter = Router();

authRouter.get("/csrf", validate(), (_req, res) => {
  res.json({ csrfToken: issueCsrfToken(res) });
});

authRouter.post(
  "/login",
  loginLimiter,
  validate({ body: z.object({ email, password: z.string().min(1).max(200) }) }),
  async (req, res) => {
    const { email: em, password: pw } = req.valid.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email: em } });
    const generic = "Incorrect email or password.";

    if (!user || !user.active) {
      await bcrypt.compare(pw, DUMMY_HASH);
      await audit(req, { action: "login_failed", entity: "user", details: { email: em, reason: user ? "inactive" : "unknown_email" }, companyId: user?.companyId ?? null });
      res.status(401).json({ error: generic });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await audit(req, { action: "login_blocked", entity: "user", entityId: user.id, companyId: user.companyId, userId: user.id, details: { reason: "locked" } });
      res.status(423).json({ error: `Account locked after too many failed attempts. Try again in ${mins} minute(s).` });
      return;
    }

    const ok = await bcrypt.compare(pw, user.passwordHash);
    if (!ok) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
      });
      await audit(req, { action: lock ? "account_locked" : "login_failed", entity: "user", entityId: user.id, companyId: user.companyId, userId: user.id, details: { attempts } });
      if (lock) {
        res.status(423).json({ error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` });
      } else {
        res.status(401).json({ error: generic });
      }
      return;
    }

    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    setSessionCookie(res, user);
    issueCsrfToken(res); // rotate CSRF token on login
    await audit(req, { action: "login", entity: "user", entityId: user.id, companyId: user.companyId, userId: user.id });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId } });
  },
);

authRouter.post("/logout", validate(), async (req, res) => {
  if (req.user) await audit(req, { action: "logout", entity: "user", entityId: req.user.id });
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, validate(), async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { id: true, name: true } });
  res.json({ user: req.user, company });
});

authRouter.post(
  "/change-password",
  requireAuth,
  validate({
    body: z
      .object({ currentPassword: z.string().min(1).max(200), newPassword: password })
      .refine((v) => v.currentPassword !== v.newPassword, { message: "New password must be different", path: ["newPassword"] }),
  }),
  async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body as { currentPassword: string; newPassword: string };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await audit(req, { action: "password_change_failed", entity: "user", entityId: user.id });
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } },
    });
    setSessionCookie(res, updated); // old sessions are invalidated by the tokenVersion bump
    await audit(req, { action: "password_changed", entity: "user", entityId: user.id });
    res.json({ ok: true });
  },
);
