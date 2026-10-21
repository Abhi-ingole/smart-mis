/**
 * AI summary for the daily report.
 * The AI only writes words around numbers we give it. Afterwards every number in
 * the text is checked against those facts; on a mismatch we regenerate once and
 * then fall back to a fixed template.
 */
import { chat } from "../lib/groq";
import { isAiEnabled } from "../lib/config";
import { fmtInt, fmtPct, type KpiChange, type KpiKey, type Kpis } from "../lib/kpi";
import { prettyDate } from "../lib/dates";

export interface SummaryInput {
  companyName: string;
  date: string;
  kpis: Kpis;
  changes: Record<KpiKey, KpiChange>;
  previousLabel: string;
  monthToDate?: { label: string; actual: number; target: number; progressPct: number; isRate: boolean }[];
}

export interface SummaryResult {
  text: string;
  source: "ai" | "template";
  model?: string;
  attempts: number;
}

/** The facts object is the ONLY source of numbers the AI may use. */
export function buildFacts(input: SummaryInput) {
  const { kpis, changes } = input;
  const mtd = (input.monthToDate ?? [])
    .filter((m) => m.target > 0)
    .map((m) => ({
      metric: m.label,
      actual: m.isRate ? fmtPct(m.actual) : fmtInt(m.actual),
      target: m.isRate ? fmtPct(m.target) : fmtInt(m.target),
      progress: `${m.progressPct}%`,
    }));
  return {
    date: prettyDate(input.date),
    whatsapp: {
      sent: fmtInt(kpis.waSent),
      delivered: fmtInt(kpis.waDelivered),
      delivery_rate: fmtPct(kpis.deliveryPct),
      sent_change: changes.waSent.words,
      delivered_change: changes.waDelivered.words,
      delivery_rate_change: changes.deliveryPct.words,
    },
    email: {
      sent: fmtInt(kpis.emailSent),
      opened: fmtInt(kpis.emailOpened),
      open_rate: fmtPct(kpis.openPct),
      sent_change: changes.emailSent.words,
      opened_change: changes.emailOpened.words,
      open_rate_change: changes.openPct.words,
    },
    ...(mtd.length ? { month_to_date_vs_target: mtd } : {}),
  };
}

/** Numbers as canonical strings: commas removed, trailing ".0" dropped. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => {
    const s = n.replace(/,/g, "");
    return s.includes(".") ? String(Number(s)) : String(Number(s));
  });
}

/** Every number in `summary` must appear in the facts. */
export function summaryNumbersValid(summary: string, facts: unknown): { ok: boolean; unknown: string[] } {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  const bad = numbersIn(summary).filter((n) => !allowed.has(n));
  return { ok: bad.length === 0, unknown: [...new Set(bad)] };
}

export function templateSummary(input: SummaryInput): string {
  const { kpis, changes } = input;
  if (kpis.entries === 0) return `No campaign data was recorded for ${prettyDate(input.date)}.`;
  const lines: string[] = [];
  lines.push(`WhatsApp: ${fmtInt(kpis.waSent)} messages sent and ${fmtInt(kpis.waDelivered)} delivered (${fmtPct(kpis.deliveryPct)} delivery); sent volume ${lower(changes.waSent.words)}.`);
  lines.push(`Email: ${fmtInt(kpis.emailSent)} sent and ${fmtInt(kpis.emailOpened)} opened (${fmtPct(kpis.openPct)} open rate); opens ${lower(changes.emailOpened.words)}.`);
  const behind = (input.monthToDate ?? []).filter((m) => m.target > 0 && !m.isRate).sort((a, b) => a.progressPct - b.progressPct)[0];
  if (behind) lines.push(`Month to date, ${behind.label.toLowerCase()} is at ${behind.progressPct}% of target.`);
  return lines.join(" ");
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export async function generateSummary(input: SummaryInput): Promise<SummaryResult> {
  if (input.kpis.entries === 0 || !isAiEnabled()) {
    return { text: templateSummary(input), source: "template", attempts: 0 };
  }
  const facts = buildFacts(input);
  let attempts = 0;
  let feedback = "";
  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const { text, model } = await chat(
        [
          {
            role: "system",
            content:
              "You write a short daily MIS summary for a manager. Write 3 to 4 plain sentences (no bullet points, no headings, no emojis). Use ONLY numbers that appear in the FACTS, copied exactly as written there (same commas, decimals and % signs). Do not calculate new numbers, do not round, do not use words like 'lakh' or 'k'. Mention the most important movement and one point of attention.",
          },
          { role: "user", content: `Company: ${input.companyName}\nFACTS:\n${JSON.stringify(facts, null, 2)}${feedback}` },
        ],
        { temperature: 0.3, maxTokens: 400, timeoutMs: 20_000 },
      );
      const cleaned = text.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
      const check = summaryNumbersValid(cleaned, facts);
      if (check.ok && cleaned.length > 20) return { text: cleaned, source: "ai", model, attempts };
      feedback = `\n\nYour previous answer used numbers not in FACTS (${check.unknown.join(", ")}). Use only the numbers in FACTS.`;
    } catch {
      break; // AI unavailable → template
    }
  }
  return { text: templateSummary(input), source: "template", attempts };
}
