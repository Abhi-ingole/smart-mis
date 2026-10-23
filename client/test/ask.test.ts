import { beforeAll, describe, expect, it } from "vitest";
import { answerQuestion, planQuestion, suggestQuestions } from "../src/engine/ask";
import { analyzeRecord } from "../src/engine/pipeline";
import { allRows } from "../src/engine/analytics";
import { pickMeasure } from "../src/engine/executive";
import { findTimeKey } from "../src/state/view";
import type { DatasetRecord } from "../src/engine/types";
import { loadSample } from "./helpers";

let rec: DatasetRecord;
let a: ReturnType<typeof analyzeRecord>;
let ask: (q: string) => ReturnType<typeof answerQuestion>;
let raw: { region: string; product: string; category: string; qty: number; price: number; revenue: number; customer: string; date: string; pay: string; order: string }[];

beforeAll(async () => {
  rec = await loadSample("sales-orders.xlsx", "Orders");
  a = analyzeRecord(rec);
  const timeKey = findTimeKey(rec, a);
  const m = pickMeasure(rec.dashboard.kpis, rec.schema);
  const measure = rec.schema.find((c) => c.key === m.key);
  ask = (q) => answerQuestion(q, a.table, a.profiles, allRows(a.table), { measure, timeKey });
  const idx = (n: string) => rec.headers.indexOf(n);
  raw = rec.rows.map((r) => ({
    order: String(r[idx("Order ID")]),
    date: String(r[idx("Order Date")]),
    customer: String(r[idx("Customer")]),
    region: String(r[idx("Region")]),
    product: String(r[idx("Product")]),
    category: String(r[idx("Category")]),
    qty: Number(r[idx("Quantity")]),
    price: Number(r[idx("Unit Price (₹)")]),
    revenue: Number(r[idx("Revenue (₹)")]),
    pay: String(r[idx("Payment Mode")]),
  }));
});

const sumBy = <T>(xs: T[], k: (x: T) => string, v: (x: T) => number) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + v(x));
  return [...m].sort((p, q) => q[1] - p[1]);
};
const inr = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

describe("Ask a question", () => {
  it("total revenue by region", () => {
    const r = ask("total revenue by region");
    expect(r.plan.groupBy?.name).toBe("Region");
    expect(r.plan.measure?.name).toBe("Revenue (₹)");
    expect(r.plan.agg).toBe("sum");
    const top = sumBy(
      raw,
      (x) => x.region,
      (x) => x.revenue,
    )[0];
    expect(r.table!.rows[0][0]).toBe(top[0]);
    expect(String(r.table!.rows[0][1])).toContain(inr(top[1]));
  });

  it("region wise sales (Indian phrasing, 'sales' = revenue)", () => {
    const r = ask("region wise sales");
    expect(r.plan.groupBy?.name).toBe("Region");
    expect(r.plan.measure?.name).toBe("Revenue (₹)");
  });

  it("top 5 products by quantity", () => {
    const r = ask("top 5 products by quantity");
    expect(r.plan.groupBy?.name).toBe("Product");
    expect(r.plan.measure?.name).toBe("Quantity");
    expect(r.plan.top).toEqual({ n: 5, dir: "desc" });
    expect(r.table!.rows.length).toBe(5);
    expect(r.table!.rows[0][0]).toBe(
      sumBy(
        raw,
        (x) => x.product,
        (x) => x.qty,
      )[0][0],
    );
  });

  it("average unit price in West", () => {
    const r = ask("average unit price in West");
    expect(r.plan.agg).toBe("avg");
    expect(r.plan.measure?.name).toBe("Unit Price (₹)");
    expect(r.plan.filters.map((f) => f.values)).toEqual([["West"]]);
    const west = raw.filter((x) => x.region === "West");
    const avg = west.reduce((s, x) => s + x.price, 0) / west.length;
    expect(r.headline).toContain(inr(avg));
    expect(r.rowsUsed).toBe(west.length);
  });

  it("how many customers", () => {
    const r = ask("How many customers are there?");
    expect(r.plan.agg).toBe("countDistinct");
    expect(r.headline).toContain(String(new Set(raw.map((x) => x.customer.toLowerCase())).size));
  });

  it("how many orders by payment mode", () => {
    const r = ask("how many orders by payment mode");
    expect(r.plan.agg).toBe("countDistinct");
    expect(r.plan.distinctOf?.name).toBe("Order ID");
    expect(r.plan.groupBy?.name).toBe("Payment Mode");
    const top = sumBy(
      raw,
      (x) => x.pay,
      () => 1,
    )[0];
    expect(r.table!.rows[0]).toEqual([top[0], inr(top[1])]);
  });

  it("which category has the highest revenue", () => {
    const r = ask("Which category has the highest revenue?");
    expect(r.plan.groupBy?.name).toBe("Category");
    expect(r.plan.top?.n).toBe(1);
    const top = sumBy(
      raw,
      (x) => x.category,
      (x) => x.revenue,
    )[0];
    expect(r.headline.startsWith(top[0])).toBe(true);
  });

  it("monthly trend of revenue", () => {
    const r = ask("monthly trend of revenue");
    expect(r.plan.bucket).toBe("month");
    expect(r.chart?.kind).toBe("line");
    expect(r.chart!.points.length).toBe(12);
    const total = r.chart!.points.reduce((s, p) => s + p.value, 0);
    expect(Math.round(total)).toBe(Math.round(raw.reduce((s, x) => s + x.revenue, 0)));
  });

  it("revenue in March 2026 and in FY 2025-26", () => {
    const march = ask("total revenue in march 2026");
    const exp = raw.filter((x) => x.date.startsWith("2026-03")).reduce((s, x) => s + x.revenue, 0);
    expect(march.headline).toContain(inr(exp));
    const fy = ask("total revenue in FY 2025-26");
    expect(fy.plan.dates?.label).toBe("FY 2025-26");
    expect(fy.rowsUsed).toBe(raw.length);
  });

  it("compare West and East revenue", () => {
    const r = ask("compare West and East revenue");
    expect(r.plan.groupBy?.name).toBe("Region");
    expect(r.table!.rows.map((x) => x[0]).sort()).toEqual(["East", "West"]);
  });

  it("filters by two columns and explains the interpretation", () => {
    const r = ask("total quantity of Furniture in North");
    expect(r.plan.filters.map((f) => f.column.name).sort()).toEqual(["Category", "Region"]);
    const exp = raw.filter((x) => x.category === "Furniture" && x.region === "North").reduce((s, x) => s + x.qty, 0);
    expect(r.headline).toContain(inr(exp));
    expect(r.plan.understood.map((u) => u.label)).toEqual(expect.arrayContaining(["Calculation", "Category", "Region"]));
  });

  it("says so when nothing matches", () => {
    const r = ask("what is the weather like");
    expect(r.ok).toBe(false);
  });

  it("suggests questions that it can answer", () => {
    const m = pickMeasure(rec.dashboard.kpis, rec.schema);
    const qs = suggestQuestions(
      a.table,
      a.profiles,
      rec.schema.find((c) => c.key === m.key),
      findTimeKey(rec, a),
    );
    expect(qs.length).toBeGreaterThanOrEqual(4);
    for (const q of qs) expect(ask(q).ok, q).toBe(true);
  });

  it("plans highest single value without grouping", () => {
    const p = planQuestion("highest revenue", a.table, a.profiles, {});
    expect(p.agg).toBe("max");
  });
});
