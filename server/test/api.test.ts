import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, login, makeCompany, sampleMetric, PASSWORD } from "./helpers";
import { makeTextPdf } from "../src/scripts/make-samples";
import { prisma } from "../src/lib/db";

let A: Awaited<ReturnType<typeof makeCompany>>;
let B: Awaited<ReturnType<typeof makeCompany>>;

beforeAll(async () => {
  A = await makeCompany("Alpha Co");
  B = await makeCompany("Beta Co");
});

describe("authentication and CSRF", () => {
  it("rejects API calls without a session", async () => {
    await request(app()).get("/api/dashboard").expect(401);
    await request(app()).get("/api/metrics").expect(401);
  });

  it("rejects writes without a CSRF token", async () => {
    const s = await login(A.users.admin.email);
    const r = await s.agent.post("/api/metrics").send(sampleMetric());
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/CSRF/);
  });

  it("rejects writes from another origin", async () => {
    const s = await login(A.users.admin.email);
    const r = await s.post("/api/metrics").set("Origin", "https://evil.example").send(sampleMetric());
    expect(r.status).toBe(403);
  });

  it("sets an httpOnly, SameSite=strict session cookie", async () => {
    const agent = request.agent(app());
    const { body } = await agent.get("/api/auth/csrf");
    const r = await agent.post("/api/auth/login").set("X-CSRF-Token", body.csrfToken).send({ email: A.users.member.email, password: PASSWORD }).expect(200);
    const cookie = ([] as string[]).concat(r.headers["set-cookie"]).find((c) => c.startsWith("smis_session="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(r.body.user.passwordHash).toBeUndefined();
  });

  it("locks the account for 15 minutes after 5 failed attempts", async () => {
    const { users } = await makeCompany("Lock Co");
    const agent = request.agent(app());
    const { body } = await agent.get("/api/auth/csrf");
    const attempt = (password: string) => agent.post("/api/auth/login").set("X-CSRF-Token", body.csrfToken).send({ email: users.member.email, password });
    for (let i = 0; i < 4; i++) expect((await attempt("wrong-password")).status).toBe(401);
    expect((await attempt("wrong-password")).status).toBe(423);
    // even the right password is refused while locked
    expect((await attempt(PASSWORD)).status).toBe(423);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: users.member.id } });
    expect(u.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const logs = await prisma.auditLog.findMany({ where: { userId: users.member.id } });
    expect(logs.map((l) => l.action)).toContain("account_locked");
    expect(JSON.stringify(logs)).not.toContain("wrong-password");
  });

  it("validates request bodies with zod", async () => {
    const s = await login(A.users.admin.email);
    const r = await s.post("/api/metrics").send({ ...sampleMetric(), waRecipients: "lots" });
    expect(r.status).toBe(400);
  });
});

