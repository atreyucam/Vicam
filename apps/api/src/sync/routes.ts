import {
  createOfflineGrantRequestSchema,
  offlineGrantHeaderSchema,
  registerDeviceRequestSchema,
  resolveSyncConflictRequestSchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
} from "@vicam/contracts";
import { Router } from "express";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import type { RequestMeta } from "../domain/shared.js";
import { AppError } from "../errors.js";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import { SyncIdentityService, SyncService } from "./service.js";

const idSchema = z.uuid();
const statusQuerySchema = z.object({ deviceId: z.uuid() });

function actor(request: import("express").Request) {
  const auth = requireAuth(request);
  return {
    userId: auth.userId,
    role: auth.role,
    sessionId: auth.sessionId,
    deviceId: auth.deviceId,
  };
}

function meta(request: import("express").Request): RequestMeta {
  return { requestId: request.requestId, ipAddress: requestIp(request) };
}

function requireOfflineSyncEnabled(config: ApiConfig): import("express").RequestHandler {
  return (_request, _response, next) => {
    if (!config.OFFLINE_SYNC_ENABLED) {
      next(
        new AppError(
          503,
          "OFFLINE_SYNC_DISABLED",
          "La sincronización offline está deshabilitada en este entorno.",
        ),
      );
      return;
    }
    next();
  };
}

export function createSyncIdentityRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const bearer = authenticate(pool, config.AUTH_SECRET);
  const service = new SyncIdentityService(pool, config.AUTH_SECRET);
  router.use(requireOfflineSyncEnabled(config), bearer, requirePasswordChangeComplete);
  router.post("/devices", async (request, response, next) => {
    try {
      response
        .status(201)
        .json(
          await service.registerDevice(
            actor(request),
            registerDeviceRequestSchema.parse(request.body),
            meta(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
  router.delete("/devices/:id", async (request, response, next) => {
    try {
      await service.revokeDevice(actor(request), idSchema.parse(request.params.id), meta(request));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  router.post("/auth/offline-grants", async (request, response, next) => {
    try {
      const input = createOfflineGrantRequestSchema.parse(request.body);
      response
        .status(201)
        .json(await service.createGrant(actor(request), input.deviceId, meta(request)));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createSyncRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const service = new SyncService(pool);
  router.use(
    requireOfflineSyncEnabled(config),
    authenticate(pool, config.AUTH_SECRET),
    requirePasswordChangeComplete,
  );
  router.post("/push", async (request, response, next) => {
    try {
      const input = syncPushRequestSchema.parse(request.body);
      const headers = offlineGrantHeaderSchema.parse(request.headers);
      response.json(
        await service.push(
          actor(request),
          input.deviceId,
          headers["x-offline-grant"],
          input.operations,
          meta(request),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/pull", async (request, response, next) => {
    try {
      const input = syncPullQuerySchema.parse(request.query);
      const headers = offlineGrantHeaderSchema.parse(request.headers);
      response.json(
        await service.pull(
          actor(request),
          input.deviceId,
          headers["x-offline-grant"],
          input.cursor,
          input.limit,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/status", async (request, response, next) => {
    try {
      const input = statusQuerySchema.parse(request.query);
      response.json(await service.status(actor(request), input.deviceId));
    } catch (error) {
      next(error);
    }
  });
  router.get("/conflicts", async (request, response, next) => {
    try {
      response.json(await service.conflicts(actor(request)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/conflicts/:id/resolve", async (request, response, next) => {
    try {
      const input = resolveSyncConflictRequestSchema.parse(request.body);
      response.json(
        await service.resolve(
          actor(request),
          idSchema.parse(request.params.id),
          {
            resolution: input.resolution,
            ...(input.mergedFields === undefined ? {} : { mergedFields: input.mergedFields }),
          },
          meta(request),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}
