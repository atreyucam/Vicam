import {
  createUserRequestSchema,
  resetUserPasswordRequestSchema,
  temporaryCredentialSchema,
  updateUserRequestSchema,
  usersQuerySchema,
  userSchema,
  usersPageSchema,
} from "@vicam/contracts";
import { Router } from "express";
import { z } from "zod";

import {
  authenticate,
  requireManager,
  requirePasswordChangeComplete,
} from "../auth/authenticate.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { requestIp } from "../auth/http.js";
import { UsersService } from "./service.js";

function meta(request: import("express").Request) {
  const key = request.headers["idempotency-key"];
  return {
    requestId: request.requestId,
    ipAddress: requestIp(request),
    ...(typeof key === "string" ? { idempotencyKey: key } : {}),
  };
}

export function createUsersRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const service = new UsersService(pool);
  router.use(authenticate(pool, config.AUTH_SECRET));
  router.use(requirePasswordChangeComplete);
  router.get("/", async (request, response, next) => {
    try {
      requireManager(request);
      response.json(
        usersPageSchema.parse(await service.list(usersQuerySchema.parse(request.query))),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/", async (request, response, next) => {
    try {
      const actor = requireManager(request);
      const value = await service.create(
        createUserRequestSchema.parse(request.body),
        actor,
        meta(request),
      );
      response.status(201).json(temporaryCredentialSchema.parse(value));
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/reset-password", async (request, response, next) => {
    try {
      const actor = requireManager(request);
      resetUserPasswordRequestSchema.parse(request.body);
      const value = await service.resetPassword(
        z.uuid().parse(request.params.id),
        actor,
        meta(request),
      );
      response.json(temporaryCredentialSchema.parse(value));
    } catch (error) {
      next(error);
    }
  });
  router.patch("/:id", async (request, response, next) => {
    try {
      const actor = requireManager(request);
      const value = await service.update(
        z.uuid().parse(request.params.id),
        updateUserRequestSchema.parse(request.body),
        actor,
        meta(request),
      );
      response.json(userSchema.parse(value));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