describe("roles are enforced on the server", () => {
  it("a viewer cannot create, edit or delete data", async () => {
    const member = await login(A.users.member.email);
    const created = await member.post("/api/metrics").send(sampleMetric({ campaign: "Viewer Test" })).expect(201);
    const id = created.body.entry.id;

    const viewer = await login(A.users.viewer.email);
    expect((await viewer.post("/api/metrics").send(sampleMetric({ campaign: "Nope" }))).status).toBe(403);
    expect((await viewer.put(`/api/metrics/${id}`).send(sampleMetric({ campaign: "Viewer Test", waRecipients: 1 , waDelivered: 1}))).status).toBe(403);
    expect((await viewer.del(`/api/metrics/${id}`)).status).toBe(403);
    expect((await viewer.post("/api/reports").send({ date: "2026-10-01" })).status).toBe(403);
    // but can view
    expect((await viewer.get("/api/metrics?date=2026-10-01")).status).toBe(200);
    expect((await viewer.get("/api/dashboard")).status).toBe(200);
    const still = await prisma.dailyMetric.findUnique({ where: { id } });
    expect(still?.waRecipients).toBe(1000);
  });

  it("only admins can change settings and users", async () => {
    const member = await login(A.users.member.email);
    expect((await member.put("/api/settings").send({ autoSendTime: "20:00" })).status).toBe(403);
    expect((await member.post("/api/users").send({ name: "x", email: "x@x.test", role: "admin", password: "12345678" })).status).toBe(403);
    expect((await member.put("/api/targets/2026-10").send({ waRecipients: 1, waDelivered: 1, emailSent: 1, emailOpened: 1, deliveryPct: 1, openPct: 1 })).status).toBe(403);
    const admin = await login(A.users.admin.email);
    expect((await admin.put("/api/settings").send({ autoSendTime: "20:00" })).status).toBe(200);
  });

  it("a member can save data and gets a 409 for the same date + campaign", async () => {
    const member = await login(A.users.member.email);
    await member.post("/api/metrics").send(sampleMetric({ campaign: "Dup" })).expect(201);
    const r = await member.post("/api/metrics").send(sampleMetric({ campaign: "Dup", waRecipients: 2000 }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICATE");
    await member.put(`/api/metrics/${r.body.existing.id}`).send(sampleMetric({ campaign: "Dup", waRecipients: 2000 })).expect(200);
    expect(await prisma.dailyMetric.count({ where: { companyId: A.company.id, campaign: "Dup" } })).toBe(1);
  });

  it("enforces business rules on save", async () => {
    const member = await login(A.users.member.email);
    expect((await member.post("/api/metrics").send(sampleMetric({ campaign: "Bad", waDelivered: 5000 }))).status).toBe(400);
    expect((await member.post("/api/metrics").send(sampleMetric({ campaign: "Bad", reportDate: "2999-01-01" }))).status).toBe(400);
  });
});

describe("company isolation", () => {
  it("a user of company A cannot read or change company B's data", async () => {
    const bMember = await login(B.users.member.email);
    const bEntry = (await bMember.post("/api/metrics").send(sampleMetric({ campaign: "Beta Secret", waRecipients: 777, waDelivered: 700 })).expect(201)).body.entry;

    const aAdmin = await login(A.users.admin.email);
    expect((await aAdmin.get(`/api/metrics/${bEntry.id}`)).status).toBe(404);
    expect((await aAdmin.put(`/api/metrics/${bEntry.id}`).send(sampleMetric({ campaign: "Hacked" }))).status).toBe(404);
    expect((await aAdmin.del(`/api/metrics/${bEntry.id}`)).status).toBe(404);

    const list = await aAdmin.get("/api/metrics?date=2026-10-01").expect(200);
    expect(list.body.entries.map((e: { campaign: string }) => e.campaign)).not.toContain("Beta Secret");

    const dash = await aAdmin.get("/api/dashboard?from=2026-10-01&to=2026-10-01&date=2026-10-01").expect(200);
    expect(dash.body.company.name).toBe("Alpha Co");
    expect(dash.body.snapshot.campaigns.map((c: { campaign: string }) => c.campaign)).not.toContain("Beta Secret");

    // B's entry is untouched
    const fresh = await prisma.dailyMetric.findUniqueOrThrow({ where: { id: bEntry.id } });
    expect(fresh.campaign).toBe("Beta Secret");
  });

  it("cannot see another company's users, reports, holidays or uploaded files", async () => {
    const bAdmin = await login(B.users.admin.email);
    const upload = await bAdmin.post("/api/extract").field("channel", "wa").attach("file", makeTextPdf(["Delivered: 10"]), { filename: "b.pdf", contentType: "application/pdf" }).expect(200);
    const report = await bAdmin.post("/api/reports").send({ date: "2026-10-01" }).expect(201);
    const holiday = await bAdmin.post("/api/holidays").send({ date: "2026-12-25", name: "Beta holiday" }).expect(201);

    const aAdmin = await login(A.users.admin.email);
    expect((await aAdmin.get(`/api/files/${upload.body.file.storedName}`)).status).toBe(404);
    expect((await aAdmin.get(`/api/reports/${report.body.report.id}`)).status).toBe(404);
    expect((await aAdmin.post(`/api/reports/${report.body.report.id}/email`).send({})).status).toBe(400);
    expect((await aAdmin.del(`/api/holidays/${holiday.body.holiday.id}`)).status).toBe(404);
    expect((await aAdmin.patch(`/api/users/${B.users.member.id}`).send({ role: "viewer" })).status).toBe(404);
    const users = await aAdmin.get("/api/users").expect(200);
    expect(users.body.users.every((u: { email: string }) => u.email.endsWith("@alphaco.test"))).toBe(true);
    // the owner can download it
    expect((await bAdmin.get(`/api/files/${upload.body.file.storedName}`)).status).toBe(200);
  });
});

describe("file uploads", () => {
  it("accepts a real PDF and extracts numbers", async () => {
    const s = await login(A.users.member.email);
    const r = await s.post("/api/extract").field("channel", "wa").attach("file", makeTextPdf(["Total Submitted: 1,200", "Delivered: 1,150"]), { filename: "vendor.pdf", contentType: "application/pdf" }).expect(200);
    expect(r.body.extraction.fields.waRecipients.value).toBe(1200);
    expect(r.body.extraction.fields.waDelivered.value).toBe(1150);
    expect(r.body.file.storedName).toMatch(/^[a-f0-9]{32}\.pdf$/);
  });

  it("rejects a disallowed file type", async () => {
    const s = await login(A.users.member.email);
    const r = await s.post("/api/extract").field("channel", "wa").attach("file", Buffer.from("MZ\x90\x00 fake exe"), { filename: "virus.exe", contentType: "application/octet-stream" });
    expect(r.status).toBe(400);
  });

  it("rejects a file whose content does not match its extension", async () => {
    const s = await login(A.users.member.email);
    const fakePdf = await s.post("/api/extract").field("channel", "wa").attach("file", Buffer.from("MZ\x90\x00\x03 this is not a pdf"), { filename: "report.pdf", contentType: "application/pdf" });
    expect(fakePdf.status).toBe(400);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const wrongMime = await s.post("/api/extract").field("channel", "wa").attach("file", png, { filename: "shot.pdf", contentType: "application/pdf" });
    expect(wrongMime.status).toBe(400);
  });

  it("rejects files over 10 MB", async () => {
    const s = await login(A.users.member.email);
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024 + 10, 0x20)]);
    const r = await s.post("/api/extract").field("channel", "wa").attach("file", big, { filename: "big.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(413);
  });

  it("viewers cannot upload", async () => {
    const s = await login(A.users.viewer.email);
    const r = await s.post("/api/extract").field("channel", "wa").attach("file", makeTextPdf(["x"]), { filename: "v.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(403);
  });
});

describe("export", () => {
  it("exports CSV and Excel for the company's own data", async () => {
    const s = await login(A.users.viewer.email);
    const csv = await s.get("/api/metrics/export?from=2026-10-01&to=2026-10-01&format=csv").expect(200);
    expect(csv.text).toContain("Date,Campaign,WA sent");
    expect(csv.text).not.toContain("Beta Secret");
    const xlsx = await s.get("/api/metrics/export?from=2026-10-01&to=2026-10-01&format=xlsx").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("reports", () => {
  it("builds a report with code-calculated KPIs and a checked summary", async () => {
    const member = await login(A.users.member.email);
    await member.post("/api/metrics").send(sampleMetric({ reportDate: "2026-10-05", campaign: "R1", waRecipients: 1000, waDelivered: 900, emailSent: 400, emailOpened: 100 })).expect(201);
    await member.post("/api/metrics").send(sampleMetric({ reportDate: "2026-10-05", campaign: "R2", waRecipients: 1000, waDelivered: 1000, emailSent: 600, emailOpened: 150 })).expect(201);
    const r = await member.post("/api/reports").send({ date: "2026-10-05" }).expect(201);
    const k = r.body.report.data.kpis;
    expect(k).toMatchObject({ waSent: 2000, waDelivered: 1900, deliveryPct: 95, emailSent: 1000, emailOpened: 250, openPct: 25, entries: 2 });
    expect(r.body.report.whatsappText).toContain("Delivered: 1,900");
    expect(r.body.report.waLinks[0].url).toMatch(/^https:\/\/wa\.me\//);
    expect(r.body.report.data.summarySource).toBe("template");
    // previous working day of Mon 5 Oct 2026 is Sat 3 Oct (1st Saturday)
    expect(r.body.report.data.previousDate).toBe("2026-10-03");
  });

  it("emails a report (dry run) and records it", async () => {
    const admin = await login(A.users.admin.email);
    await admin.put("/api/settings").send({ reportEmails: ["boss@alpha.test"] }).expect(200);
    const rep = await admin.post("/api/reports").send({ date: "2026-10-05" }).expect(201);
    const sent = await admin.post(`/api/reports/${rep.body.report.id}/email`).send({}).expect(200);
    expect(sent.body.to).toEqual(["boss@alpha.test"]);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: rep.body.report.id } });
    expect(row.sentVia).toContain("email");
  });
});
