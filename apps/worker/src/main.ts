import { checkDatabase, closeDatabase, createDatabaseClient, readDatabaseConfig } from "@vicam/db";
import { PgBoss } from "pg-boss";

import { readWorkerConfig } from "./config.js";
import { createHealthServer } from "./health-server.js";
import { createLogger, safeError } from "./logger.js";
import { registerPhase3Jobs } from "./phase3-jobs.js";

const workerConfig = readWorkerConfig();
const databaseConfig = readDatabaseConfig();
const logger = createLogger(workerConfig.LOG_LEVEL);
const { pool } = createDatabaseClient({ ...databaseConfig, max: Math.min(databaseConfig.max, 3) });
const boss = new PgBoss(databaseConfig.connectionString);
let queueStarted = false;
let shuttingDown = false;

boss.on("error", (error) => {
  logger.error(safeError(error), "pg-boss error");
});

try {
  await boss.start();
  await registerPhase3Jobs(boss, pool, workerConfig, logger);
  queueStarted = true;
} catch (error) {
  logger.fatal(safeError(error), "worker startup failed");
  await closeDatabase(pool);
  process.exit(1);
}

// Queue handlers are deliberately introduced in later phases.
const healthServer = createHealthServer(
  async () => {
    await checkDatabase(pool);
  },
  () => queueStarted,
  logger,
);

healthServer.listen(workerConfig.WORKER_HEALTH_PORT, workerConfig.WORKER_HEALTH_HOST, () => {
  logger.info(
    { host: workerConfig.WORKER_HEALTH_HOST, port: workerConfig.WORKER_HEALTH_PORT },
    "worker started",
  );
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  queueStarted = false;
  logger.info({ signal }, "worker shutdown started");

  const forceExit = setTimeout(() => {
    logger.fatal({ signal }, "worker graceful shutdown timed out");
    process.exit(1);
  }, workerConfig.WORKER_SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await boss.stop({ graceful: true, timeout: workerConfig.WORKER_SHUTDOWN_TIMEOUT_MS });
  await closeDatabase(pool);
  clearTimeout(forceExit);
  logger.info({ signal }, "worker shutdown complete");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      logger.fatal({ ...safeError(error), signal }, "worker shutdown failed");
      process.exitCode = 1;
    });
  });
}
