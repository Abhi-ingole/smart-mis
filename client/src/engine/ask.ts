/**
 * Questions in plain English, answered from the data with the same engine as the
 * dashboard. The question is matched to columns, values, calculations and dates
 * by rules (no external service), and the interpretation is always shown, so the
 * user can see exactly what was calculated.
 *
 * Examples: "total revenue by region", "top 5 products by quantity",
 * "average unit price in West", "monthly trend of revenue in FY 2025-26",
 * "how many customers", "which category has the highest revenue", "region wise sales".
 */
import type { ColumnProfile, ColumnSchema, Table, TimeBucket } from "./types";
import { aggregate, groupBy, numericValues, timeSeries, type SimpleAgg } from "./analytics";
import { fmtNumber, fmtPercent, fmtValue } from "./format";
import { isNumericType } from "./table";
import { epochDayToIso } from "./values";

export type AskAgg = SimpleAgg;

export interface AskPlan {
  agg: AskAgg;
  measure?: ColumnSchema;
  /** For "how many customers": count distinct values of this column. */
  distinctOf?: ColumnSchema;
  groupBy?: ColumnSchema;
  bucket?: TimeBucket;
  filters: { column: ColumnSchema; values: string[] }[];
  dates?: { from: number; to: number; label: string };
  top?: { n: number; dir: "desc" | "asc" };
  share: boolean;
  /** Pieces of the question we understood, for display. */
  understood: { label: string; value: string }[];
  /** What we assumed because the question didn't say. */
  assumed: string[];
}

export interface AskAnswer {
  ok: boolean;
  plan: AskPlan;
  headline: string;
  detail?: string;
  rowsUsed: number;
  table?: { headers: string[]; rows: (string | number)[][] };
  chart?: { kind: "bar" | "line"; points: { label: string; value: number }[]; format: (v: number) => string };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "for",
  "by",
  "per",
  "and",
  "or",
  "to",
  "is",
  "are",
  "was",
  "what",
  "which",
  "show",
  "me",
  "give",
  "list",
  "all",
  "with",
  "on",
  "at",
  "from",
  "each",
  "how",
  "many",
  "much",
  "total",
  "data",
  "value",
  "values",
  "count",
  "number",
]);

