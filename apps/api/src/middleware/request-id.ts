import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

const safeRequestId = /^[A-Za-z0-9._:-]{1,100}$/;

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const candidate = request.header("x-request-id");
  request.requestId =
    candidate !== undefined && safeRequestId.test(candidate) ? candidate : randomUUID();
  response.setHeader("x-request-id", request.requestId);
  next();
}
