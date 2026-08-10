import { createServer, type Server } from "node:http";

import type { Logger } from "pino";

import { workerLiveness, workerReadiness } from "./health.js";

export function createHealthServer(
  databaseProbe: () => Promise<void>,
  isQueueStarted: () => boolean,
  logger: Logger,
): Server {
  return createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");

    if (request.method === "GET" && request.url === "/health/live") {
      response.writeHead(200).end(JSON.stringify(workerLiveness()));
      return;
    }

    if (request.method === "GET" && request.url === "/health/ready") {
      void workerReadiness(databaseProbe, isQueueStarted())
        .then(({ body, status }) => response.writeHead(status).end(JSON.stringify(body)))
        .catch((error: unknown) => {
          logger.error({ errorType: typeof error }, "worker readiness response failed");
          response.writeHead(503).end();
        });
      return;
    }

    response
      .writeHead(404)
      .end(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Recurso no disponible." }));
  });
}
