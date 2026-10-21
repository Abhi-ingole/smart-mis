import fs from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./lib/config";
import { errorHandler, notFound } from "./middleware/errors";
import { aiRouter } from "./routes/ai";

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
          "worker-src": ["'self'", "blob:"],
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

  // Strict CORS: only the configured app origin(s).
  app.use(
    "/api",
    cors({
      origin: (origin, cb) => cb(null, !origin || config.appOrigins.includes(origin)),
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
  const originGuard: RequestHandler = (req, res, next) => {
    const origin = req.get("origin");
    if (req.method === "POST") {
      // Same-origin requests from our own page, or the configured dev origin, only.
      const selfOrigin = `${req.protocol}://${req.get("host")}`;
      if (!origin || (origin !== selfOrigin && !config.appOrigins.includes(origin))) {
        res.status(403).json({ error: "Origin not allowed." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Send JSON." });
        return;
      }
    }
    next();
  };
  app.use("/api", originGuard);
  app.use("/api", rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 120, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api", express.json({ limit: "100kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/ai", aiRouter);
  app.use("/api", notFound);

  // Serve the built React app (production / `npm start`).
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
