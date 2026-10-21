import crypto from "node:crypto";
import type { CookieOptions, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { prisma } from "../lib/db";

export type Role = "admin" | "member" | "viewer";
export const ROLES: Role[] = ["admin", "member", "viewer"];

export interface AuthUser {
  id: number;
  companyId: number;
  role: Role;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = "smis_session";
export const CSRF_COOKIE = "smis_csrf";
export const CSRF_HEADER = "x-csrf-token";
const SESSION_HOURS = 8;

function cookieBase(): CookieOptions {
  return { sameSite: "strict", secure: config.isProd, path: "/" };
}

export function setSessionCookie(res: Response, user: { id: number; companyId: number; tokenVersion: number }) {
  const token = jwt.sign({ sub: String(user.id), cid: user.companyId, tv: user.tokenVersion }, config.jwtSecret, {
    expiresIn: `${SESSION_HOURS}h`,
    algorithm: "HS256",
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, maxAge: SESSION_HOURS * 3600 * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(), httpOnly: true });
}

/**
 * Loads the user from the session cookie on every request.
 * Role, company and active flag always come from the database — never from the token or the UI.
 */
export const loadUser: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (user && user.active && user.companyId === payload.cid && user.tokenVersion === payload.tv) {
      req.user = { id: user.id, companyId: user.companyId, role: user.role as Role, name: user.name, email: user.email };
    }
  } catch {
    // invalid/expired token → treated as logged out
  }
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Please log in." });
    return;
  }
  next();
};

/** Allow only the listed roles. Always use after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Please log in." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have permission to do this." });
      return;
    }
    next();
  };
}

export const canEdit = requireRole("admin", "member");
export const adminOnly = requireRole("admin");

// ── CSRF: signed double-submit token + SameSite=strict cookies ──
function signCsrf(nonce: string) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`csrf:${nonce}`).digest("base64url");
}

export function issueCsrfToken(res: Response): string {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const token = `${nonce}.${signCsrf(nonce)}`;
  // Readable by the page (not httpOnly) so it can echo it in the header.
  res.cookie(CSRF_COOKIE, token, { ...cookieBase(), httpOnly: false, maxAge: 24 * 3600 * 1000 });
  return token;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== "string" || typeof header !== "string" || !safeEqual(cookie, header)) {
    res.status(403).json({ error: "Invalid or missing CSRF token. Refresh the page and try again." });
    return;
  }
  const [nonce, sig] = cookie.split(".");
  if (!nonce || !sig || !safeEqual(sig, signCsrf(nonce))) {
    res.status(403).json({ error: "Invalid CSRF token." });
    return;
  }
  next();
};
