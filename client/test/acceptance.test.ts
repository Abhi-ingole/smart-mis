/**
 * Acceptance tests A–H from the brief, run against the real engine with the
 * example datasets in /samples. KPI values are checked against independent calculations.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import fs from "node:fs";
import path from "node:path";
import { evaluate, loadSample, SAMPLES } from "./helpers";
import { generateInsights } from "../src/engine/insights";
import { buildReport } from "../src/engine/report";
import { reportWorkbook, tableCsv } from "../src/export/exporters";
import { deleteDataset, getDataset, listDatasets, saveDataset, _resetConnection } from "../src/storage/db";

function readSheet(file: string, sheet?: string): Record<string, unknown>[] {
  const wb = XLSX.read(fs.readFileSync(path.join(SAMPLES, file)), { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]]);
}

describe("Test A — sales workbook", () => {
  it("detects sales data and computes revenue KPIs that match the file", async () => {
    const rec = await loadSample("sales-orders.xlsx", "Orders");
    expect(rec.domain.domain).toBe("sales");
    const raw = readSheet("sales-orders.xlsx", "Orders");
    const expectedRevenue = raw.reduce((a, r) => a + Number(r["Revenue (₹)"]), 0);
    const ev = evaluate(rec);
    const rev = ev.byName("Total Revenue (₹)");
    expect(rev.value).toBe(expectedRevenue);
    expect(rev.formula).toBe("SUM(Revenue (₹))");
    expect(rev.display.startsWith("₹")).toBe(true);
    expect(ev.byName("Orders").value).toBe(raw.length);
    expect(ev.byName("Average order value").value).toBeCloseTo(expectedRevenue / raw.length, 6);
    // Trend + category charts are recommended
    const types = rec.dashboard.charts.map((c) => c.type);
    expect(types).toContain("line");
    expect(types).toContain("bar");
    const date = rec.schema.find((c) => c.name === "Order Date")!;
    expect(date.type).toBe("date");
    expect(rec.schema.find((c) => c.name === "Order ID")!.role).toBe("identifier");
    // A comparison only exists because there are dates
    expect(rev.comparison?.label).toMatch(/vs/);
  });

  it("offers every worksheet separately", async () => {
    const targets = await loadSample("sales-orders.xlsx", "Targets");
    expect(targets.rowCount).toBe(5);
    expect(targets.sheetName).toBe("Targets");
  });
});

describe("Test B — HR workbook", () => {
  it("generates workforce metrics without code changes", async () => {
    const rec = await loadSample("hr-employees.xlsx");
    expect(rec.domain.domain).toBe("hr");
    const raw = readSheet("hr-employees.xlsx");
    const ev = evaluate(rec);
    expect(ev.byName("Headcount").value).toBe(raw.length);
    const avg = raw.reduce((a, r) => a + Number(r["Monthly Salary (₹)"]), 0) / raw.length;
    expect(ev.byName("Average Monthly Salary (₹)").value).toBeCloseTo(avg, 6);
    const resigned = raw.filter((r) => r.Status === "Resigned").length;
    expect(ev.byName("Attrition rate").value).toBeCloseTo((resigned / raw.length) * 100, 6);
    expect(ev.byName("Attrition rate").formula).toContain("Status = Resigned");
  });
});

describe("Test C — student marks CSV", () => {
  it("generates academic metrics from the column mapping", async () => {
    const rec = await loadSample("student-marks.csv");
    expect(rec.domain.domain).toBe("academic");
    const ev = evaluate(rec);
    const text = fs.readFileSync(path.join(SAMPLES, "student-marks.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    const marks = text.map((r) => Number(r[5]));
    expect(ev.byName("Average Marks Obtained").value).toBeCloseTo(marks.reduce((a, b) => a + b, 0) / marks.length, 6);
    expect(ev.byName("Highest Marks Obtained").value).toBe(Math.max(...marks));
    expect(ev.byName("Students").value).toBe(60);
    const pass = text.filter((r) => r[6] === "Pass").length;
    expect(ev.byName("Pass rate").value).toBeCloseTo((pass / text.length) * 100, 6);
    // Uses the Result column — never an assumed pass mark
    expect(ev.byName("Pass rate").formula).toContain("Result = Pass");
  });
});

describe("Test D — unknown custom data", () => {
  it("stays generic and only reports descriptive statistics", async () => {
    const rec = await loadSample("custom-measurements.csv");
    expect(rec.domain.domain).toBe("generic");
    const names = rec.dashboard.kpis.map((k) => k.name);
    expect(names).toContain("Total records");
    expect(names.some((n) => /revenue|salary|headcount|students|attrition|pass/i.test(n))).toBe(false);
    // Correlated Alpha/Beta → a scatter is recommended
    expect(rec.dashboard.charts.some((c) => c.type === "scatter")).toBe(true);
    const ev = evaluate(rec);
    const ins = generateInsights(ev.table, ev.rows, ev.profiles, ev.quality, rec.domain);
    expect(ins.observations.every((o) => !/revenue|sales|profit|employee|student/i.test(o.text))).toBe(true);
    // No dates → no period in the report
    const report = buildReport({ meta: rec, table: ev.table, rows: ev.rows, profiles: ev.profiles, quality: ev.quality, dashboard: rec.dashboard, kpiValues: ev.values, insights: ins });
    expect(report.period).toBeNull();
    expect(report.periodNote).toMatch(/No date column/);
  });
});

describe("Test E — missing values and duplicates", () => {
  it("shows meaningful quality warnings", async () => {
    const rec = await loadSample("messy-expenses.csv");
    expect(rec.warnings.some((w) => /title row/i.test(w))).toBe(true);
    expect(rec.warnings.some((w) => /Duplicate column name "Amount"/.test(w))).toBe(true);
    expect(rec.headers).toContain("Amount (2)");
    const ev = evaluate(rec);
    expect(ev.quality.duplicateRows).toBeGreaterThanOrEqual(1);
    const kinds = new Set(ev.quality.issues.map((i) => i.kind));
    expect(kinds.has("duplicates")).toBe(true);
    expect(kinds.has("missing")).toBe(true);
    expect(kinds.has("whitespace")).toBe(true);
    expect(ev.quality.issues.some((i) => i.kind === "invalid" || i.kind === "mixed")).toBe(true); // 31/02 and "N/A"
    expect(ev.quality.score).toBeLessThan(90);
  });
});

describe("Test F — report export", () => {
  it("builds an Excel report with all sheets and safe CSV", async () => {
    const rec = await loadSample("sales-orders.xlsx", "Orders");
    const ev = evaluate(rec);
    const ins = generateInsights(ev.table, ev.rows, ev.profiles, ev.quality, rec.domain);
    const model = buildReport({ meta: rec, table: ev.table, rows: ev.rows, profiles: ev.profiles, quality: ev.quality, dashboard: rec.dashboard, kpiValues: ev.values, insights: ins });
    expect(model.period).not.toBeNull();
    const bytes = reportWorkbook(model, ev.table, ev.rows);
    const wb = XLSX.read(bytes);
    expect(wb.SheetNames).toEqual(["Summary", "KPIs", "Categories", "Insights", "Data quality", "Data"]);
    const kpiSheet = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.KPIs);
    const rev = kpiSheet.find((r) => r.KPI === "Total Revenue (₹)")!;
    expect(rev.Value).toBe(ev.byName("Total Revenue (₹)").display); // same number as the dashboard
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Data).length).toBe(rec.rowCount);
  });

  it("neutralises formulas in CSV exports", async () => {
    const rec = await loadSample("messy-expenses.csv");
    const ev = evaluate(rec);
    const out = tableCsv(ev.table, ev.rows);
    expect(out).toContain("'=SUM(A1:A9)");
    expect(out).not.toMatch(/(^|,)=SUM/m);
  });
});

describe("Test G — local persistence", () => {
  it("keeps datasets after a 'refresh' (new connection)", async () => {
    const rec = await loadSample("student-marks.csv");
    await saveDataset(rec);
    _resetConnection(); // simulates a page reload
    const list = await listDatasets();
    expect(list.map((d) => d.id)).toContain(rec.id);
    const back = await getDataset(rec.id);
    expect(back?.rows.length).toBe(rec.rows.length);
    expect(back?.dashboard.kpis.length).toBe(rec.dashboard.kpis.length);
    await deleteDataset(rec.id);
    expect(await getDataset(rec.id)).toBeNull();
  });
});

describe("Test H — no paid AI", () => {
  it("produces KPIs, charts, insights and a report with no AI at all", async () => {
    const rec = await loadSample("hr-employees.xlsx");
    const ev = evaluate(rec);
    const ins = generateInsights(ev.table, ev.rows, ev.profiles, ev.quality, rec.domain);
    expect(ev.values.length).toBeGreaterThan(3);
    expect(rec.dashboard.charts.length).toBeGreaterThan(3);
    expect(ins.observations.length).toBeGreaterThan(2);
  });
});
