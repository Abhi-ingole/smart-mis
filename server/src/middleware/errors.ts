import type { ErrorRequestHandler, RequestHandler } from "express";
import { config } from "../lib/config";

/** Throw this for expected, user-facing errors. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Multer size limit etc.
  if (err?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File too large. Maximum size is 10 MB." });
    return;
  }
  if (err?.code === "LIMIT_UNEXPECTED_FILE" || err?.name === "MulterError") {
    res.status(400).json({ error: "Invalid upload." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large." });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body." });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // Unexpected: log server-side, hide internals from the client in production.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, config.isProd ? (err?.message ?? err) : err);
  res.status(500).json(config.isProd ? { error: "Something went wrong." } : { error: err?.message ?? "Internal error", stack: err?.stack });
};
