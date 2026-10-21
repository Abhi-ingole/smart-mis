/**
 * Minimal Groq client (OpenAI-compatible chat completions) with
 * a model fallback list, timeouts and one retry on rate limits.
 * The API key never leaves the server.
 */
import { config } from "./config";

export type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export interface ChatOptions {
  models?: string[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class AiUnavailableError extends Error {}

async function callOnce(model: string, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.groq.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_completion_tokens: opts.maxTokens ?? 800,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Groq ${res.status} for ${model}: ${body.slice(0, 200)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error(`Empty response from ${model}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try each model in order; returns the first successful completion. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<{ text: string; model: string }> {
  if (!config.groq.apiKey) throw new AiUnavailableError("AI is not configured (GROQ_API_KEY is empty).");
  const models = opts.models ?? config.groq.textModels;
  const errors: string[] = [];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { text: await callOnce(model, messages, opts), model };
      } catch (e) {
        const err = e as Error & { status?: number };
        errors.push(err.message);
        if (err.status === 429 && attempt === 0) {
          await sleep(1500);
          continue; // retry same model once on rate limit
        }
        // JSON mode unsupported by this model → retry once without it
        if (opts.json && err.status === 400 && /response_format|json/i.test(err.message) && attempt === 0) {
          opts = { ...opts, json: false };
          continue;
        }
        break; // move on to the next model
      }
    }
  }
  throw new AiUnavailableError(`All AI models failed: ${errors.map((m) => m.slice(0, 120)).join(" | ")}`);
}

/** Pull the first JSON object out of a model reply (handles ```json fences). */
export function parseJsonReply<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
