import { Router } from "express";
import fs from "node:fs";
import { z } from "zod";
import { canEdit, requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { checkUpload } from "../lib/fileCheck";
import { audit } from "../lib/audit";
import { prisma } from "../lib/db";
import { extractFile } from "../services/extract";
import { saveUpload, uploadMiddleware, uploadPath } from "../services/uploads";
import { getSettings } from "../services/settings";

export const extractRouter = Router();

/** Upload a vendor file and get back suggested numbers (nothing is saved to daily data yet). */
extractRouter.post(
  "/",
  requireAuth,
  canEdit,
  uploadMiddleware,
  validate({ body: z.object({ channel: z.enum(["wa", "email"]) }) }),
  async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a file to upload.");
    const channel = req.valid.body.channel as "wa" | "email";
    const check = checkUpload(file, ["pdf", "csv", "xlsx", "png", "jpg"]);
    if (!check.ok || !check.kind) {
      await audit(req, { action: "upload_rejected", entity: "upload", details: { name: file.originalname, mime: file.mimetype, size: file.size, reason: check.reason } });
      throw new HttpError(400, check.reason ?? "File rejected.");
    }
    const user = req.user!;
    const saved = await saveUpload(user.companyId, user.id, file.originalname, file.buffer, check.kind);
    await audit(req, { action: "create", entity: "upload", entityId: saved.id, details: { name: saved.originalName, kind: check.kind, size: saved.sizeBytes, channel } });

    const settings = await getSettings(user.companyId);
    let result;
    try {
      result = await extractFile(file.buffer, check.kind, channel, { allowImageAi: settings.allowImageAi });
    } catch (e) {
      console.error("[extract] failed:", (e as Error).message);
      result = { channel, method: "none" as const, fields: {}, warnings: ["Could not read this file. Enter the numbers manually."], preview: [] };
    }
    res.json({ file: { storedName: saved.storedName, originalName: saved.originalName, kind: check.kind }, extraction: result });
  },
);

export const filesRouter = Router();

/** Download a previously uploaded source file — only for logged-in users of the same company. */
filesRouter.get("/:name", requireAuth, validate({ params: z.object({ name: z.string().regex(/^[a-f0-9]{32}\.(pdf|csv|xlsx|png|jpg)$/) }) }), async (req, res) => {
  const { name } = req.valid.params as { name: string };
  const upload = await prisma.upload.findFirst({ where: { companyId: req.user!.companyId, storedName: name } });
  const full = uploadPath(name);
  if (!upload || !full || !fs.existsSync(full)) throw new HttpError(404, "File not found.");
  res.setHeader("Content-Type", upload.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${upload.originalName.replace(/"/g, "")}"`);
  fs.createReadStream(full).pipe(res);
});
