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
  appOrigin: (env.APP_ORIGIN ?? "http://localhost:5173").replace(/\/$/, ""),
  jwtSecret: env.JWT_SECRET ?? "",
  databaseUrl: env.DATABASE_URL ?? "file:./data/smart-mis.db",
  uploadDir: path.resolve(env.UPLOAD_DIR ?? "./uploads"),
  backupDir: path.resolve(env.BACKUP_DIR ?? "./backups"),
  backupKeep: Math.max(1, Number(env.BACKUP_KEEP ?? 14)),
  groq: {
    apiKey: env.GROQ_API_KEY ?? "",
    textModels: list(env.GROQ_TEXT_MODELS, ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"]),
    visionModels: list(env.GROQ_VISION_MODELS, ["qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct"]),
    baseUrl: env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  mail: {
    user: env.GMAIL_USER ?? "",
    appPassword: env.GMAIL_APP_PASSWORD ?? "",
    fromName: env.MAIL_FROM_NAME ?? "Smart MIS",
    dryRun: (env.EMAIL_DRY_RUN ?? "false").toLowerCase() === "true",
  },
  waCloud: {
    token: env.WA_CLOUD_TOKEN ?? "",
    phoneNumberId: env.WA_CLOUD_PHONE_NUMBER_ID ?? "",
    apiVersion: env.WA_CLOUD_API_VERSION ?? "v21.0",
  },
  /** Secure (HTTPS-only) cookies. Defaults to on in production. */
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE.toLowerCase() === "true" : nodeEnv === "production",
  enableCron: (env.ENABLE_CRON ?? "true").toLowerCase() === "true",
  maxUploadBytes: 10 * 1024 * 1024,
};

/** Fail fast on unsafe configuration. Called before the server starts listening. */
export function assertSafeConfig(): void {
  if (config.isProd) {
    if (!config.jwtSecret || config.jwtSecret.length < 32) {
      throw new Error("Refusing to start: JWT_SECRET must be set and at least 32 characters long in production.");
    }
    if (/change-me/i.test(config.jwtSecret)) {
      throw new Error("Refusing to start: JWT_SECRET still has the placeholder value from .env.example.");
    }
  } else if (!config.jwtSecret) {
    // Development convenience only — never used in production (checked above).
    config.jwtSecret = "dev-only-insecure-secret-do-not-use-in-production-0000";
    console.warn("[config] JWT_SECRET not set — using an insecure development secret.");
  }
}

export const isAiEnabled = () => Boolean(config.groq.apiKey);
export const isMailConfigured = () => config.mail.dryRun || Boolean(config.mail.user && config.mail.appPassword);
export const isWaCloudConfigured = () => Boolean(config.waCloud.token && config.waCloud.phoneNumberId);
