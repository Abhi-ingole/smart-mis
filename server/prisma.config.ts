import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

for (const p of [path.resolve(".env"), path.resolve("..", ".env")]) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, quiet: true });
    break;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "file:./data/smart-mis.db" },
});
