import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { numbersIn, ungroundedNumbers } from "../src/lib/numbers";

const app = createApp();
const ORIGIN = "http://localhost:5173";

describe("AI endpoint (no paid API required)", () => {
  it("reports AI as unavailable when no key is set", async () => {
    const r = await request(app).get("/api/ai/status").expect(200);
    expect(r.body.available).toBe(false);
  });

  it("returns 503 instead of failing when AI is not configured", async () => {
    const r = await request(app).post("/api/ai/insights").set("Origin", ORIGIN).send({ datasetName: "Sales", facts: { rows: 10 }, consent: true });
    expect(r.status).toBe(503);
  });

  it("requires explicit consent", async () => {
    const r = await request(app).post("/api/ai/insights").set("Origin", ORIGIN).send({ datasetName: "Sales", facts: { rows: 10 } });
    expect(r.status).toBe(400);
  });

  it("rejects requests from other origins and oversized summaries", async () => {
    expect((await request(app).post("/api/ai/insights").set("Origin", "https://evil.example").send({ datasetName: "x", facts: {}, consent: true })).status).toBe(403);
    const big = { blob: "x".repeat(70_000) };
    const r = await request(app).post("/api/ai/insights").set("Origin", ORIGIN).send({ datasetName: "x", facts: big, consent: true });
    expect([400, 413]).toContain(r.status);
  });

  it("sets security headers", async () => {
    const r = await request(app).get("/api/health").expect(200);
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("number grounding", () => {
  const facts = { kpis: [{ name: "Total Revenue", value: "12,45,000" }, { name: "Growth", value: "8.5%" }], rows: 1200 };
  it("normalises numbers", () => {
    expect(numbersIn("₹12,45,000 and 95.0%")).toEqual(["1245000", "95"]);
  });
  it("accepts text that only uses given numbers", () => {
    expect(ungroundedNumbers("Revenue reached 12,45,000 across 1,200 rows, up 8.5%.", facts)).toEqual([]);
  });
  it("flags invented numbers", () => {
    expect(ungroundedNumbers("Revenue will reach 15,00,000 next quarter.", facts)).toEqual(["1500000"]);
  });
});
