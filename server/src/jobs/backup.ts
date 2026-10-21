import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../lib/config";
import { sqliteFilePath } from "../lib/db";

/** Online SQLite backup (safe while the app is running). Keeps the newest `keep` files. */
export async function backupDatabase(opts: { dbFile?: string; dir?: string; keep?: number; now?: Date } = {}) {
  const dbFile = opts.dbFile ?? sqliteFilePath();
  const dir = opts.dir ?? config.backupDir;
  const keep = opts.keep ?? config.backupKeep;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const target = path.join(dir, `smart-mis-${stamp}.db`);
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  fs.chmodSync(target, 0o600);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^smart-mis-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(keep)) fs.unlinkSync(path.join(dir, old));
  console.log(`[backup] wrote ${target} (keeping ${Math.min(files.length, keep)} backups)`);
  return target;
}

if (require.main === module) {
  backupDatabase().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
