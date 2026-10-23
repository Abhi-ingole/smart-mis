/**
 * Schema inference: decides each column's type, role and business meaning
 * deterministically. When the data genuinely can't tell (03/04/2024, a "Total"
 * column without currency signs…) it records a question for the user instead of guessing silently.
 */
import type { Ambiguity, Cell, ColType, ColumnSchema, DateOrder, Role, Semantic } from "./types";
import { cellText, excelSerialToDay, parseBoolean, parseDate, parseNumber, slashParts } from "./values";

const HINT = {
  moneyStrong: /(amount|revenue|sales(?!\s*(rep|person|man|executive|channel|region|team))|price|cost|salary|income|expense|spend|budget|profit|fee|mrp|ctc|wage|payment|paid|invoice|turnover|gmv|₹|\binr\b|\busd\b|\brs\b|value\s*\(|\(₹|\(rs|\(inr)/i,
  moneyWeak: /(total|value|rate|charges?|balance|price)/i,
  pct: /(%|percent|pct|ratio|share|margin|growth|attendance|completion|conversion)/i,
  date: /(date|time|day|month|year|period|dob|joined|joining|created|updated|timestamp|week|when)/i,
  id: /(^s[rl]\.?\s*(no\.?)?$|^s\.?\s*no\.?$|serial|\bid\b|_id\b|\bid$|^id|code$|\bno\.?$|number$|^#|\bkey$|sku|roll\s*no|emp\s*id|ref(erence)?\b|invoice\s*no|order\s*no|uuid)/i,
  year: /^(year|yr|fy|fiscal\s*year)$/i,
};

const SEMANTIC_RULES: [Semantic, RegExp][] = [
  ["profit", /profit|margin\s*amount|earnings|net\s*income/i],
  ["revenue", /revenue|sales\s*(amount|value)?|^sales$|turnover|gmv|income|(invoice|order|bill(ing)?|sale)\s*(amount|value)/i],
  ["cost", /cost|expense|spend|expenditure|purchase\s*value/i],
  ["salary", /salary|ctc|wage|pay\b|compensation|stipend/i],
  ["price", /price|mrp|rate\b|unit\s*cost/i],
  ["quantity", /qty|quantity|units|volume|count\b|pieces|items\s*sold/i],
  ["score", /marks?|score|grade\s*points?|gpa|cgpa|percentage|total\s*marks|obtained/i],
  ["rating", /rating|stars|satisfaction|nps|feedback\s*score/i],
  ["age", /^age$|\bage\b/i],
  ["duration", /duration|hours|minutes|days\s*taken|tenure|experience/i],
  ["employee_id", /emp(loyee)?\s*(id|code|no)|staff\s*id/i],
  ["student_id", /(student|roll|enrol?ment|admission)\s*(id|no|number)?/i],
  ["order_id", /(order|invoice|transaction|txn|bill)\s*(id|no|number)/i],
  ["person", /(employee|student|customer|client|candidate|agent|rep|salesperson|staff|teacher)?\s*name$|^name$/i],
  ["customer", /customer|client|buyer|account/i],
  ["product", /product|item|sku|model|service/i],
  ["category", /category|segment|type|class(ification)?|group|channel|source/i],
  ["region", /region|zone|state|city|country|territory|branch|location|area|district/i],
  ["department", /department|dept|division|team|function|designation|role|grade\b|level/i],
  ["subject", /subject|course|paper|module/i],
  ["result", /result|pass\s*\/?\s*fail|outcome/i],
  ["status", /status|stage|state$|attrition|active|left|resigned/i],
  ["payment", /payment\s*(mode|method|type)|paid\s*via/i],
  ["gender", /gender|sex/i],
];

export function semanticFor(name: string, type: ColType): Semantic {
  for (const [sem, re] of SEMANTIC_RULES) {
    if (!re.test(name)) continue;
    const numericSem = ["profit", "revenue", "cost", "salary", "price", "quantity", "score", "rating", "age", "duration"].includes(sem);
    const isNumeric = type === "number" || type === "currency" || type === "percentage";
    if (numericSem && !isNumeric) continue;
    if (!numericSem && isNumeric && !["employee_id", "student_id", "order_id"].includes(sem)) continue;
    return sem;
  }
  if (type === "date") return "date";
  return "none";
}

function symbolFromHeader(name: string): string | undefined {
  if (/₹|\brs\.?\b|\binr\b|rupee/i.test(name)) return "₹";
  if (/\$|\busd\b|dollar/i.test(name)) return "$";
  if (/€|\beur\b/i.test(name)) return "€";
  if (/£|\bgbp\b/i.test(name)) return "£";
  return undefined;
}

function sampleOf<T>(values: T[], max = 5000): T[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  return Array.from({ length: max }, (_, i) => values[Math.floor(i * step)]);
}

function decideDateOrder(values: Cell[]): { order: DateOrder; ambiguous: boolean } {
  let firstOver12 = 0;
  let secondOver12 = 0;
  let slashes = 0;
  for (const v of values) {
    const p = slashParts(v);
    if (!p) continue;
    slashes++;
    if (p[0] > 12) firstOver12++;
    if (p[1] > 12) secondOver12++;
  }
  if (slashes === 0) return { order: "dmy", ambiguous: false };
  if (firstOver12 > 0 && secondOver12 === 0) return { order: "dmy", ambiguous: false };
  if (secondOver12 > 0 && firstOver12 === 0) return { order: "mdy", ambiguous: false };
  return { order: "dmy", ambiguous: true };
}

export function inferColumn(index: number, name: string, column: Cell[]): ColumnSchema {
  const nonEmpty = column.filter((c) => c !== null && !(typeof c === "string" && c.trim() === ""));
  const sample = sampleOf(nonEmpty);
  const n = sample.length;
  const notes: string[] = [];
  const base = { key: `c${index}`, index, originalName: name, name, excluded: false, notes };

  if (n === 0) {
    notes.push("This column is empty.");
    return { ...base, type: "text", detectedType: "text", role: "ignore", semantic: "none", confidence: 1 };
  }

  let numeric = 0;
  let withCurrency = 0;
  let withPercent = 0;
  let integers = 0;
  let strings = 0;
  let bools = 0;
  let dates = 0;
  const { order, ambiguous: orderAmbiguous } = decideDateOrder(sample);
  let maxAbs = 0;
  let minVal = Infinity;
  for (const v of sample) {
    if (typeof v === "string") strings++;
    if (parseBoolean(v) !== null) bools++;
    const num = parseNumber(v);
    if (num) {
      numeric++;
      if (num.currency) withCurrency++;
      if (num.percent) withPercent++;
      if (Number.isInteger(num.value)) integers++;
      maxAbs = Math.max(maxAbs, Math.abs(num.value));
      minVal = Math.min(minVal, num.value);
      continue;
    }
    if (parseDate(v, order) !== null) dates++;
  }
  const distinctAll = new Set(sample.map((v) => cellText(v)?.toLowerCase())).size;
  const uniqueRatio = distinctAll / n;
  const share = (k: number) => k / n;

  let type: ColType;
  let confidence: number;
  let role: Role;
  let ambiguity: Ambiguity | undefined;
  let dateOrder: DateOrder | undefined;
  let percentScale: ColumnSchema["percentScale"];
  let currencySymbol: string | undefined;

  const allNumbers = sample.every((v) => typeof v === "number");
  const looksExcelSerial = allNumbers && HINT.date.test(name) && !HINT.year.test(name) && minVal > 20000 && maxAbs < 80000;

  if (looksExcelSerial) {
    type = "date";
    confidence = 1;
    notes.push("Excel date serial numbers converted to dates.");
  } else if (share(dates) >= 0.6 && share(dates) >= share(numeric)) {
    type = "date";
    confidence = share(dates);
    dateOrder = order;
    if (orderAmbiguous) {
      ambiguity = {
        kind: "date-order",
        question: `Dates in "${name}" could be day/month or month/day (e.g. ${cellText(sample.find((v) => slashParts(v)) ?? null)}). Which is it?`,
        options: [
          { value: "dmy", label: "Day/Month/Year (15/03/2024)" },
          { value: "mdy", label: "Month/Day/Year (03/15/2024)" },
        ],
        current: "dmy",
        resolved: false,
      };
    }
  } else if (share(bools) >= 0.95 && distinctAll <= 2) {
    type = "boolean";
    confidence = share(bools);
  } else if (share(numeric) >= 0.6) {
    confidence = share(numeric);
    if (HINT.year.test(name) && integers === numeric && minVal >= 1900 && maxAbs <= 2200) {
      type = "category";
      notes.push("Treated as a year (category), not a number to add up.");
    } else if (withPercent / Math.max(1, numeric) >= 0.5) {
      type = "percentage";
      percentScale = "whole";
    } else if (withCurrency / Math.max(1, numeric) >= 0.5) {
      type = "currency";
      currencySymbol = (() => {
        const s = sample.find((v) => typeof v === "string" && parseNumber(v)?.currency);
        return s ? (parseNumber(s)!.currency ?? undefined) : undefined;
      })() ?? symbolFromHeader(name);
    } else if (HINT.id.test(name) && integers === numeric && uniqueRatio > 0.9) {
      type = "identifier";
    } else if (HINT.pct.test(name) && minVal >= 0 && maxAbs <= 100 && !HINT.moneyStrong.test(name)) {
      type = "percentage";
      percentScale = maxAbs <= 1 ? "fraction" : "whole";
      if (maxAbs <= 1) notes.push("Values between 0 and 1 are shown as percentages (× 100).");
      ambiguity = {
        kind: "percent-scale",
        question: `Is "${name}" a percentage? Values range from ${+minVal.toFixed(4)} to ${+maxAbs.toFixed(4)}.`,
        options: [
          { value: percentScale, label: percentScale === "fraction" ? "Yes — 0.25 means 25%" : "Yes — 25 means 25%" },
          { value: "number", label: "No — it's a plain number" },
        ],
        current: percentScale,
        resolved: false,
      };
    } else if (HINT.moneyStrong.test(name)) {
      type = "currency";
      currencySymbol = symbolFromHeader(name);
    } else {
      type = "number";
      if (HINT.moneyWeak.test(name) && !HINT.pct.test(name)) {
        ambiguity = {
          kind: "money",
          question: `Is "${name}" a money amount?`,
          options: [
            { value: "currency", label: "Yes, it's money" },
            { value: "number", label: "No, it's a plain number" },
          ],
          current: "number",
          resolved: false,
        };
      } else if (integers === numeric && uniqueRatio === 1 && n >= 20 && !HINT.moneyStrong.test(name)) {
        const sorted = sample.map((v) => parseNumber(v)?.value).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
        const sequential = sorted.every((v, i) => i === 0 || v - sorted[i - 1] === 1);
        if (sequential) {
          type = "identifier";
          notes.push("Consecutive unique whole numbers — treated as a row ID.");
        } else {
          ambiguity = {
            kind: "id-or-measure",
            question: `Every value in "${name}" is a different whole number. Is it an ID/code, or a quantity to add up?`,
            options: [
              { value: "identifier", label: "An ID or code" },
              { value: "number", label: "A quantity / measure" },
            ],
            current: "number",
            resolved: false,
          };
        }
      }
    }
  } else if (HINT.id.test(name) && uniqueRatio >= 0.9) {
    type = "identifier";
    confidence = 1;
  } else {
    const avgLen = sample.reduce<number>((a, v) => a + (cellText(v)?.length ?? 0), 0) / n;
    if (distinctAll <= Math.max(25, n * 0.05) || uniqueRatio < 0.5) type = "category";
    else if (avgLen > 40) type = "text";
    else type = "text";
    confidence = 1;
  }

  // Mixed columns: dominant type but a real share of non-matching values.
  if ((type === "number" || type === "currency" || type === "percentage" || type === "date") && confidence < 0.9) {
    const bad = Math.round((1 - confidence) * nonEmpty.length);
    ambiguity = {
      kind: "mixed-type",
      question: `"${name}" is mostly ${type === "date" ? "dates" : "numbers"} (${Math.round(confidence * 100)}%), but about ${bad.toLocaleString("en-IN")} values aren't. Treat it as ${type === "date" ? "a date" : "a number"} (other values become empty) or as text?`,
      options: [
        { value: type, label: type === "date" ? "Date" : "Number" },
        { value: "category", label: "Text / category" },
      ],
      current: type,
      resolved: false,
    };
  }

  if (type === "date") role = "time";
  else if (type === "identifier") role = "identifier";
  else if (type === "number" || type === "currency" || type === "percentage") role = "measure";
  else if (type === "category" || type === "boolean") role = "dimension";
  else role = distinctAll <= 1000 ? "dimension" : "ignore";

  const semantic = semanticFor(name, type);
  if (semantic === "person" && type === "category") type = "text"; // names repeat rarely; keep as text
  if (distinctAll === 1 && nonEmpty.length > 1) notes.push("Every row has the same value.");

  return { ...base, type, detectedType: type, role, semantic, confidence: Math.round(confidence * 100) / 100, dateOrder, percentScale, currencySymbol, ambiguity };
}

export function inferSchema(headers: string[], rows: Cell[][]): ColumnSchema[] {
  return headers.map((h, i) => inferColumn(i, h, rows.map((r) => r[i] ?? null)));
}

/** Applies a user's answer to an ambiguity question. */
export function resolveAmbiguity(col: ColumnSchema, answer: string): ColumnSchema {
  const a = col.ambiguity;
  if (!a) return col;
  const next: ColumnSchema = { ...col, ambiguity: { ...a, current: answer, resolved: true } };
  switch (a.kind) {
    case "date-order":
      next.dateOrder = answer as DateOrder;
      break;
    case "money":
      next.type = answer as ColType;
      if (answer === "currency") next.currencySymbol ??= symbolFromHeader(col.name);
      break;
    case "id-or-measure":
    case "mixed-type":
      next.type = answer as ColType;
      break;
    case "percent-scale":
      if (answer === "number") next.type = "number";
      else {
        next.type = "percentage";
        next.percentScale = answer as "fraction" | "whole";
      }
      break;
  }
  next.role = roleForType(next.type, col.role);
  next.semantic = semanticFor(next.name, next.type);
  return next;
}

export function roleForType(type: ColType, previous: Role): Role {
  if (type === "date") return "time";
  if (type === "identifier") return "identifier";
  if (type === "number" || type === "currency" || type === "percentage") return "measure";
  if (previous === "ignore" && type === "text") return "ignore";
  return "dimension";
}

/** Converts a cell to the column's number representation (dates → epoch day, % → 0–100). */
export function toNumber(cell: Cell, col: ColumnSchema): number | null {
  if (col.type === "date") {
    if (typeof cell === "number") return col.notes.some((n) => n.startsWith("Excel date")) ? excelSerialToDay(cell) : null;
    return parseDate(cell, col.dateOrder ?? "dmy");
  }
  if (col.type === "boolean") {
    const b = parseBoolean(cell);
    return b === null ? null : b ? 1 : 0;
  }
  const p = parseNumber(cell);
  if (!p) return null;
  if (col.type === "percentage" && col.percentScale === "fraction" && !p.percent) return p.value * 100;
  return p.value;
}
