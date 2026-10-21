/**
 * Runs before every test file: points the app at a throw-away SQLite file,
 * a temp uploads folder, dry-run email and no AI, then applies migrations.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-mis-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.UPLOAD_DIR = path.join(dir, "uploads");
process.env.BACKUP_DIR = path.join(dir, "backups");
process.env.JWT_SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.EMAIL_DRY_RUN = "true";
process.env.GROQ_API_KEY = "";
process.env.ENABLE_CRON = "false";

const { runMigrations } = await import("../src/scripts/migrate");
runMigrations(path.join(dir, "test.db"), false);
