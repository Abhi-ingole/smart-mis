import { assertSafeConfig, config } from "./lib/config";

try {
  assertSafeConfig();
} catch (e) {
  console.error(`[startup] ${(e as Error).message}`);
  process.exit(1);
}

import { runMigrations } from "./scripts/migrate";
import { createApp } from "./app";
import { startJobs } from "./jobs/scheduler";

runMigrations(undefined, !config.isTest);

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[server] Smart MIS API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

if (config.enableCron) startJobs();

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
