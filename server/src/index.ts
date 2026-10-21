import { config, isAiAvailable } from "./lib/config";
import { createApp } from "./app";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[server] Smart MIS listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[server] AI insights: ${isAiAvailable() ? "enabled (Groq)" : "off — add GROQ_API_KEY to .env to enable"}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
