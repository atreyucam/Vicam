import {
  cancelVisitRequestSchema,
  completeVisitRequestSchema,
  createVisitRequestSchema,
  rescheduleVisitRequestSchema,
  updateVisitRequestSchema,
  visitDetailSchema,
  visitSchema,
  visitsPageSchema,
  visitsQuerySchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { VisitsService } from "./service.js";
function meta(r: Request) {
  const k = r.headers["idempotency-key"];
  return {
    requestId: r.requestId,
    ipAddress: requestIp(r),
    ...(typeof k === "string" ? { idempotencyKey: k } : {}),
  };
}
export function createVisitsRouter(pool: DbPool, c: ApiConfig): Router;
export function createVisitsRouter(pool: DbPool, c: ApiConfig) {
  const r = Router(),
    s = new VisitsService(pool);
  r.use(authenticate(pool, c.AUTH_SECRET));
  r.use(requirePasswordChangeComplete);
  r.get("/", async (q, p, n) => {
    try {
      p.json(
        visitsPageSchema.parse(await s.list(visitsQuerySchema.parse(q.query), requireAuth(q))),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/", async (q, p, n) => {
    try {
      p.status(201).json(
        visitSchema.parse(
          await s.create(createVisitRequestSchema.parse(q.body), requireAuth(q), meta(q)),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.get("/:id", async (q, p, n) => {
    try {
      p.json(
        visitDetailSchema.parse(await s.getDetail(z.uuid().parse(q.params.id), requireAuth(q))),
      );
    } catch (e) {
      n(e);
    }
  });
  r.patch("/:id", async (q, p, n) => {
    try {
      p.json(
        visitSchema.parse(
          await s.update(
            z.uuid().parse(q.params.id),
            updateVisitRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/:id/reschedule", async (q, p, n) => {
    try {
      p.json(
        visitSchema.parse(
          await s.reschedule(
            z.uuid().parse(q.params.id),
            rescheduleVisitRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/:id/cancel", async (q, p, n) => {
    try {
      p.json(
        visitSchema.parse(
          await s.cancel(
            z.uuid().parse(q.params.id),
            cancelVisitRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/:id/complete", async (q, p, n) => {
    try {
      p.json(
        visitSchema.parse(
          await s.complete(
            z.uuid().parse(q.params.id),
            completeVisitRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  return r;
}
