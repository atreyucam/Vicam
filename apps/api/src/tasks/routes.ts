import {
  cancelTaskRequestSchema,
  completeTaskRequestSchema,
  createTaskRequestSchema,
  taskDetailSchema,
  taskSchema,
  tasksPageSchema,
  tasksQuerySchema,
  updateTaskRequestSchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { TasksService } from "./service.js";
function meta(r: Request) {
  const k = r.headers["idempotency-key"];
  return {
    requestId: r.requestId,
    ipAddress: requestIp(r),
    ...(typeof k === "string" ? { idempotencyKey: k } : {}),
  };
}
export function createTasksRouter(p: DbPool, c: ApiConfig): Router;
export function createTasksRouter(p: DbPool, c: ApiConfig) {
  const r = Router(),
    s = new TasksService(p);
  r.use(authenticate(p, c.AUTH_SECRET));
  r.use(requirePasswordChangeComplete);
  r.get("/", async (q, x, n) => {
    try {
      x.json(tasksPageSchema.parse(await s.list(tasksQuerySchema.parse(q.query), requireAuth(q))));
    } catch (e) {
      n(e);
    }
  });
  r.post("/", async (q, x, n) => {
    try {
      x.status(201).json(
        taskSchema.parse(
          await s.create(createTaskRequestSchema.parse(q.body), requireAuth(q), meta(q)),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.get("/:id", async (q, x, n) => {
    try {
      x.json(
        taskDetailSchema.parse(await s.getDetail(z.uuid().parse(q.params.id), requireAuth(q))),
      );
    } catch (e) {
      n(e);
    }
  });
  r.patch("/:id", async (q, x, n) => {
    try {
      x.json(
        taskSchema.parse(
          await s.update(
            z.uuid().parse(q.params.id),
            updateTaskRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/:id/complete", async (q, x, n) => {
    try {
      x.json(
        taskSchema.parse(
          await s.complete(
            z.uuid().parse(q.params.id),
            completeTaskRequestSchema.parse(q.body),
            requireAuth(q),
            meta(q),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  r.post("/:id/cancel", async (q, x, n) => {
    try {
      x.json(
        taskSchema.parse(
          await s.cancel(
            z.uuid().parse(q.params.id),
            cancelTaskRequestSchema.parse(q.body),
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
