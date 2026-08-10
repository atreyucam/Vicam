import { createHash, randomUUID } from "node:crypto";
import {
  appSettingsSchema,
  notificationSchema,
  notificationsPageSchema,
  notificationsQuerySchema,
  pushSubscriptionRequestSchema,
  updateAppSettingsRequestSchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { pagination, type Actor } from "../domain/shared.js";
import { AppError } from "../errors.js";
type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: Date | null;
  created_at: Date;
};
type SettingsRow = { value: Record<string, unknown>; version: number };
const meta = (r: Request) => ({
  requestId: r.requestId,
  ipAddress: requestIp(r),
  ...(typeof r.headers["idempotency-key"] === "string"
    ? { idempotencyKey: r.headers["idempotency-key"] }
    : {}),
});
const manager = (actor: Actor) => {
  if (actor.role !== "MANAGER")
    throw new AppError(403, "MANAGER_REQUIRED", "No tiene permiso para esta configuración.");
};
const mapNotification = (r: NotificationRow) =>
  notificationSchema.parse({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    readAt: r.read_at === null ? null : r.read_at.toISOString(),
    createdAt: r.created_at.toISOString(),
  });
export function createPhase3Router(pool: DbPool, config: ApiConfig): ExpressRouter {
  const router = Router();
  router.use(authenticate(pool, config.AUTH_SECRET), requirePasswordChangeComplete);
  router.get("/notifications", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        q = notificationsQuerySchema.parse(r.query),
        values: unknown[] = [a.userId],
        where = ["user_id=$1"];
      if (q.unread !== undefined) where.push(q.unread ? "read_at is null" : "read_at is not null");
      const count = await pool.query<{ total: number }>(
        `select count(*)::integer total from notifications where ${where.join(" and ")}`,
        values,
      );
      values.push(q.pageSize, (q.page - 1) * q.pageSize);
      const rows = await pool.query<NotificationRow>(
        `select * from notifications where ${where.join(" and ")} order by created_at desc,id limit $${values.length - 1} offset $${values.length}`,
        values,
      );
      s.json(
        notificationsPageSchema.parse({
          items: rows.rows.map(mapNotification),
          pagination: pagination(q.page, q.pageSize, count.rows[0]?.total ?? 0),
        }),
      );
    } catch (e) {
      n(e);
    }
  });
  router.post("/notifications/read-all", async (r, s, n) => {
    try {
      const a = requireAuth(r);
      const result = await inTransaction(
        pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: a.userId,
                key: meta(r).idempotencyKey,
                operation: "notification.read-all",
                request: {},
                statusCode: 200,
              },
              async () => {
                const updated = await c.query<NotificationRow>(
                  "update notifications set read_at=now() where user_id=$1 and read_at is null",
                  [a.userId],
                );
                return { updated: updated.rowCount ?? 0 };
              },
            )
          ).value,
      );
      s.json(result);
    } catch (e) {
      n(e);
    }
  });
  router.post("/notifications/:id/read", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        id = z.uuid().parse(r.params.id);
      const result = await inTransaction(
        pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: a.userId,
                key: meta(r).idempotencyKey,
                operation: `notification.read:${id}`,
                request: {},
                statusCode: 200,
              },
              async () => {
                const updated = await c.query<NotificationRow>(
                  "update notifications set read_at=coalesce(read_at,now()) where id=$1 and user_id=$2 returning *",
                  [id, a.userId],
                );
                if (!updated.rows[0])
                  throw new AppError(
                    404,
                    "NOTIFICATION_NOT_FOUND",
                    "La notificación no está disponible.",
                  );
                return mapNotification(updated.rows[0]);
              },
            )
          ).value,
      );
      s.json(result);
    } catch (e) {
      n(e);
    }
  });
  router.post("/push-subscriptions", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        input = pushSubscriptionRequestSchema.parse(r.body);
      if (a.deviceId !== input.deviceId)
        throw new AppError(
          403,
          "DEVICE_MISMATCH",
          "La suscripción debe pertenecer al dispositivo actual.",
        );
      const result = await inTransaction(
        pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: a.userId,
                key: meta(r).idempotencyKey,
                operation: "push-subscription.create",
                request: input,
                statusCode: 201,
              },
              async () => {
                const id = randomUUID(),
                  hash = createHash("sha256").update(input.endpoint).digest("hex");
                const stored = await c.query<{ id: string }>(
                  `insert into push_subscriptions
                     (id,user_id,device_id,endpoint_hash,endpoint,p256dh,auth)
                   values($1,$2,$3,$4,$5,$6,$7)
                   on conflict(endpoint_hash) do update
                   set endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,
                       updated_at=now(),expires_at=null
                   where push_subscriptions.user_id=excluded.user_id
                     and push_subscriptions.device_id=excluded.device_id
                   returning id`,
                  [id, a.userId, input.deviceId, hash, input.endpoint, input.p256dh, input.auth],
                );
                if (!stored.rows[0])
                  throw new AppError(
                    409,
                    "PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT",
                    "La suscripción ya pertenece a otro dispositivo.",
                  );
                return { id: stored.rows[0].id };
              },
            )
          ).value,
      );
      s.status(201).json(result);
    } catch (e) {
      n(e);
    }
  });
  router.delete("/push-subscriptions/:id", async (r, s, n) => {
    try {
      const actor = requireAuth(r);
      const id = z.uuid().parse(r.params.id);
      const result = await inTransaction(
        pool,
        async (client) =>
          (
            await idempotentMutation(
              client,
              {
                actorUserId: actor.userId,
                key: meta(r).idempotencyKey,
                operation: `push-subscription.delete:${id}`,
                request: {},
                statusCode: 200,
              },
              async () => {
                const deleted = await client.query(
                  "delete from push_subscriptions where id=$1 and user_id=$2 and device_id=$3 returning id",
                  [id, actor.userId, actor.deviceId],
                );
                if (!deleted.rows[0])
                  throw new AppError(
                    404,
                    "PUSH_SUBSCRIPTION_NOT_FOUND",
                    "La suscripción no está disponible.",
                  );
                await writeAudit(client, {
                  actorUserId: actor.userId,
                  action: "PUSH_SUBSCRIPTION_REMOVED",
                  entityType: "push_subscription",
                  entityId: id,
                  requestId: meta(r).requestId,
                  deviceId: actor.deviceId,
                  ipAddress: meta(r).ipAddress,
                  after: { removed: true },
                });
                return { id };
              },
            )
          ).value,
      );
      s.json(result);
    } catch (error) {
      n(error);
    }
  });
  router.get("/settings", async (r, s, n) => {
    try {
      manager(requireAuth(r));
      const result = await pool.query<SettingsRow>(
        "select value,version from app_settings where settings_key='application'",
      );
      if (!result.rows[0])
        throw new AppError(500, "SETTINGS_UNAVAILABLE", "La configuración no está disponible.");
      s.json(appSettingsSchema.parse({ ...result.rows[0].value, version: result.rows[0].version }));
    } catch (e) {
      n(e);
    }
  });
  router.patch("/settings", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        input = updateAppSettingsRequestSchema.parse(r.body);
      manager(a);
      const result = await inTransaction(pool, async (c) => {
        const previous = await c.query<SettingsRow>(
          "select value,version from app_settings where settings_key='application' for update",
        );
        const p = previous.rows[0];
        if (!p)
          throw new AppError(500, "SETTINGS_UNAVAILABLE", "La configuración no está disponible.");
        if (p.version !== input.version)
          throw new AppError(
            409,
            "SETTINGS_VERSION_CONFLICT",
            "La configuración fue modificada por otra operación.",
          );
        return (
          await idempotentMutation(
            c,
            {
              actorUserId: a.userId,
              key: meta(r).idempotencyKey,
              operation: "settings.update",
              request: input,
              statusCode: 200,
            },
            async () => {
              const value = { ...p.value, ...input };
              delete (value as Record<string, unknown>).version;
              const updated = await c.query<SettingsRow>(
                "update app_settings set value=$1,version=version+1,updated_at=now(),updated_by=$2 where settings_key='application' returning value,version",
                [value, a.userId],
              );
              const response = appSettingsSchema.parse({
                ...updated.rows[0]!.value,
                version: updated.rows[0]!.version,
              });
              await writeAudit(c, {
                actorUserId: a.userId,
                action: "SETTINGS_UPDATED",
                entityType: "app_settings",
                requestId: meta(r).requestId,
                deviceId: a.deviceId,
                ipAddress: meta(r).ipAddress,
                before: { version: p.version },
                after: {
                  version: response.version,
                  changedFields: Object.keys(input).filter((k) => k !== "version"),
                },
              });
              return response;
            },
          )
        ).value;
      });
      s.json(result);
    } catch (e) {
      n(e);
    }
  });
  return router;
}
