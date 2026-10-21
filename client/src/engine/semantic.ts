/**
 * Domain detection: only labels a dataset (sales, HR, academic, expenses) when the
 * columns clearly support it. Otherwise it stays "generic" — we never force a domain.
 */
import type { ColumnSchema, DomainGuess, Semantic } from "./types";

interface Rule {
  domain: DomainGuess["domain"];
  label: string;
  required: Semantic[][]; // each inner list: at least one must be present
  supporting: Semantic[];
  minSupporting: number;
}

const RULES: Rule[] = [
  { domain: "sales", label: "Sales", required: [["revenue", "price"]], supporting: ["quantity", "order_id", "customer", "product", "region", "profit", "payment", "date"], minSupporting: 2 },
  { domain: "hr", label: "HR / Workforce", required: [["employee_id", "salary", "department"]], supporting: ["salary", "department", "person", "gender", "age", "status", "duration", "date", "employee_id"], minSupporting: 2 },
  { domain: "academic", label: "Academic performance", required: [["score"]], supporting: ["student_id", "subject", "result", "person", "gender", "category"], minSupporting: 1 },
  { domain: "finance", label: "Expenses", required: [["cost"]], supporting: ["category", "payment", "date", "department", "region"], minSupporting: 1 },
];

export function detectDomain(schema: ColumnSchema[]): DomainGuess {
  const active = schema.filter((c) => !c.excluded);
  const has = (s: Semantic) => active.filter((c) => c.semantic === s);
  let best: DomainGuess = { domain: "generic", label: "General data", confidence: 0, evidence: [] };
  for (const rule of RULES) {
    if (!rule.required.every((group) => group.some((s) => has(s).length > 0))) continue;
    // Expenses only when there is no revenue (otherwise it's sales with a cost column).
    if (rule.domain === "finance" && has("revenue").length) continue;
    const reqCols = rule.required.flatMap((g) => g.flatMap((s) => has(s)));
    const supCols = rule.supporting.flatMap((s) => has(s)).filter((c) => !reqCols.includes(c));
    if (supCols.length < rule.minSupporting) continue;
    const confidence = Math.min(1, (reqCols.length + supCols.length) / (rule.required.length + rule.minSupporting + 2));
    if (confidence > best.confidence) {
      best = {
        domain: rule.domain,
        label: rule.label,
        confidence: Math.round(confidence * 100) / 100,
        evidence: [...new Set([...reqCols, ...supCols].map((c) => c.name))].slice(0, 6),
      };
    }
  }
  return best;
}
