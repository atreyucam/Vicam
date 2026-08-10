import { errorEnvelopeSchema, type ErrorEnvelope } from "@vicam/contracts";
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

import { safeError } from "./logger.js";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function errorEnvelope(value: unknown): ErrorEnvelope {
  return errorEnvelopeSchema.parse(value);
}

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json(
    errorEnvelope({
      code: "RESOURCE_NOT_FOUND",
      message: "El recurso solicitado no está disponible.",
      requestId: request.requestId,
    }),
  );
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    void _next;
    if (error instanceof ZodError) {
      response.status(422).json(
        errorEnvelope({
          code: "VALIDATION_ERROR",
          message: "La solicitud contiene datos inválidos.",
          fieldErrors: error.flatten().fieldErrors,
          requestId: request.requestId,
        }),
      );
      return;
    }

    if (error instanceof AppError) {
      if (error.status === 429 && typeof error.details?.retryAfter === "number") {
        response.setHeader("retry-after", Math.ceil(error.details.retryAfter));
      }
      response.status(error.status).json(
        errorEnvelope({
          code: error.code,
          message: error.message,
          requestId: request.requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
      );
      return;
    }

    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json(
        errorEnvelope({
          code: "INVALID_JSON",
          message: "El cuerpo JSON no es válido.",
          requestId: request.requestId,
        }),
      );
      return;
    }

    logger.error({ ...safeError(error), requestId: request.requestId }, "unhandled request error");
    response.status(500).json(
      errorEnvelope({
        code: "INTERNAL_ERROR",
        message: "Ocurrió un error inesperado.",
        requestId: request.requestId,
      }),
    );
  };
}
