import { describe, expect, it } from "vitest";
import { allChanges, changeFor, computeKpis, pct, pctChange } from "../src/lib/kpi";
import { isWorkingDay, nthWeekdayOfMonth, offReason, previousWorkingDay } from "../src/lib/workingDays";
import { metricSchema } from "../src/lib/validation";
import { maskPII } from "../src/lib/mask";
import { buildFacts, summaryNumbersValid, templateSummary } from "../src/services/summary";
import { extractByRules, integersIn, tableToText, verifyFromSource } from "../src/services/extract";

describe("KPI calculation", () => {
  it("computes percentages to one decimal and handles zero", () => {
    expect(pct(950, 1000)).toBe(95);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
  });

  it("sums multiple entries on one day before calculating rates", () => {
    const k = computeKpis([
      { waRecipients: 1000, waDelivered: 900, emailSent: 500, emailOpened: 100 },
      { waRecipients: 3000, waDelivered: 2900, emailSent: 1500, emailOpened: 400 },
    ]);
    expect(k).toEqual({ waSent: 4000, waDelivered: 3800, deliveryPct: 95, emailSent: 2000, emailOpened: 500, openPct: 25, entries: 2 });
  });

  it("calculates % change and returns null when previous is zero", () => {
    expect(pctChange(112, 100)).toBe(12);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(50, null)).toBeNull();
  });

  it("describes changes in words with direction", () => {
    const cur = computeKpis([{ waRecipients: 1120, waDelivered: 1000, emailSent: 100, emailOpened: 20 }]);
    const prev = computeKpis([{ waRecipients: 1000, waDelivered: 1000, emailSent: 100, emailOpened: 25 }]);
    const ch = allChanges(cur, prev, "Tue");
    expect(ch.waSent.words).toBe("Up 12% vs Tue");
    expect(ch.waSent.direction).toBe("up");
    expect(ch.waDelivered.words).toBe("No change vs Tue");
    expect(ch.emailOpened.words).toBe("Down 20% vs Tue");
    // percentage KPIs change in points, not percent
    expect(ch.deliveryPct.unit).toBe("pts");
    expect(ch.deliveryPct.delta).toBe(-10.7);
    expect(ch.deliveryPct.words).toBe("Down 10.7 pts vs Tue");
  });

  it("says when there is no previous data", () => {
    const cur = computeKpis([{ waRecipients: 10, waDelivered: 5, emailSent: 0, emailOpened: 0 }]);
    expect(changeFor("waSent", cur, null, "Mon").words).toBe("No data for Mon");
    expect(changeFor("waSent", cur, computeKpis([]), "Mon").direction).toBe("none");
  });
});

describe("working days", () => {
  // October 2026: Saturdays are 3, 10, 17, 24, 31; Sundays 4, 11, 18, 25.
  it("skips Sundays", () => {
    expect(isWorkingDay("2026-10-04")).toBe(false);
    expect(offReason("2026-10-04")).toBe("Sunday");
  });

  it("skips 2nd and 4th Saturdays but not 1st, 3rd or 5th", () => {
    expect(nthWeekdayOfMonth("2026-10-10")).toBe(2);
    expect(isWorkingDay("2026-10-03")).toBe(true);
    expect(isWorkingDay("2026-10-10")).toBe(false);
    expect(isWorkingDay("2026-10-17")).toBe(true);
    expect(isWorkingDay("2026-10-24")).toBe(false);
    expect(isWorkingDay("2026-10-31")).toBe(true);
    expect(offReason("2026-10-24")).toBe("4th Saturday");
  });

  it("skips holidays", () => {
    expect(isWorkingDay("2026-10-02", undefined, ["2026-10-02"])).toBe(false);
    expect(offReason("2026-10-02", undefined, new Map([["2026-10-02", "Gandhi Jayanti"]]))).toBe("Holiday: Gandhi Jayanti");
  });

  it("finds the previous working day across weekends and holidays", () => {
    expect(previousWorkingDay("2026-10-12")).toBe("2026-10-09"); // Mon → Fri (2nd Sat + Sun skipped)
    expect(previousWorkingDay("2026-10-19")).toBe("2026-10-17"); // Mon → 3rd Sat
    expect(previousWorkingDay("2026-10-12", undefined, ["2026-10-09"])).toBe("2026-10-08");
  });

  it("follows edited rules", () => {
    const rules = { weekdaysOff: [0, 6], saturdaysOff: [] };
    expect(isWorkingDay("2026-10-17", rules)).toBe(false);
    expect(isWorkingDay("2026-10-04", { weekdaysOff: [], saturdaysOff: [] })).toBe(true);
  });
});

