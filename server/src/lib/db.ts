import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { config } from "./config";

/** Absolute path of the SQLite file from a `file:` URL. */
export function sqliteFilePath(url = config.databaseUrl): string {
  const p = url.replace(/^file:/, "");
  return path.resolve(p);
}

function makeClient(): PrismaClient {
  const file = sqliteFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma: PrismaClient = globalForPrisma.prisma ?? makeClient();
if (!config.isProd && !config.isTest) globalForPrisma.prisma = prisma;

export type { PrismaClient };
