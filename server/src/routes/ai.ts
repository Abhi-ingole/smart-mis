/**
 * Optional AI insights. The browser sends ONLY computed summary statistics
 * (never raw rows), and only after the user has explicitly agreed.
 * The API key stays on the server. Every number in the AI's answer is checked
 * against the facts; ungrounded answers are retried once, then rejected.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config, isAiAvailable } from "../lib/config";
import { AiUnavailableError, chat, parseJsonReply } from "../lib/groq";
import { ungroundedNumbers } from "../lib/numbers";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errors";

export const aiRouter = Router();

aiRouter.get("/status", validate(), (_req, res) => {
  res.json({ available: isAiAvailable(), provider: isAiAvailable() ? "Groq" : null, models: isAiAvailable() ? config.groq.textModels : [] });
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : config.aiRequestsPerHour,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "AI request limit reached for this hour. Deterministic insights still work." },
});

// The facts object is free-form JSON produced by the browser's analytics engine; we bound its size.
const factsSchema = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 60_000, "Summary is too large");

const bodySchema = z.object({
  datasetName: z.string().trim().min(1).max(200),
  facts: factsSchema,
  consent: z.literal(true, { error: "Consent is required before sending a summary to the AI provider." }),
});

interface AiAnswer {
  summary?: string;
  observations?: string[];
  recommendations?: string[];
}

const SYSTEM = `You are a careful business data analyst. You receive FACTS computed from a user's spreadsheet.
Write in plain business English. Rules:
- Use ONLY numbers that appear in FACTS, copied exactly (same decimals, commas and % signs). Never calculate, round or estimate new numbers.
- Do not invent business context, causes, company names or time periods that are not in FACTS.
- "observations" are factual statements supported by FACTS. "recommendations" are actions, each tied to an observation; if evidence is weak, give fewer.
Return JSON: {"summary": "2-3 sentences", "observations": ["..."], "recommendations": ["..."]} with at most 6 observations and 4 recommendations.`;

aiRouter.post("/insights", limiter, validate({ body: bodySchema }), async (req, res) => {
  if (!isAiAvailable()) throw new HttpError(503, "AI is not configured on this server. Add GROQ_API_KEY to .env to enable it.");
  const { datasetName, facts } = req.valid.body as z.infer<typeof bodySchema>;
  let feedback = "";
  let lastBad: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: { text: string; model: string };
    try {
      reply = await chat(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Dataset: ${datasetName}\nFACTS:\n${JSON.stringify(facts)}${feedback}` },
        ],
        { json: true, temperature: 0.2, maxTokens: 900, timeoutMs: 30_000 },
      );
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new HttpError(502, "The AI provider did not respond. Try again later — deterministic insights still work.");
      throw e;
    }
    const parsed = parseJsonReply<AiAnswer>(reply.text);
    if (!parsed) {
      feedback = "\n\nYour previous reply was not valid JSON. Return only the JSON object.";
      continue;
    }
    const answer = {
      summary: String(parsed.summary ?? "").slice(0, 1200),
      observations: (Array.isArray(parsed.observations) ? parsed.observations : []).map(String).slice(0, 6),
      recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map(String).slice(0, 4),
    };
    const bad = ungroundedNumbers([answer.summary, ...answer.observations, ...answer.recommendations].join("\n"), { datasetName, facts });
    if (bad.length === 0) {
      res.json({ ...answer, model: reply.model, verified: true });
      return;
    }
    lastBad = bad;
    feedback = `\n\nYour previous answer used numbers that are not in FACTS: ${bad.join(", ")}. Use only numbers from FACTS.`;
  }
  throw new HttpError(422, `The AI answer contained numbers that could not be verified (${lastBad.join(", ") || "invalid format"}), so it was discarded.`);
});