describe("validation rules", () => {
  const schema = metricSchema(() => "2026-10-21");
  const base = { reportDate: "2026-10-20", campaign: "X", waRecipients: 100, waDelivered: 90, emailSent: 50, emailOpened: 10 };
  const messages = (input: object) => {
    const r = schema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("accepts a valid entry", () => {
    expect(schema.safeParse(base).success).toBe(true);
  });
  it("rejects negative numbers", () => {
    expect(messages({ ...base, waRecipients: -1 })).toContain("Cannot be negative");
  });
  it("rejects future dates", () => {
    expect(messages({ ...base, reportDate: "2026-10-22" })).toContain("Date cannot be in the future");
  });
  it("rejects impossible dates", () => {
    expect(messages({ ...base, reportDate: "2026-02-30" })).toContain("Not a real calendar date");
  });
  it("rejects delivered > recipients", () => {
    expect(messages({ ...base, waDelivered: 101 })).toContain("WhatsApp delivered cannot be more than recipients");
  });
  it("rejects opened > sent", () => {
    expect(messages({ ...base, emailOpened: 51 })).toContain("Emails opened cannot be more than emails sent");
  });
  it("rejects decimals and missing campaign", () => {
    expect(schema.safeParse({ ...base, emailSent: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...base, campaign: "  " }).success).toBe(false);
  });
});

describe("privacy masking before AI", () => {
  it("masks phone numbers and emails but keeps counts", () => {
    const t = maskPII("Contact +91 98765 43210 or 9876543210 / ops@vendor.com. Delivered: 12,345 Total: 9999");
    expect(t).not.toMatch(/98765|ops@vendor/);
    expect(t).toContain("[phone]");
    expect(t).toContain("[email]");
    expect(t).toContain("12,345");
    expect(t).toContain("9999");
  });
});

describe("extraction helpers", () => {
  it("reads integers but skips percentages and dates", () => {
    expect(integersIn("Delivered 11,902 (95.4%) on 20-10-2026")).toEqual([11902]);
  });
  it("matches vendor keywords", () => {
    const r = extractByRules("Total Submitted: 12,480\nDelivered: 11,902\nUndelivered: 578\nDelivery rate: 95.4%", "wa");
    expect(r.fields.waRecipients?.value).toBe(12480);
    expect(r.fields.waDelivered?.value).toBe(11902);
    const e = extractByRules("Emails Sent: 8450\nOpen Rate: 23.9%\nUnique Opens: 1987", "email");
    expect(e.fields.emailSent?.value).toBe(8450);
    expect(e.fields.emailOpened?.value).toBe(1987);
  });
  it("only accepts AI values that appear in the quoted source line", () => {
    const text = "Delivered: 11,902\nRead: 8,115";
    expect(verifyFromSource(text, 11902, "Delivered: 11,902")?.value).toBe(11902);
    expect(verifyFromSource(text, 12000, "Delivered: 11,902")).toBeNull(); // value not in line
    expect(verifyFromSource(text, 11902, "Delivered total: 11,902")).toBeNull(); // line not in file
  });
  it("turns summary tables into labelled lines and drops personal columns", () => {
    const t = tableToText({ headers: ["Phone", "Sent", "Delivered"], rows: [["9800000001", "10", "9"], ["9800000002", "5", "5"]] });
    expect(t).toContain("Sent: 15");
    expect(t).toContain("Delivered: 14");
    expect(t).not.toContain("98000");
  });
});

describe("AI summary number check", () => {
  const kpis = computeKpis([{ waRecipients: 12480, waDelivered: 11902, emailSent: 8450, emailOpened: 1987 }]);
  const prev = computeKpis([{ waRecipients: 12000, waDelivered: 11500, emailSent: 8000, emailOpened: 2000 }]);
  const input = { companyName: "Demo", date: "2026-10-20", kpis, changes: allChanges(kpis, prev, "Mon"), previousLabel: "Mon" };
  const facts = buildFacts(input);

  it("accepts a summary that only uses given numbers", () => {
    expect(summaryNumbersValid("WhatsApp delivered 11,902 of 12,480 messages (95.4%), up 4% vs Mon.", facts).ok).toBe(true);
  });
  it("rejects invented or recalculated numbers", () => {
    const r = summaryNumbersValid("About 12,500 messages went out and 578 failed.", facts);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["12500", "578"]);
  });
  it("template summary always passes its own check", () => {
    const t = templateSummary(input);
    expect(summaryNumbersValid(t, facts).ok).toBe(true);
  });
});
