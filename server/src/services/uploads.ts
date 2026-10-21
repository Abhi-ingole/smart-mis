import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import type { FileKind } from "../lib/fileCheck";
import { MIME_FOR } from "../lib/fileCheck";

/** Files are kept in memory only long enough to validate them, then written with a random name. */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 10_000 },
}).single("file");

export function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
}

export async function saveUpload(companyId: number, userId: number, original: string, buf: Buffer, kind: FileKind) {
  ensureUploadDir();
  const storedName = `${crypto.randomBytes(16).toString("hex")}.${kind}`;
  const full = path.join(config.uploadDir, storedName);
  await fs.promises.writeFile(full, buf, { mode: 0o600, flag: "wx" });
  const safeOriginal = path.basename(original).replace(/[^\w.\- ()]/g, "_").slice(0, 150);
  return prisma.upload.create({
    data: { companyId, storedName, originalName: safeOriginal, mimeType: MIME_FOR[kind], sizeBytes: buf.length, createdBy: userId },
  });
}

/** Path on disk for a stored file, guarding against traversal. */
export function uploadPath(storedName: string): string | null {
  if (!/^[a-f0-9]{32}\.(pdf|csv|xlsx|png|jpg)$/.test(storedName)) return null;
  const full = path.join(config.uploadDir, storedName);
  return full.startsWith(config.uploadDir + path.sep) ? full : null;
}

/** True if this stored file belongs to the company. */
export async function ownsUpload(companyId: number, storedName: string | null | undefined): Promise<boolean> {
  if (!storedName) return true;
  const u = await prisma.upload.findFirst({ where: { companyId, storedName }, select: { id: true } });
  return Boolean(u);
}
