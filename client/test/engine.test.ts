import { describe, expect, it } from "vitest";
import { buildSheet, detectKind, parseCsvText, parseFile, ParseError } from "../src/engine/parse";
import { inferColumn, resolveAmbiguity } from "../src/engine/infer";
import { parseDate, parseNumber, toEpochDay } from "../src/engine/values";
import { applyOp, buildTable } from "../src/engine/table";
import { assessQuality, profileTable } from "../src/engine/profile";
import { generateInsights } from "../src/engine/insights";
import { planJoin } from "../src/engine/merge";
import { analyzeSheet } from "../src/engine/pipeline";
import { allRows } from "../src/engine/analytics";
import { evaluate, fileFrom, loadSample } from "./helpers";

describe("parser edge cases", () => {
  it("rejects empty and incompatible files", async () => {
    await expect(parseFile(fileFrom("empty.csv", ""))).rejects.toThrow(ParseError);
    await expect(parseFile(fileFrom("notes.docx", "hello"))).rejects.toThrow(/supported/);
    expect(() => detectKind("fake.xlsx", 10, new TextEncoder().encode("a,b,c"))).toThrow(/doesn't look like/);
    expect(() => detectKind("big.csv", 40 * 1024 * 1024, new Uint8Array([97]))).toThrow(/limit/);
  });

  it("handles missing headers and duplicate column names", () => {
    const noHeader = parseCsvText("1,2,3\n4,5,6\n");
    expect(noHeader.headers).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(noHeader.rows.length).toBe(2);
    const dup = parseCsvText("Name,Name,,Score\na,b,c,1\n");
    expect(dup.headers).toEqual(["Name", "Name (2)", "Column 3", "Score"]);
  });

  it("reads malformed CSV as best it can and reports ragged rows", () => {
    const s = parseCsvText('a,b\n1,2\n3,4,5\n"6,7\n');
    expect(s.rows.length).toBeGreaterThanOrEqual(2);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("detects semicolon-separated files", () => {
    const s = parseCsvText("City;Sales\nPune;10\nMumbai;20\n");
    expect(s.headers).toEqual(["City", "Sales"]);
  });

  it("returns an empty sheet for a headers-only file without crashing", () => {
    const s = buildSheet("x", [["a", "b"]]);
    expect(s.rows.length).toBe(0);
  });
});

describe("value parsing", () => {
  it("parses Indian and western number formats, currency and %", () => {
    expect(parseNumber("₹1,23,456.50")).toMatchObject({ value: 123456.5, currency: "₹" });
    expect(parseNumber("$1,234")?.value).toBe(1234);
    expect(parseNumber("(1,200)")?.value).toBe(-1200);
    expect(parseNumber("45%")).toMatchObject({ value: 45, percent: true });
    expect(parseNumber("12-03-2024")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
  });
  it("parses dates in common formats and rejects invalid ones", () => {
    expect(parseDate("2024-03-15")).toBe(toEpochDay(2024, 3, 15));
    expect(parseDate("15/03/2024", "dmy")).toBe(toEpochDay(2024, 3, 15));
    expect(parseDate("03/15/2024", "mdy")).toBe(toEpochDay(2024, 3, 15));
    expect(parseDate("15-Mar-2024")).toBe(toEpochDay(2024, 3, 15));
    expect(parseDate("Mar 2024")).toBe(toEpochDay(2024, 3, 1));
    expect(parseDate("31/02/2026")).toBeNull();
  });
});

describe("schema inference", () => {
  it("asks about ambiguous date order instead of guessing", () => {
    const col = inferColumn(0, "Date", ["01/02/2024", "03/04/2024", "05/06/2024"]);
    expect(col.type).toBe("date");
    expect(col.ambiguity?.kind).toBe("date-order");
    const fixed = resolveAmbiguity(col, "mdy");
    expect(fixed.dateOrder).toBe("mdy");
    expect(fixed.ambiguity?.resolved).toBe(true);
  });
  it("decides date order when the data proves it", () => {
    expect(inferColumn(0, "Date", ["25/01/2024", "03/04/2024"]).dateOrder).toBe("dmy");
    expect(inferColumn(0, "Date", ["01/25/2024", "03/04/2024"]).dateOrder).toBe("mdy");
  });
  it("detects currency, percentages, identifiers and categories", () => {
    expect(inferColumn(0, "Amount", ["₹100", "₹2,000", "₹350"]).type).toBe("currency");
    expect(inferColumn(0, "Revenue", [100, 200, 300]).type).toBe("currency");
    expect(inferColumn(0, "Conversion", ["12%", "15%", "9%"]).type).toBe("percentage");
    const frac = inferColumn(0, "Margin", [0.12, 0.3, 0.25]);
    expect(frac.type).toBe("percentage");
    expect(frac.percentScale).toBe("fraction");
    expect(inferColumn(0, "Employee ID", Array.from({ length: 30 }, (_, i) => `E${i}`)).type).toBe("identifier");
    expect(inferColumn(0, "City", Array.from({ length: 100 }, (_, i) => ["Pune", "Mumbai", "Delhi"][i % 3])).type).toBe("category");
  });
  it("asks when a column might or might not be money", () => {
    const c = inferColumn(0, "Total", [10, 20, 30]);
    expect(c.type).toBe("number");
    expect(c.ambiguity?.kind).toBe("money");
    expect(resolveAmbiguity(c, "currency").type).toBe("currency");
  });
  it("flags mixed-type columns", () => {
    const values = [...Array.from({ length: 16 }, (_, i) => i * 10), "n/a", "unknown", "-", "pending"];
    const c = inferColumn(0, "Units", values);
    expect(c.ambiguity?.kind).toBe("mixed-type");
  });
});

describe("cleaning keeps the original data", () => {
  it("previews, applies and can be undone because originals are untouched", async () => {
    const rec = await loadSample("messy-expenses.csv");
    const original = JSON.stringify(rec.rows);
    const dup = applyOp(rec.rows, rec.schema, { kind: "removeDuplicates" });
    expect(dup.removedRows).toBeGreaterThan(0);
    const dept = rec.schema.find((c) => c.name === "Department")!;
    const fill = applyOp(rec.rows, rec.schema, { kind: "fillMissing", columnKey: dept.key, method: "value", value: "Unknown" });
    expect(fill.changedCells).toBeGreaterThan(0);
    expect(fill.examples[0].after).toBe("Unknown");
    const trim = applyOp(rec.rows, rec.schema, { kind: "trim" });
    expect(trim.changedCells).toBeGreaterThan(0);
    expect(JSON.stringify(rec.rows)).toBe(original); // never mutated
    const after = evaluate({ ...rec, ops: [{ kind: "removeDuplicates" }, { kind: "trim" }] });
    expect(after.quality.duplicateRows).toBe(0);
    expect(after.quality.issues.some((i) => i.kind === "whitespace")).toBe(false);
  });
});

describe("insights are grounded", () => {
  it("every number in every insight appears in its evidence", async () => {
    for (const f of ["sales-orders.xlsx", "hr-employees.xlsx", "student-marks.csv", "messy-expenses.csv"]) {
      const rec = await loadSample(f);
      const ev = evaluate(rec);
      const { observations, recommendations } = generateInsights(ev.table, ev.rows, ev.profiles, ev.quality, rec.domain);
      for (const o of observations) {
        const evidence = o.evidence.map((e) => `${e.label} ${e.value}`).join(" ");
        let text = o.text;
        for (const nm of rec.schema.map((c) => c.name).sort((a, b) => b.length - a.length)) text = text.split(nm).join("");
        const nums = (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,$/, ""));
        for (const n of nums) expect(evidence, `${f}: "${o.text}"`).toContain(n);
      }
      for (const r of recommendations) expect(observations.map((o) => o.id)).toContain(r.basedOn);
    }
  });
});

describe("guided merge", () => {
  it("reports match rate and never modifies sources", async () => {
    const orders = await loadSample("sales-orders.xlsx", "Orders");
    const targets = await loadSample("sales-orders.xlsx", "Targets");
    const left = orders.schema.find((c) => c.name === "Region")!;
    const right = targets.schema.find((c) => c.name === "Region")!;
    const p = planJoin(orders, targets, { leftKey: left.key, rightKey: right.key, type: "left" });
    expect(p.matchRate).toBe(100);
    expect(p.resultRows).toBe(orders.rowCount);
    expect(p.headers).toContain("Annual Target (₹)");
    const bad = planJoin(orders, targets, { leftKey: orders.schema.find((c) => c.name === "Product")!.key, rightKey: right.key, type: "inner" });
    expect(bad.matchRate).toBe(0);
    expect(bad.warnings.some((w) => /found a match/.test(w))).toBe(true);
  });
});

describe("dashboard recomputes consistently", () => {
  it("KPIs on filtered rows equal a manual calculation", async () => {
    const rec = await loadSample("sales-orders.xlsx", "Orders");
    const ev = evaluate(rec);
    const region = rec.schema.find((c) => c.name === "Region")!;
    const revenue = rec.schema.find((c) => c.name === "Revenue (₹)")!;
    const west = allRows(ev.table).filter((i) => ev.table.str[region.key][i] === "West");
    const manual = west.reduce((a, i) => a + (ev.table.num[revenue.key][i] ?? 0), 0);
    const { evaluateKpis } = await import("../src/engine/kpi");
    const vals = evaluateKpis(rec.dashboard.kpis, ev.table, west, { quality: ev.quality });
    const def = rec.dashboard.kpis.find((k) => k.name === "Total Revenue (₹)")!;
    expect(vals.find((v) => v.id === def.id)!.value).toBe(manual);
  });

  it("analyses a worksheet with no numeric columns without inventing measures", () => {
    const sheet = parseCsvText("Name,City\nA,Pune\nB,Mumbai\nC,Pune\n");
    const rec = analyzeSheet(sheet, { fileName: "people.csv", kind: "csv", sizeBytes: 30 });
    const t = buildTable(rec.schema, rec.rows);
    const q = assessQuality(t, profileTable(t));
    expect(rec.dashboard.kpis.map((k) => k.agg)).not.toContain("sum");
    expect(q.score).toBeGreaterThan(0);
  });
});
