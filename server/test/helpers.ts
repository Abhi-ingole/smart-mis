import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../src/lib/db";
import { createApp } from "../src/app";

export const PASSWORD = "Test@1234";
let appInstance: Express | null = null;
export const app = () => (appInstance ??= createApp());

/** Creates a company with an admin, member and viewer. */
export async function makeCompany(name: string) {
  const company = await prisma.company.create({ data: { name } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const slug = name.toLowerCase().replace(/\W+/g, "");
  const users: Record<"admin" | "member" | "viewer", { id: number; email: string }> = {} as never;
  for (const role of ["admin", "member", "viewer"] as const) {
    const u = await prisma.user.create({ data: { companyId: company.id, name: `${role} ${name}`, email: `${role}@${slug}.test`, role, passwordHash: hash } });
    users[role] = { id: u.id, email: u.email };
  }
  return { company, users };
}

/** A logged-in supertest agent that sends the CSRF header on writes. */
export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app());
  const r = await agent.get("/api/auth/csrf").expect(200);
  let csrf = r.body.csrfToken as string;
  const res = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  // the token rotates on login
  const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const fresh = setCookie.map((c) => /smis_csrf=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (fresh) csrf = decodeURIComponent(fresh);
  return {
    agent,
    csrf,
    get: (url: string) => agent.get(url),
    post: (url: string) => agent.post(url).set("X-CSRF-Token", csrf),
    put: (url: string) => agent.put(url).set("X-CSRF-Token", csrf),
    patch: (url: string) => agent.patch(url).set("X-CSRF-Token", csrf),
    del: (url: string) => agent.delete(url).set("X-CSRF-Token", csrf),
  };
}

export const sampleMetric = (over: Record<string, unknown> = {}) => ({
  reportDate: "2026-10-01",
  campaign: "Test Campaign",
  waRecipients: 1000,
  waDelivered: 950,
  emailSent: 800,
  emailOpened: 200,
  ...over,
});
