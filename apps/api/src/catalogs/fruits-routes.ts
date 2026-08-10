import { fruitsQuerySchema } from "@vicam/contracts";
import { Router, type Request } from "express";
import { z } from "zod";

import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import {
  createFruitSchema,
  fruitSchema,
  FruitsService,
  updateFruitSchema,
} from "./fruits-service.js";

const meta = (request: Request) => ({
  requestId: request.requestId,
  ipAddress: requestIp(request),
  ...(typeof request.headers["idempotency-key"] === "string"
    ? { idempotencyKey: request.headers["idempotency-key"] }
    : {}),
});

export function createFruitsRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const service = new FruitsService(pool);
  router.use(authenticate(pool, config.AUTH_SECRET), requirePasswordChangeComplete);
  router.get("/", async (request, response, next) => {
    try {
      const { includeInactive } = fruitsQuerySchema.parse(request.query);
      response.json(
        z.array(fruitSchema).parse(await service.list(requireAuth(request), includeInactive)),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/", async (request, response, next) => {
    try {
      response
        .status(201)
        .json(
          fruitSchema.parse(
            await service.create(
              createFruitSchema.parse(request.body),
              requireAuth(request),
              meta(request),
            ),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
  router.patch("/:id", async (request, response, next) => {
    try {
      response.json(
        fruitSchema.parse(
          await service.update(
            z.uuid().parse(request.params.id),
            updateFruitSchema.parse(request.body),
            requireAuth(request),
            meta(request),
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}
