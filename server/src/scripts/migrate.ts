/**
 * Applies the SQL files in prisma/migrations in order.
 * It writes the same `_prisma_migrations` bookkeeping table Prisma uses, so
 * `npx prisma migrate deploy` / `migrate status` stay compatible later.
 * Works without downloading Prisma's native schema engine.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "../lib/config";
import { sqliteFilePath } from "../lib/db";

export function runMigrations(dbFile = sqliteFilePath(), log = true): number {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  )`);

  const dir = path.resolve(__dirname, "../../prisma/migrations");
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const applied = new Set(
    (db.prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`).all() as { migration_name: string }[]).map(
      (r) => r.migration_name,
    ),
  );

  let count = 0;
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, current_timestamp, ?, 1)`,
      ).run(crypto.randomUUID(), checksum, name);
    });
    tx();
    count++;
    if (log) console.log(`[migrate] applied ${name}`);
  }
  db.close();
  if (log) console.log(count ? `[migrate] ${count} migration(s) applied to ${dbFile}` : `[migrate] database is up to date (${dbFile})`);
  return count;
}

if (require.main === module) {
  void config; // ensure .env is loaded
  runMigrations();
}
