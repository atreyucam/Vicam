import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

export function requestLoggingMiddleware(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = performance.now();

    response.on("finish", () => {
      logger.info(
        {
          requestId: request.requestId,
          request: {
            method: request.method,
            path: normalizePath(request.path),
            remoteAddress: request.ip,
          },
          response: { statusCode: response.statusCode },
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        },
        "request completed",
      );
    });

    next();
  };
}

const uuidSegment =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const numericSegment = /\/\d+(?=\/|$)/g;

function normalizePath(path: string): string {
  return path.replace(uuidSegment, "/:id").replace(numericSegment, "/:id");
}
