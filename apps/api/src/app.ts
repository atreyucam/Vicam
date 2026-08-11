import express, { type Express } from "express";
import type { Logger } from "pino";
import type { ApiConfig } from "./config.js";
import type { DbPool } from "./db.js";
import { createAuthRouter } from "./auth/routes.js";
import { createUsersRouter } from "./users/routes.js";
import { createAccountsRouter } from "./accounts/routes.js";
import { createVisitsRouter } from "./visits/routes.js";
import { createTasksRouter } from "./tasks/routes.js";
import { createAuditRouter } from "./audit/routes.js";
import { createFruitsRouter } from "./catalogs/fruits-routes.js";
import { createDocumentCategoriesRouter } from "./catalogs/document-categories-routes.js";
import { createPhase3Router } from "./phase3/routes.js";
import { createOperationsRouter } from "./phase3/operations-routes.js";
import { createDocumentsRouter } from "./documents/routes.js";
import { createSyncIdentityRouter, createSyncRouter } from "./sync/routes.js";
import { authenticate, requirePasswordChangeComplete } from "./auth/authenticate.js";
import { createReportsAnalyticsRouter } from "./reports/index.js";

import { createErrorHandler, notFoundHandler } from "./errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { createHealthRouter, type DatabaseProbe } from "./routes/health.js";

export type AppDependencies = {
  databaseProbe: DatabaseProbe;
  logger: Logger;
  pool?: DbPool;
  config?: ApiConfig;
};

export function createApp({ databaseProbe, logger, pool, config }: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  if (config !== undefined) app.set("trust proxy", config.CADDY_TRUSTED_PROXIES);

  app.use(requestIdMiddleware);
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(securityHeaders);
  app.use(requestLoggingMiddleware(logger));
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  app.use("/api/v1/health", createHealthRouter(databaseProbe));
  if (pool !== undefined && config !== undefined) {
    app.use("/api/v1/auth", createAuthRouter(pool, config));
    app.use("/api/v1/users", createUsersRouter(pool, config));
    app.use("/api/v1/commercial-accounts", createAccountsRouter(pool, config));
    app.use("/api/v1/visits", createVisitsRouter(pool, config));
    app.use("/api/v1/tasks", createTasksRouter(pool, config));
    app.use("/api/v1/audit", createAuditRouter(pool, config));
    app.use("/api/v1/fruits", createFruitsRouter(pool, config));
    app.use("/api/v1/document-categories", createDocumentCategoriesRouter(pool, config));
    app.use("/api/v1", createSyncIdentityRouter(pool, config));
    app.use("/api/v1/sync", createSyncRouter(pool, config));
    app.use("/api/v1", createPhase3Router(pool, config));
    app.use(
      "/api/v1",
      authenticate(pool, config.AUTH_SECRET),
      requirePasswordChangeComplete,
      createReportsAnalyticsRouter(pool),
    );
    app.use("/api/v1", createOperationsRouter(pool, config));
    app.use("/api/v1", createDocumentsRouter(pool, config));
  }
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
