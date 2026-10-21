import fs from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "./lib/config";
import { csrfProtection, loadUser } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/errors";
import { authRouter } from "./routes/auth";
import { metricsRouter } from "./routes/metrics";
import { extractRouter, filesRouter } from "./routes/extract";
import { dashboardRouter } from "./routes/dashboard";
import { reportsRouter } from "./routes/reports";
import { auditRouter, holidaysRouter, settingsRouter, targetsRouter, usersRouter } from "./routes/settings";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.isProd || process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          "object-src": ["'none'"],
          ...(config.isProd ? {} : { "upgrade-insecure-requests": null }),
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "same-origin" },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  // Strict CORS: only the configured app origin, with credentials.
  app.use(
    "/api",
    cors({
      origin: (origin, cb) => cb(null, !origin || origin === config.appOrigin),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"],
      maxAge: 600,
    }),
  );
  // Reject state-changing requests from any other origin outright.
  const originGuard: RequestHandler = (req, res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== config.appOrigin && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      res.status(403).json({ error: "Origin not allowed." });
      return;
    }
    next();
  };
  app.use("/api", originGuard);

  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 300, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Slow down a little." } }),
  );

  // Small JSON bodies everywhere, except emailing a report with its PNG.
  const smallJson = express.json({ limit: "100kb" });
  const bigJson = express.json({ limit: "8mb" });
  app.use("/api", (req, res, next) => (/^\/reports\/\d+\/email$/.test(req.path) ? bigJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api", loadUser);
  app.use("/api", csrfProtection);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/metrics", metricsRouter);
  app.use("/api/extract", extractRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/targets", targetsRouter);
  app.use("/api/holidays", holidaysRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api", notFound);

  // Production: serve the built React app from the same server.
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: false, maxAge: "7d", setHeaders: (res, p) => p.endsWith(".html") && res.setHeader("Cache-Control", "no-cache") }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
