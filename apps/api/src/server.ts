import { checkDatabase, closeDatabase, createDatabaseClient, readDatabaseConfig } from "@vicam/db";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = readApiConfig();
const logger = createLogger(config.LOG_LEVEL);
const { pool } = createDatabaseClient(readDatabaseConfig());
const app = createApp({
  config,
  databaseProbe: async () => {
    await checkDatabase(pool);
  },
  logger,
  pool,
});

const server = app.listen(config.API_PORT, config.API_HOST, () => {
  logger.info({ host: config.API_HOST, port: config.API_PORT }, "api started");
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "api shutdown started");

  const forceExit = setTimeout(() => {
    logger.fatal({ signal }, "api graceful shutdown timed out");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await closeDatabase(pool);
  clearTimeout(forceExit);
  logger.info({ signal }, "api shutdown complete");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      logger.fatal({ error, signal }, "api shutdown failed");
      process.exitCode = 1;
    });
  });
}
