import { describe, expect, it } from "vitest";
import { parseCsvText } from "../src/engine/parse";
import { analyzeRecord, analyzeSheet } from "../src/engine/pipeline";
import { allRows } from "../src/engine/analytics";
import { guessYearMode, monthSeries, priorPeriod, quarterMatrix, rowsIn, yearOptions } from "../src/engine/executive";
import { findTimeKey } from "../src/state/view";

// Two financial years of monthly sales for two regions: Apr 2024 – Sep 2025.
function data() {
  const lines = ["Date,Region,Sales"];
  const expected: Record<string, number> = {};
  for (let k = 0; k < 18; k++) {
    const y = 2024 + Math.floor((3 + k) / 12);
    const m = ((3 + k) % 12) + 1;
    for (const [region, base] of [
      ["North", 100],
      ["South", 50],
    ] as const) {
      const v = base + k * 10;
      lines.push(`${y}-${String(m).padStart(2, "0")}-15,${region},${v}`);
      const key = `${y}-${m}`;
      expected[key] = (expected[key] ?? 0) + v;
    }
  }
  return { csv: lines.join("\n"), expected };
}

describe("executive view", () => {
  const { csv, expected } = data();
  const rec = analyzeSheet(parseCsvText(csv, "sales"), { fileName: "sales.csv", kind: "csv", sizeBytes: csv.length });
  const a = analyzeRecord(rec);
  const timeKey = findTimeKey(rec, a)!;
  const rows = allRows(a.table);
  const sales = rec.schema.find((c) => c.name === "Sales")!;
  const region = rec.schema.find((c) => c.name === "Region")!;
  const m = { key: sales.key, agg: "sum" as const, name: "Sales" };

  it("detects the April start and lists financial years newest first", () => {
    expect(guessYearMode(a.table, rows, timeKey, rec.schema)).toBe("fiscal");
    const ys = yearOptions(a.table, rows, timeKey, "fiscal");
    expect(ys.map((y) => y.label)).toEqual(["FY 2025-26", "FY 2024-25"]);
    expect(rowsIn(a.table, rows, timeKey, ys[1]).length).toBe(24);
    expect(rowsIn(a.table, rows, timeKey, ys[0]).length).toBe(12);
    expect(yearOptions(a.table, rows, timeKey, "calendar").map((y) => y.label)).toEqual(["2025", "2024"]);
  });

  it("gives 12 months of the year, coloured by financial quarter, with last year's month", () => {
    const fy = yearOptions(a.table, rows, timeKey, "fiscal")[0];
    const pts = monthSeries(a.table, rows, timeKey, m, fy, "fiscal");
    expect(pts.map((p) => p.label)).toEqual(["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]);
    expect(pts.map((p) => p.quarter)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(pts[0].value).toBe(expected["2025-4"]);
    expect(pts[0].prior).toBe(expected["2024-4"]);
    expect(pts[6].rows).toBe(0); // Oct 2025 has no data yet
    expect(priorPeriod(fy).start).toBe(yearOptions(a.table, rows, timeKey, "fiscal")[1].start);
  });

  it("builds a region × quarter matrix with the same quarters last year", () => {
    const fy = yearOptions(a.table, rows, timeKey, "fiscal")[0];
    const mx = quarterMatrix(a.table, rows, timeKey, region.key, m, fy);
    expect(mx.rows.map((r) => r.label)).toEqual(["North", "South"]);
    const north = mx.rows[0];
    // Q1 FY25-26 = Apr–Jun 2025 = k 12..14 → 100+120, 100+130, 100+140
    expect(north.quarters[0]).toBe(220 + 230 + 240);
    expect(north.prior[0]).toBe(100 + 110 + 120);
    expect(north.quarters[2]).toBeNull();
    expect(mx.total.total).toBe(
      Object.entries(expected)
        .filter(([k]) => k.startsWith("2025-") && Number(k.split("-")[1]) >= 4)
        .reduce((s, [, v]) => s + v, 0),
    );
  });
});
