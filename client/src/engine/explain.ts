/**
 * Plain-language explanations of how each column was read, so the user can check
 * the suggestion quickly: what it is, how it will be used, and why we think so.
 */
import type { ColumnProfile, ColumnSchema, Role, Semantic } from "./types";
import { fmtNumber, fmtPercent } from "./format";

export const SEMANTIC_LABEL: Record<Semantic, string> = {
  none: "No specific meaning",
  revenue: "Revenue / sales amount",
  cost: "Cost / expense",
  profit: "Profit / margin",
  price: "Unit price",
  quantity: "Quantity / units",
  salary: "Salary / pay",
  score: "Score / marks",
  rating: "Rating",
  age: "Age",
  duration: "Duration",
  person: "Person's name",
  employee_id: "Employee ID",
  student_id: "Student / roll number",
  order_id: "Order / invoice number",
  customer: "Customer",
  product: "Product",
  category: "Category",
  region: "Region / location",
  department: "Department / team",
  status: "Status",
  gender: "Gender",
  subject: "Subject",
  result: "Result (pass/fail)",
  payment: "Payment mode",
  date: "Date",
};

export const ROLE_LABEL: Record<Role, string> = {
  measure: "Add up / average",
  dimension: "Group and filter by",
  time: "Track over time",
  identifier: "Count only (an ID)",
  ignore: "Don't use in charts",
};

export const ROLE_HINT: Record<Role, string> = {
  measure: "Totals and averages in KPIs and charts",
  dimension: "Splits charts and tables into groups, and appears as a filter",
  time: "Monthly and yearly trends, year selection",
  identifier: "Counted as distinct values, never added up",
  ignore: "Kept in the data, left out of charts",
};

/** Why the column was read the way it was. Short facts, newest-first priority. */
export function explainColumn(c: ColumnSchema, p?: ColumnProfile): string[] {
  const out: string[] = [];
  const share = p && p.count ? Math.round(c.confidence * 100) : null;
  switch (c.type) {
    case "currency":
      out.push(c.currencySymbol ? `Amounts in ${c.currencySymbol === "₹" || /rs|inr/i.test(c.currencySymbol) ? "₹" : c.currencySymbol}` : "Header suggests money");
      break;
    case "date":
      out.push(`${share ?? "—"}% of values are dates${c.dateOrder === "dmy" ? " (day/month/year)" : c.dateOrder === "mdy" ? " (month/day/year)" : ""}`);
      if (p?.dateRange) out.push(`From ${p.dateRange.min} to ${p.dateRange.max}`);
      break;
    case "percentage":
      out.push(c.percentScale === "fraction" ? "Fractions such as 0.25 read as 25%" : "Values are percentages");
      break;
    case "number":
      if (p?.numeric) out.push(`Numbers from ${fmtNumber(p.numeric.min)} to ${fmtNumber(p.numeric.max)}`);
      break;
    case "identifier":
      out.push(c.notes.find((n) => n.startsWith("Consecutive")) ? "Runs 1, 2, 3 … — a row number" : p && p.uniqueRatio > 0.9 ? "Almost every value is different" : "Looks like a code or ID");
      break;
    case "category":
      if (p)
        out.push(
          `${fmtNumber(p.distinct)} repeating values, e.g. ${p.top
            .slice(0, 3)
            .map((t) => t.value)
            .join(", ")}`,
        );
      break;
    case "boolean":
      out.push("Two values such as Yes / No");
      break;
    case "text":
      out.push(p ? `${fmtNumber(p.distinct)} different free-text values` : "Free text");
      break;
  }
  if (c.semantic !== "none" && c.semantic !== "date") out.push(`Header “${c.originalName}” reads as ${SEMANTIC_LABEL[c.semantic].toLowerCase()}`);
  if (p && p.missingPct > 0) out.push(`${fmtPercent(p.missingPct)} empty`);
  for (const n of c.notes) if (!out.some((o) => o.startsWith(n.slice(0, 12))) && !n.startsWith("Consecutive")) out.push(n);
  return out.slice(0, 4);
}

/** How sure we are about the column's type: share of values matching it, lowered by open questions. */
export function certainty(c: ColumnSchema): "high" | "medium" | "low" {
  if (c.ambiguity && !c.ambiguity.resolved) return "low";
  if (c.confidence >= 0.95) return "high";
  if (c.confidence >= 0.8) return "medium";
  return "low";
}
