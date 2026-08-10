import { auditPageSchema, auditQuerySchema } from "@vicam/contracts";
import { Router } from "express";
import {
  authenticate,
  requireManager,
  requirePasswordChangeComplete,
} from "../auth/authenticate.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { pagination } from "../domain/shared.js";

const sensitive = /password|token|secret|pin|document|content|cookie|authorization/i;
export function createAuditRouter(pool: DbPool, config: ApiConfig): Router;
export function createAuditRouter(pool: DbPool, config: ApiConfig) {
  const router = Router();
  router.use(authenticate(pool, config.AUTH_SECRET));
  router.use(requirePasswordChangeComplete);
  router.get("/", async (req, res, next) => {
    try {
      requireManager(req);
      const q = auditQuerySchema.parse(req.query);
      const v: unknown[] = [];
      const w: string[] = [];
      for (const [key, col, op] of [
        ["actorUserId", "actor_user_id", "="],
        ["action", "action", "="],
        ["entityType", "entity_type", "="],
        ["entityId", "entity_id", "="],
        ["from", "occurred_at", ">="],
        ["to", "occurred_at", "<="],
      ] as const) {
        const value = q[key];
        if (value !== undefined) {
          v.push(value);
          w.push(`${col}${op}$${v.length}`);
        }
      }
      const clause = w.length ? `where ${w.join(" and ")}` : "";
      const count = await pool.query<{ total: number }>(
        `select count(*)::integer total from audit_logs ${clause}`,
        v,
      );
      v.push(q.pageSize, (q.page - 1) * q.pageSize);
      const rows = await pool.query(
        `select * from audit_logs ${clause} order by occurred_at desc,id desc limit $${v.length - 1} offset $${v.length}`,
        v,
      );
      const items = rows.rows.map((row: Record<string, unknown>) => {
        const before = (row.before_changes ?? {}) as Record<string, unknown>,
          after = (row.after_changes ?? {}) as Record<string, unknown>;
        const declared = [before.changedFields, after.changedFields].flatMap((value) =>
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [],
        );
        return {
          id: row.id,
          actorUserId: row.actor_user_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          changedFields: [
            ...new Set([...declared, ...Object.keys(before), ...Object.keys(after)]),
          ].filter((k) => k !== "changedFields" && !sensitive.test(k)),
          requestId: row.request_id,
          ipAddress: row.ip_address,
          createdAt: (row.occurred_at as Date).toISOString(),
        };
      });
      const total = count.rows[0]?.total ?? 0;
      res.json(auditPageSchema.parse({ items, pagination: pagination(q.page, q.pageSize, total) }));
    } catch (e) {
      next(e);
    }
  });
  return router;
}