const SYNONYMS: Partial<Record<ColumnSchema["semantic"], string[]>> = {
  revenue: ["revenue", "sales", "sale", "turnover", "income", "amount", "billing"],
  cost: ["cost", "costs", "expense", "expenses", "spend", "spending"],
  profit: ["profit", "margin", "earnings", "pat"],
  price: ["price", "rate", "unit price"],
  quantity: ["quantity", "qty", "units", "volume"],
  salary: ["salary", "salaries", "pay", "ctc", "wages"],
  score: ["score", "scores", "marks", "mark"],
  rating: ["rating", "ratings"],
  age: ["age"],
  customer: ["customer", "customers", "client", "clients", "buyer", "buyers"],
  product: ["product", "products", "item", "items", "sku"],
  category: ["category", "categories", "type", "segment"],
  region: ["region", "regions", "zone", "zones", "area", "areas", "city", "cities", "state", "states", "location", "branch"],
  department: ["department", "departments", "dept", "team", "teams"],
  status: ["status"],
  payment: ["payment", "payments", "payment mode", "mode"],
  person: ["employee", "employees", "person", "people", "name", "student", "students", "staff"],
  employee_id: ["employee", "employees", "staff", "headcount"],
  student_id: ["student", "students"],
  order_id: ["order", "orders", "invoice", "invoices", "transaction", "transactions", "bill", "bills"],
  subject: ["subject", "subjects"],
  gender: ["gender"],
  result: ["result", "results"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[₹$€£]/g, " ")
    .replace(/[^a-z0-9%.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const plainName = (c: ColumnSchema) => norm(c.name.replace(/\(.*?\)/g, ""));
const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

interface Mention {
  column: ColumnSchema;
  start: number;
  end: number;
  score: number;
}

/** Finds a phrase as whole words; returns its index or -1. */
function findPhrase(q: string, phrase: string): number {
  if (!phrase || phrase.length < 2) return -1;
  const re = new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?(?=\\s|$)`);
  const m = re.exec(q);
  return m ? m.index + m[1].length : -1;
}

function columnMentions(q: string, schema: ColumnSchema[]): Mention[] {
  const out: Mention[] = [];
  for (const c of schema) {
    if (c.excluded) continue;
    const names = new Set<string>([plainName(c), norm(c.name), singular(plainName(c))]);
    // Multi-word headers: also try the last word ("Unit Price" → "price" only via synonyms, "Order Date" → "date")
    for (const s of SYNONYMS[c.semantic] ?? []) names.add(s);
    let best: Mention | null = null;
    for (const n of names) {
      if (!n || STOP.has(n)) continue;
      const at = findPhrase(q, n);
      if (at < 0) continue;
      const exact = n === plainName(c) || n === singular(plainName(c));
      const score = n.length + (exact ? 10 : 0);
      if (!best || score > best.score) best = { column: c, start: at, end: at + n.length, score };
    }
    if (best) out.push(best);
  }
  // A later, longer match wins when two columns claim the same words ("unit price" vs "price").
  return out.filter((m) => !out.some((o) => o !== m && o.score > m.score && o.start <= m.start && o.end >= m.end));
}

function valueMentions(q: string, table: Table, schema: ColumnSchema[], profiles: Record<string, ColumnProfile>, taken: Mention[]): { column: ColumnSchema; value: string; start: number }[] {
  const out: { column: ColumnSchema; value: string; start: number; len: number }[] = [];
  for (const c of schema) {
    if (c.excluded || (c.role !== "dimension" && c.type !== "category" && c.type !== "boolean")) continue;
    const distinct = profiles[c.key]?.distinct ?? 0;
    if (distinct === 0 || distinct > 2000) continue;
    const seen = new Set<string>();
    const col = table.str[c.key];
    for (let i = 0; i < col.length && seen.size < 2000; i++) {
      const v = col[i];
      if (v === null || seen.has(v)) continue;
      seen.add(v);
      const n = norm(v);
      if (n.length < 2 || STOP.has(n) || /^\d+(\.\d+)?$/.test(n)) continue;
      const at = findPhrase(q, n);
      if (at < 0) continue;
      if (taken.some((t) => at >= t.start && at < t.end)) continue; // the words name a column, not a value
      out.push({ column: c, value: v, start: at, len: n.length });
    }
  }
  // Prefer longer values when they overlap ("north east" over "north").
  return out.filter((m) => !out.some((o) => o !== m && o.len > m.len && o.start <= m.start && o.start + o.len >= m.start + m.len));
}

const dayOf = (y: number, m: number, d = 1) => Math.floor(Date.UTC(y, m, d) / 86_400_000);
const fmtDay = (d: number) => {
  const [y, m, dd] = epochDayToIso(d).split("-").map(Number);
  return `${dd} ${MONTH_SHORT[m - 1][0].toUpperCase()}${MONTH_SHORT[m - 1].slice(1)} ${y}`;
};

/** Dates mentioned in the question, relative to the data's own latest date for "last month" etc. */
function dateMention(q: string, maxDay: number | null): AskPlan["dates"] | undefined {
  const fy = /\bfy\s*'?(\d{2,4})(?:\s*-\s*(\d{2,4}))?\b/.exec(q);
  if (fy) {
    let y = Number(fy[1]);
    if (y < 100) y += 2000;
    return { from: dayOf(y, 3), to: dayOf(y + 1, 3), label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}` };
  }
  const q4 = /\bq([1-4])\s*(\d{4})\b/.exec(q);
  if (q4) {
    const y = Number(q4[2]);
    const qi = Number(q4[1]) - 1;
    return { from: dayOf(y, qi * 3), to: dayOf(y, qi * 3 + 3), label: `Q${qi + 1} ${y}` };
  }
  for (let m = 0; m < 12; m++) {
    const re = new RegExp(`\\b(${MONTHS[m]}|${MONTH_SHORT[m]})\\b(?:\\s+(\\d{4}))?`);
    const mm = re.exec(q);
    if (mm && !(MONTH_SHORT[m] === "may" && !mm[2] && !/\bin may\b/.test(q))) {
      let y = mm[2] ? Number(mm[2]) : null;
      if (y === null && maxDay !== null) {
        const latest = new Date(maxDay * 86_400_000);
        y = latest.getUTCMonth() >= m ? latest.getUTCFullYear() : latest.getUTCFullYear() - 1;
      }
      if (y !== null) return { from: dayOf(y, m), to: dayOf(y, m + 1), label: `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}` };
    }
  }
  const year = /\b(?:in|for|during|of|year)\s+(20\d{2}|19\d{2})\b/.exec(q) ?? /\b(20\d{2})\b/.exec(q);
  if (year) {
    const y = Number(year[1]);
    return { from: dayOf(y, 0), to: dayOf(y + 1, 0), label: String(y) };
  }
  if (maxDay !== null) {
    const latest = new Date(maxDay * 86_400_000);
    const ly = latest.getUTCFullYear();
    const lm = latest.getUTCMonth();
    if (/\b(this|current) month\b/.test(q)) return { from: dayOf(ly, lm), to: dayOf(ly, lm + 1), label: "the latest month" };
    if (/\b(last|previous) month\b/.test(q)) return { from: dayOf(ly, lm - 1), to: dayOf(ly, lm), label: "the month before the latest" };
    if (/\b(this|current) year\b/.test(q)) return { from: dayOf(ly, 0), to: dayOf(ly + 1, 0), label: String(ly) };
    if (/\b(last|previous) year\b/.test(q)) return { from: dayOf(ly - 1, 0), to: dayOf(ly, 0), label: String(ly - 1) };
    const lastN = /\b(?:last|past|previous)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/.exec(q);
    if (lastN) {
      const n = Number(lastN[1]);
      const unit = lastN[2];
      const from = unit.startsWith("day") ? maxDay - n + 1 : unit.startsWith("week") ? maxDay - n * 7 + 1 : dayOf(ly, lm - n + 1);
      return { from, to: maxDay + 1, label: `the last ${n} ${unit}` };
    }
  }
  return undefined;
}

export function planQuestion(question: string, table: Table, profiles: Record<string, ColumnProfile>, defaults: { measure?: ColumnSchema; timeKey?: string }): AskPlan {
  const q = norm(question);
  const schema = table.schema.filter((c) => !c.excluded);
  const time = schema.find((c) => c.key === defaults.timeKey);
  let maxDay: number | null = null;
  if (time) for (const d of table.num[time.key]) if (d !== null && (maxDay === null || d > maxDay)) maxDay = d;

  const plan: AskPlan = { agg: "sum", filters: [], share: false, understood: [], assumed: [] };
  const mentions = columnMentions(q, schema).sort((a, b) => a.start - b.start);
  const values = valueMentions(q, table, schema, profiles, mentions);
  for (const v of values) {
    const f = plan.filters.find((x) => x.column.key === v.column.key);
    if (f) f.values.push(v.value);
    else plan.filters.push({ column: v.column, values: [v.value] });
  }
  plan.dates = dateMention(q, maxDay);

  // Calculation
  const has = (re: RegExp) => re.test(q);
  const countWords = has(/\b(how many|number of|count|no of|no\. of)\b/);
  if (has(/\b(average|avg|mean)\b/)) plan.agg = "avg";
  else if (has(/\bmedian\b/)) plan.agg = "median";
  else if (countWords) plan.agg = "count";
  const topM = /\b(top|best|highest|largest|biggest|most)\s*(\d{1,2})?\b/.exec(q);
  const bottomM = /\b(bottom|worst|lowest|smallest|least|fewest)\s*(\d{1,2})?\b/.exec(q);
  const maxWord = has(/\b(maximum|max)\b/);
  const minWord = has(/\b(minimum|min)\b/);
  plan.share = has(/\b(share|percentage|percent|%|contribution|split|breakdown)\b/);

  // Time grouping
  const bucketWord =
    /\b(daily|day wise|by day|per day|each day|weekly|week wise|by week|per week|monthly|month wise|by month|per month|each month|month on month|quarterly|quarter wise|by quarter|per quarter|yearly|annually|year wise|by year|per year|each year|trend|over time|growth)\b/.exec(
      q,
    );
  if (bucketWord && time) {
    const w = bucketWord[1];
    plan.bucket = w.includes("day") || w === "daily" ? "day" : w.includes("week") ? "week" : w.includes("quarter") ? "quarter" : w.includes("year") || w === "annually" ? "year" : "month";
  }

  // Measure, group-by and distinct-count columns
  const numeric = mentions.filter((m) => isNumericType(m.column) && m.column.role !== "identifier" && m.column.type !== "date");
  const groupable = mentions.filter((m) => !numeric.includes(m) && m.column.type !== "date" && !plan.filters.some((f) => f.column.key === m.column.key));
  if (numeric.length) plan.measure = numeric[0].column;

  if (plan.agg === "count" && groupable.length) {
    // "how many customers [by region]": the first column after "how many" is what we count.
    const first = groupable[0];
    const groupWord = /\b(by|per|for each|each|wise)\b/.exec(q);
    const counted = groupWord && groupWord.index < first.start ? null : first;
    if (counted && counted.column.role !== "time") {
      plan.distinctOf = counted.column;
      plan.agg = "countDistinct";
    }
  }
  const groupCandidates = groupable.filter((m) => m.column.key !== plan.distinctOf?.key);
  // Explicit "by X / per X / X wise / for each X / which X"
  for (const m of groupCandidates) {
    const before = q.slice(Math.max(0, m.start - 12), m.start);
    const after = q.slice(m.end, m.end + 6);
    if (/\b(by|per|each|across|which|what|top \d+|top|bottom \d+|bottom|best|worst|compare)\s*$/.test(before) || /^\s*(s\s*)?wise\b/.test(after) || /^s?\s*wise/.test(after)) {
      plan.groupBy = m.column;
      break;
    }
  }
  if (!plan.groupBy && !plan.bucket && groupCandidates.length && (topM || bottomM || plan.share || plan.filters.length === 0)) plan.groupBy = groupCandidates[0].column;
  // "compare West and East" → group by the filtered column
  if (!plan.groupBy && has(/\b(compare|vs|versus)\b/)) {
    const multi = plan.filters.find((f) => f.values.length > 1);
    if (multi) plan.groupBy = multi.column;
  }
  if (plan.groupBy?.type === "date") {
    plan.bucket = plan.bucket ?? "month";
    plan.groupBy = undefined;
  }

  if (plan.groupBy) {
    if (topM) plan.top = { n: topM[2] ? Number(topM[2]) : /\b(highest|largest|biggest|most|best)\b/.test(topM[1]) && !/\btop\b/.test(q) ? 1 : 5, dir: "desc" };
    else if (bottomM) plan.top = { n: bottomM[2] ? Number(bottomM[2]) : /\b(lowest|smallest|least|fewest|worst)\b/.test(bottomM[1]) && !/\bbottom\b/.test(q) ? 1 : 5, dir: "asc" };
    if (/\bwhich\b/.test(q) && plan.top && !topM?.[2] && !bottomM?.[2]) plan.top.n = 1;
  } else if (!plan.bucket) {
    if (maxWord || (topM && !topM[2] && /\b(highest|largest|biggest|max)\b/.test(q))) plan.agg = plan.agg === "count" ? "count" : "max";
    else if (minWord || (bottomM && !bottomM[2] && /\b(lowest|smallest|min)\b/.test(q))) plan.agg = plan.agg === "count" ? "count" : "min";
  }

  // Defaults
  if (!plan.measure && plan.agg !== "count" && plan.agg !== "countDistinct") {
    if (
      defaults.measure &&
      (has(/\b(total|sum|average|avg|mean|median|highest|lowest|max|min|top|bottom|best|worst|trend|growth|monthly|quarterly|yearly|wise|share|by|per)\b/) ||
        plan.filters.length ||
        plan.groupBy ||
        plan.bucket)
    ) {
      plan.measure = defaults.measure;
      plan.assumed.push(`Used ${defaults.measure.name} because the question didn't name a number column.`);
    } else plan.agg = "count";
  }
  if (plan.agg === "sum" && plan.measure && !has(/\b(total|sum)\b/) && (plan.measure.type === "percentage" || ["rating", "score", "age", "price"].includes(plan.measure.semantic))) {
    plan.agg = "avg";
    plan.assumed.push(`Averaged ${plan.measure.name}, because adding up ${plan.measure.type === "percentage" ? "percentages" : plan.measure.semantic + "s"} isn't meaningful.`);
  }
  if (plan.agg === "count" && plan.measure && !countWords) plan.agg = "sum";

  // What we understood
  const AGG_TEXT: Record<AskAgg, string> = { sum: "Total", avg: "Average", count: "Count of records", countDistinct: "Count of different", min: "Lowest", max: "Highest", median: "Median" };
  plan.understood.push({
    label: "Calculation",
    value: plan.agg === "countDistinct" ? `${AGG_TEXT.countDistinct} ${plan.distinctOf!.name}` : plan.agg === "count" ? AGG_TEXT.count : `${AGG_TEXT[plan.agg]} ${plan.measure?.name ?? ""}`.trim(),
  });
  if (plan.groupBy) plan.understood.push({ label: "Grouped by", value: plan.groupBy.name });
  if (plan.bucket) plan.understood.push({ label: "Over time", value: { day: "by day", week: "by week", month: "by month", quarter: "by quarter", year: "by year" }[plan.bucket] });
  if (plan.top) plan.understood.push({ label: plan.top.dir === "desc" ? "Top" : "Bottom", value: String(plan.top.n) });
  for (const f of plan.filters) plan.understood.push({ label: f.column.name, value: f.values.join(" or ") });
  if (plan.dates && time) plan.understood.push({ label: "Period", value: `${plan.dates.label} (${time.name})` });
  if (plan.bucket && !time) plan.assumed.push("There's no date column, so a trend can't be shown.");
  return plan;
}

export function answerQuestion(question: string, table: Table, profiles: Record<string, ColumnProfile>, rows: number[], defaults: { measure?: ColumnSchema; timeKey?: string }): AskAnswer {
  const plan = planQuestion(question, table, profiles, defaults);
  const timeKey = defaults.timeKey;
  const matched = plan.understood.length > 1 || plan.measure || plan.distinctOf || plan.groupBy || plan.filters.length || plan.dates || plan.bucket;
  if (!matched || !norm(question)) {
    return {
      ok: false,
      plan,
      headline: "I couldn't match that question to your columns.",
      detail: `Try naming a column, for example: ${table.schema
        .filter((c) => !c.excluded)
        .slice(0, 4)
        .map((c) => c.name)
        .join(", ")}.`,
      rowsUsed: 0,
    };
  }

  // Apply filters and dates
  let r = rows;
  for (const f of plan.filters) {
    const set = new Set(f.values.map((v) => v.toLowerCase()));
    const col = table.str[f.column.key];
    r = r.filter((i) => col[i] !== null && set.has(col[i]!.toLowerCase()));
  }
  if (plan.dates && timeKey) {
    const t = table.num[timeKey];
    r = r.filter((i) => t[i] !== null && t[i]! >= plan.dates!.from && t[i]! < plan.dates!.to);
  }
  const context = [...plan.filters.map((f) => `${f.values.join(" or ")}`), plan.dates && timeKey ? plan.dates.label : null].filter(Boolean).join(", ");
  const ctx = context ? ` for ${context}` : "";
  const m = plan.measure;
  const fmt = (v: number) => (plan.agg === "count" || plan.agg === "countDistinct" || !m ? fmtNumber(v, 0) : fmtValue(v, m));
  const plural = (s: string) => (/s$/i.test(s) ? s : /y$/i.test(s) ? s.slice(0, -1) + "ies" : s + "s");
  const what =
    plan.agg === "countDistinct"
      ? `Number of ${plural(plan.distinctOf!.name.toLowerCase())}`
      : plan.agg === "count"
        ? "Records"
        : `${{ sum: "Total", avg: "Average", min: "Lowest", max: "Highest", median: "Median" }[plan.agg as "sum"]} ${m!.name}`;

  if (!r.length) return { ok: true, plan, headline: `No records match${ctx}.`, detail: "Try removing a filter or choosing another period.", rowsUsed: 0 };

  const distinctCount = (rs: number[]) => {
    const s = new Set<string>();
    const col = table.str[plan.distinctOf!.key];
    for (const i of rs) if (col[i] !== null) s.add(col[i]!.toLowerCase());
    return s.size;
  };
  const value = (rs: number[]) => (plan.agg === "count" ? rs.length : plan.agg === "countDistinct" ? distinctCount(rs) : aggregate(numericValues(table, m!.key, rs), plan.agg));

  // Over time
  if (plan.bucket && timeKey) {
    let points: { label: string; value: number }[];
    if (plan.agg === "countDistinct") {
      const s = timeSeries(table, r, timeKey, undefined, "count", plan.bucket);
      const t = table.num[timeKey];
      points = s.points.map((p, k) => {
        const end = s.points[k + 1]?.start ?? Infinity;
        return { label: p.label, value: distinctCount(r.filter((i) => t[i] !== null && t[i]! >= p.start && t[i]! < end)) };
      });
    } else {
      const s = timeSeries(table, r, timeKey, plan.agg === "count" ? undefined : m!.key, plan.agg === "count" ? "count" : plan.agg, plan.bucket);
      points = s.points.map((p) => ({ label: p.label, value: p.value ?? 0 }));
    }
    if (points.length === 0) return { ok: true, plan, headline: `No dated records${ctx}.`, rowsUsed: r.length };
    const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
    const low = points.reduce((a, b) => (b.value < a.value ? b : a));
    const first = points[0];
    const last = points[points.length - 1];
    const change = first.value ? ((last.value - first.value) / Math.abs(first.value)) * 100 : null;
    return {
      ok: true,
      plan,
      headline: `${what}${ctx} peaked in ${peak.label} at ${fmt(peak.value)}.`,
      detail: `Lowest in ${low.label} (${fmt(low.value)}). From ${first.label} to ${last.label} it went from ${fmt(first.value)} to ${fmt(last.value)}${change !== null ? ` (${change >= 0 ? "+" : ""}${fmtPercent(change)})` : ""}.`,
      rowsUsed: r.length,
      table: { headers: ["Period", what], rows: points.map((p) => [p.label, fmt(p.value)]) },
      chart: { kind: "line", points, format: fmt },
    };
  }

  // Grouped
  if (plan.groupBy) {
    let groups: { key: string; value: number }[];
    if (plan.agg === "countDistinct") {
      const by = new Map<string, number[]>();
      const col = table.str[plan.groupBy.key];
      for (const i of r) {
        const k = col[i] ?? "(blank)";
        let a = by.get(k);
        if (!a) by.set(k, (a = []));
        a.push(i);
      }
      groups = [...by].map(([key, rs]) => ({ key, value: distinctCount(rs) })).sort((a, b) => b.value - a.value);
    } else groups = groupBy(table, r, plan.groupBy.key, plan.agg === "count" ? undefined : m!.key, plan.agg === "count" ? "count" : plan.agg);
    if (!groups.length) return { ok: true, plan, headline: `No values${ctx}.`, rowsUsed: r.length };
    const additive = plan.agg === "sum" || plan.agg === "count";
    const total = groups.reduce((a, g) => a + g.value, 0);
    let shown = plan.top?.dir === "asc" ? [...groups].sort((a, b) => a.value - b.value) : groups;
    if (plan.top) shown = shown.slice(0, plan.top.n);
    else shown = shown.slice(0, 25);
    const lead = shown[0];
    const g = plan.groupBy.name;
    const headline =
      plan.top?.n === 1
        ? `${lead.key} has the ${plan.top.dir === "desc" ? "highest" : "lowest"} ${what.toLowerCase().startsWith("total") || plan.agg === "count" ? what.replace(/^Total /, "") : what}${ctx}: ${fmt(lead.value)}${additive && total ? ` (${fmtPercent((lead.value / total) * 100)} of the total)` : ""}.`
        : plan.top
          ? `${plan.top.dir === "desc" ? "Top" : "Bottom"} ${shown.length} ${g} by ${what}${ctx}.`
          : `${what} by ${g}${ctx}: ${lead.key} leads with ${fmt(lead.value)}${additive && total ? ` (${fmtPercent((lead.value / total) * 100)})` : ""}.`;
    const showShare = additive && total > 0;
    return {
      ok: true,
      plan,
      headline,
      detail: `${groups.length} ${g} value${groups.length === 1 ? "" : "s"} in total${additive ? `, adding up to ${fmt(total)}` : ""}.`,
      rowsUsed: r.length,
      table: { headers: [g, what, ...(showShare ? ["Share"] : [])], rows: shown.map((x) => [x.key, fmt(x.value), ...(showShare ? [fmtPercent((x.value / total) * 100)] : [])]) },
      chart: shown.length > 1 ? { kind: "bar", points: shown.map((x) => ({ label: x.key, value: x.value })), format: fmt } : undefined,
    };
  }

  // Single number
  const v = value(r);
  if (v === null) return { ok: true, plan, headline: `${what}${ctx}: no numbers to calculate from.`, rowsUsed: r.length };
  let detail = `Calculated from ${fmtNumber(r.length, 0)} record${r.length === 1 ? "" : "s"}${r.length !== rows.length ? ` out of ${fmtNumber(rows.length, 0)}` : ""}.`;
  if (m && (plan.agg === "max" || plan.agg === "min")) {
    const col = table.num[m.key];
    const at = r.find((i) => col[i] === v);
    const label = table.schema.find((c) => c.role === "identifier" || c.semantic === "person" || c.semantic === "customer" || c.semantic === "product");
    if (at !== undefined && label)
      detail += ` It belongs to ${label.name} ${table.str[label.key][at] ?? "(blank)"}${timeKey && table.num[timeKey][at] !== null ? ` on ${fmtDay(table.num[timeKey][at]!)}` : ""}.`;
  }
  const headline =
    plan.agg === "countDistinct"
      ? `There are ${fmt(v)} different ${plural(plan.distinctOf!.name.toLowerCase())}${ctx}.`
      : plan.agg === "count"
        ? `There are ${fmt(v)} records${ctx}.`
        : `${what}${ctx} is ${fmt(v)}.`;
  return { ok: true, plan, headline, detail, rowsUsed: r.length };
}

/** Example questions built from the dataset's own columns and values. */
export function suggestQuestions(table: Table, profiles: Record<string, ColumnProfile>, measure?: ColumnSchema, timeKey?: string): string[] {
  const visible = table.schema.filter((c) => !c.excluded);
  const dims = visible
    .filter((c) => c.role === "dimension" && (profiles[c.key]?.distinct ?? 0) >= 2 && (profiles[c.key]?.distinct ?? 0) <= 50)
    .sort((a, b) => (profiles[a.key]?.distinct ?? 0) - (profiles[b.key]?.distinct ?? 0));
  const ids = visible.filter((c) => ["customer", "product", "person", "employee_id", "student_id"].includes(c.semantic));
  const mName = measure ? measure.name.replace(/\s*\(.*?\)/g, "").toLowerCase() : null;
  const pl = (c: ColumnSchema) => {
    const s = c.name.replace(/\s*\(.*?\)/g, "").toLowerCase();
    return /s$/.test(s) ? s : /y$/.test(s) ? s.slice(0, -1) + "ies" : s + "s";
  };
  const out: string[] = [];
  if (mName && dims[0]) out.push(`Total ${mName} by ${dims[0].name.toLowerCase()}`);
  if (mName && timeKey) out.push(`Monthly trend of ${mName}`);
  const big = dims.find((d) => (profiles[d.key]?.distinct ?? 0) > 5) ?? dims[1];
  if (mName && big) out.push(`Top 5 ${pl(big)} by ${mName}`);
  if (mName && dims[0] && profiles[dims[0].key]?.top[0]) out.push(`Average ${mName} in ${profiles[dims[0].key]!.top[0].value}`);
  if (ids[0]) out.push(`How many ${pl(ids[0])}${dims[0] && dims[0].key !== ids[0].key ? ` by ${dims[0].name.toLowerCase()}` : ""}?`);
  if (mName && dims[1]) out.push(`Which ${dims[1].name.toLowerCase()} has the highest ${mName}?`);
  if (!mName && dims[0]) out.push(`How many records by ${dims[0].name.toLowerCase()}?`);
  return [...new Set(out)].slice(0, 6);
}
