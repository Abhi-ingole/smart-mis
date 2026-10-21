/// <reference types="vitest/config" />
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Strict Content-Security-Policy for production builds. Static hosts like GitHub Pages
// can't send security headers, so it is embedded as a <meta> tag. It only allows this
// site's own scripts and blocks every outside connection, so uploaded data can't be sent anywhere.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function securityHeaders(isStatic: boolean): Plugin {
  let outDir = "dist";
  return {
    name: "smart-mis-security",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`,
      );
    },
    closeBundle() {
      if (!isStatic) return;
      // GitHub Pages: serve the app for deep links (/smart-mis/dashboard/…) and skip Jekyll.
      const dir = path.resolve(__dirname, outDir);
      fs.copyFileSync(path.join(dir, "index.html"), path.join(dir, "404.html"));
      fs.writeFileSync(path.join(dir, ".nojekyll"), "");
    },
  };
}

const isStatic = process.env.VITE_STATIC === "true";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss(), securityHeaders(isStatic)],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  worker: { format: "es" },
  build: {
    outDir: process.env.VITE_OUT_DIR ?? "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
