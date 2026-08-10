import {
  createDocumentCategoryRequestSchema,
  documentCategorySchema,
  updateDocumentCategoryRequestSchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { DocumentCategoriesService } from "./document-categories-service.js";
const meta = (r: Request) => ({
  requestId: r.requestId,
  ipAddress: requestIp(r),
  ...(typeof r.headers["idempotency-key"] === "string"
    ? { idempotencyKey: r.headers["idempotency-key"] }
    : {}),
});
export function createDocumentCategoriesRouter(pool: DbPool, config: ApiConfig): ExpressRouter {
  const router = Router(),
    service = new DocumentCategoriesService(pool);
  router.use(authenticate(pool, config.AUTH_SECRET), requirePasswordChangeComplete);
  router.get("/", async (r, s, n) => {
    try {
      s.json((await service.list(requireAuth(r))).map((x) => documentCategorySchema.parse(x)));
    } catch (e) {
      n(e);
    }
  });
  router.post("/", async (r, s, n) => {
    try {
      s.status(201).json(
        documentCategorySchema.parse(
          await service.create(
            createDocumentCategoryRequestSchema.parse(r.body),
            requireAuth(r),
            meta(r),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  router.patch("/:id", async (r, s, n) => {
    try {
      s.json(
        documentCategorySchema.parse(
          await service.update(
            z.uuid().parse(r.params.id),
            updateDocumentCategoryRequestSchema.parse(r.body),
            requireAuth(r),
            meta(r),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  return router;
}
