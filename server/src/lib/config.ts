import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// Load .env from the server folder or the project root (whichever exists first).
for (const p of [path.resolve(".env"), path.resolve("..", ".env")]) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, quiet: true });
    break;
  }
}

const env = process.env;

function list(v: string | undefined, fallback: string[]): string[] {
  const items = (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

const nodeEnv = env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  isProd: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: Number(env.PORT ?? 4000),
  /** Origin(s) allowed to call the API from a browser. Comma-separated. */
  appOrigins: list(env.APP_ORIGIN, ["http://localhost:5173"]).map((o) => o.replace(/\/$/, "")),
  groq: {
    apiKey: env.GROQ_API_KEY ?? "",
    textModels: list(env.GROQ_TEXT_MODELS, ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"]),
    baseUrl: env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  /** Set AI_ENABLED=false to switch AI off even when a key is present. */
  aiEnabled: (env.AI_ENABLED ?? "true").toLowerCase() !== "false",
  /** AI requests allowed per IP per hour (protects your free-tier quota). */
  aiRequestsPerHour: Math.max(1, Number(env.AI_REQUESTS_PER_HOUR ?? 30)),
};

export const isAiAvailable = () => config.aiEnabled && Boolean(config.groq.apiKey);
