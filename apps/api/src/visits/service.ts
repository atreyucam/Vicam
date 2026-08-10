import { randomUUID } from "node:crypto";
import {
  type cancelVisitRequestSchema,
  type completeVisitRequestSchema,
  type createVisitRequestSchema,
  type rescheduleVisitRequestSchema,
  type updateVisitRequestSchema,
  visitDetailSchema,
  visitHistoryEventSchema,
  type visitsQuerySchema,
  visitsPageSchema,
} from "@vicam/contracts";
import type { z } from "zod";
import type { DbClient, DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { CountCache } from "../domain/count-cache.js";
import { mapVisit } from "../domain/rows.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { assertCanAssign, pagination } from "../domain/shared.js";
import { AppError } from "../errors.js";
import { createTaskInTransaction } from "../tasks/service.js";

type Query = z.infer<typeof visitsQuerySchema>;
type Create = z.infer<typeof createVisitRequestSchema>;
type Update = z.infer<typeof updateVisitRequestSchema>;
type Reschedule = z.infer<typeof rescheduleVisitRequestSchema>;
type Cancel = z.infer<typeof cancelVisitRequestSchema>;
type Complete = z.infer<typeof completeVisitRequestSchema>;
const select = `select v.*,a.display_name account_display_name,u.full_name responsible_full_name from visits v join commercial_accounts a on a.id=v.account_id join users u on u.id=v.responsible_user_id`;

async function lockVisitAccount(client: DbClient, visitId: string, actor: Actor): Promise<void> {
  const result = await client.query<{ owner_user_id: string }>(
    `select a.owner_user_id
     from commercial_accounts a join visits v on v.account_id=a.id
     where v.id=$1
     for update of a`,
    [visitId],
  );
  const row = result.rows[0];
  if (row === undefined || (actor.role === "SUPERVISOR" && row.owner_user_id !== actor.userId)) {
    throw new AppError(404, "VISIT_NOT_FOUND", "La visita no está disponible.");
  }
}

async function validateTimezone(client: DbClient, timezone: string) {
  const r = await client.query("select 1 from pg_timezone_names where name=$1", [timezone]);
  if (r.rows[0] === undefined)
    throw new AppError(422, "INVALID_TIMEZONE", "La zona horaria no es válida.");
}
async function validateAssignment(
  client: DbClient,
  accountId: string,
  responsibleId: string,
  actor: Actor,
) {
  assertCanAssign(actor, responsibleId);
  const result = await client.query<{ owner_user_id: string; status: string }>(
    "select owner_user_id,status from commercial_accounts where id=$1 for update",
    [accountId],
  );
  const row = result.rows[0];
  const responsible = await client.query(
    "select id from users where id=$1 and status='ACTIVE' for share",
    [responsibleId],
  );
  if (row === undefined || row.status !== "ACTIVE" || responsible.rows[0] === undefined)
    throw new AppError(
      422,
      "INVALID_VISIT_ASSIGNMENT",
      "La cuenta y el responsable deben estar activos.",
    );
  if (actor.role === "SUPERVISOR" && row.owner_user_id !== actor.userId)
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "La cuenta no está disponible.");
}
export async function createVisitRemindersInTransaction(
  client: DbClient,
  visitId: string,
  version: number,
  scheduledAt: Date,
) {
  const settings = await client.query<{ offsets: number[] }>(
    `select coalesce(
       array(select jsonb_array_elements_text(value->'visitReminderOffsetsMinutes')::integer),
       array[1440,60]
     ) offsets
     from app_settings where settings_key='application'`,
  );
  const offsets = settings.rows[0]?.offsets ?? [1440, 60];
  for (const minutes of [...new Set(offsets)]) {
    const at = new Date(scheduledAt.getTime() - minutes * 60_000);
    if (at > new Date())
      await client.query(
        "insert into reminders(id,visit_id,scheduled_at,job_key) values($1,$2,$3,$4)",
        [randomUUID(), visitId, at, `visit:${visitId}:v${version}:m${minutes}`],
      );
  }
}
export async function cancelVisitRemindersInTransaction(client: DbClient, visitId: string) {
  await client.query(
    "update reminders set status='CANCELLED',cancelled_at=now(),updated_at=now() where visit_id=$1 and status='PENDING'",
    [visitId],
  );
}

export class VisitsService {
  private readonly countCache = new CountCache();

  constructor(private pool: DbPool) {}
  async list(query: Query, actor: Actor) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      where.push(`v.responsible_user_id=$${values.length} and a.owner_user_id=$${values.length}`);
    }
    if (query.responsibleUserId) {
      values.push(query.responsibleUserId);
      where.push(`v.responsible_user_id=$${values.length}`);
    }
    if (query.accountId) {
      values.push(query.accountId);
      where.push(`v.account_id=$${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`v.status=$${values.length}`);
    }
    if (query.from) {
      values.push(query.from);
      where.push(`v.scheduled_at >= $${values.length}`);
    }
    if (query.to) {
      values.push(query.to);
      where.push(`v.scheduled_at <= $${values.length}`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";
    const accountJoin =
      actor.role === "SUPERVISOR" ? "join commercial_accounts a on a.id=v.account_id" : "";
    const countKey = JSON.stringify({
      role: actor.role,
      userId: actor.userId,
      filters: {
        responsibleUserId: query.responsibleUserId,
        accountId: query.accountId,
        status: query.status,
        from: query.from,
        to: query.to,
      },
    });
    const total = await this.countCache.get(
      countKey,
      async () =>
        (
          await this.pool.query<{ total: number }>(
            `select count(*)::integer total from visits v ${accountJoin} ${clause}`,
            values,
          )
        ).rows[0]?.total ?? 0,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.pool.query(
      `with page_ids as (
         select v.id from visits v ${accountJoin} ${clause}
         order by v.scheduled_at,v.id
         limit $${values.length - 1} offset $${values.length}
       )
       ${select} join page_ids p on p.id=v.id
       order by v.scheduled_at,v.id`,
      values,
    );
    return visitsPageSchema.parse({
      items: rows.rows.map(mapVisit),
      pagination: pagination(query.page, query.pageSize, total),
    });
  }
  async get(id: string, actor: Actor, client: DbClient | DbPool = this.pool, lock = false) {
    const values: unknown[] = [id];
    let where = "v.id=$1";
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      where += ` and v.responsible_user_id=$2 and a.owner_user_id=$2`;
    }
    const r = await client.query(
      `${select} where ${where}${lock ? " for update of v" : ""}`,
      values,
    );
    if (!r.rows[0]) throw new AppError(404, "VISIT_NOT_FOUND", "La visita no está disponible.");
    return mapVisit(r.rows[0] as Record<string, unknown>);
  }

  async history(id: string, actor: Actor) {
    await this.get(id, actor);
    const rows = await this.pool.query<Record<string, unknown>>(
      `select event_id,event_type,occurred_at,actor_user_id,actor_full_name,scheduled_at,
              old_scheduled_at,new_scheduled_at,reason,result
       from (
         select v.id::text||':created' event_id,'CREATED'::text event_type,v.created_at occurred_at,
                v.created_by actor_user_id,creator.full_name actor_full_name,
                coalesce((select first_reschedule.old_scheduled_at from visit_reschedules first_reschedule
                          where first_reschedule.visit_id=v.id
                          order by first_reschedule.created_at,first_reschedule.id limit 1),v.scheduled_at) scheduled_at,
                null::timestamptz old_scheduled_at,null::timestamptz new_scheduled_at,
                null::text reason,null::text result
         from visits v left join users creator on creator.id=v.created_by where v.id=$1
         union all
         select vr.id::text,'RESCHEDULED',vr.created_at,vr.actor_user_id,rescheduler.full_name,null,
                vr.old_scheduled_at,vr.new_scheduled_at,vr.reason,null
         from visit_reschedules vr join users rescheduler on rescheduler.id=vr.actor_user_id
         where vr.visit_id=$1
         union all
         select v.id::text||':completed','COMPLETED',v.completed_at,v.completed_by,
                completer.full_name,null,null,null,null,v.result::text
         from visits v left join users completer on completer.id=v.completed_by
         where v.id=$1 and v.status='COMPLETED'
         union all
         select v.id::text||':cancelled','CANCELLED',v.cancelled_at,v.cancelled_by,
                canceller.full_name,null,null,null,v.cancellation_reason,null
         from visits v left join users canceller on canceller.id=v.cancelled_by
         where v.id=$1 and v.status='CANCELLED'
       ) history
       order by occurred_at,event_id`,
      [id],
    );
    return rows.rows.map((row) =>
      visitHistoryEventSchema.parse({
        id: row.event_id,
        type: row.event_type,
        occurredAt: (row.occurred_at as Date).toISOString(),
        actorUserId: row.actor_user_id,
        actorFullName: row.actor_full_name,
        scheduledAt: row.scheduled_at == null ? null : (row.scheduled_at as Date).toISOString(),
        oldScheduledAt:
          row.old_scheduled_at == null ? null : (row.old_scheduled_at as Date).toISOString(),
        newScheduledAt:
          row.new_scheduled_at == null ? null : (row.new_scheduled_at as Date).toISOString(),
        reason: row.reason,
        result: row.result,
      }),
    );
  }

  async getDetail(id: string, actor: Actor) {
    const visit = await this.get(id, actor);
    const [metadata, history] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `select v.created_at,creator.full_name created_by_full_name,
                v.completed_at,completer.full_name completed_by_full_name,
                v.cancelled_at,canceller.full_name cancelled_by_full_name
         from visits v
         left join users creator on creator.id=v.created_by
         left join users completer on completer.id=v.completed_by
         left join users canceller on canceller.id=v.cancelled_by
         where v.id=$1`,
        [id],
      ),
      this.history(id, actor),
    ]);
    const row = metadata.rows[0]!;
    return visitDetailSchema.parse({
      ...visit,
      createdAt: (row.created_at as Date).toISOString(),
      createdByFullName: row.created_by_full_name,
      completedAt: row.completed_at == null ? null : (row.completed_at as Date).toISOString(),
      completedByFullName: row.completed_by_full_name,
      cancelledAt: row.cancelled_at == null ? null : (row.cancelled_at as Date).toISOString(),
      cancelledByFullName: row.cancelled_by_full_name,
      history,
    });
  }
  async create(input: Create, actor: Actor, meta: RequestMeta) {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: "visit.create",
              request: input,
              statusCode: 201,
            },
            async () => {
              await validateTimezone(client, input.timezone);
              await validateAssignment(client, input.accountId, input.responsibleUserId, actor);
              const id = randomUUID();
              await client.query(
                `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,notes,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
                [
                  id,
                  input.accountId,
                  input.responsibleUserId,
                  input.scheduledAt,
                  input.timezone,
                  input.reason,
                  input.priority,
                  input.notes ?? null,
                  actor.userId,
                ],
              );
              await createVisitRemindersInTransaction(client, id, 1, new Date(input.scheduledAt));
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "VISIT_CREATED",
                entityType: "visit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                after: {
                  accountId: input.accountId,
                  responsibleUserId: input.responsibleUserId,
                  scheduledAt: input.scheduledAt,
                  timezone: input.timezone,
                  priority: input.priority,
                  status: "PENDING",
                  version: 1,
                  changedFields: Object.keys(input),
                },
              });
              return this.get(id, actor, client);
            },
          )
        ).value,
    );
  }
  async update(id: string, input: Update, actor: Actor, meta: RequestMeta) {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `visit.update:${id}`,
              request: input,
              statusCode: 200,
            },
            async () => {
              await lockVisitAccount(client, id, actor);
              const before = await this.get(id, actor, client, true);
              if (before.status !== "PENDING")
                throw new AppError(
                  409,
                  "VISIT_STATE_CONFLICT",
                  "Solo se puede editar una visita pendiente.",
                );
              const r = await client.query<{ version: number }>(
                `update visits set reason=coalesce($2,reason),priority=coalesce($3,priority),notes=case when $4::boolean then $5 else notes end,version=version+1,updated_at=now(),updated_by=$6 where id=$1 and version=$7 returning id`,
                [
                  id,
                  input.reason ?? null,
                  input.priority ?? null,
                  "notes" in input,
                  input.notes ?? null,
                  actor.userId,
                  input.version,
                ],
              );
              if (!r.rowCount)
                throw new AppError(
                  409,
                  "VISIT_VERSION_CONFLICT",
                  "La visita fue modificada por otra operación.",
                );
              const value = await this.get(id, actor, client);
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "VISIT_UPDATED",
                entityType: "visit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before: {
                  priority: before.priority,
                  status: before.status,
                  version: before.version,
                },
                after: {
                  priority: value.priority,
                  status: value.status,
                  version: value.version,
                  changedFields: Object.keys(input).filter((k) => k !== "version"),
                },
              });
              return value;
            },
          )
        ).value,
    );
  }
  async reschedule(id: string, input: Reschedule, actor: Actor, meta: RequestMeta) {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `visit.reschedule:${id}`,
              request: input,
              statusCode: 200,
            },
            async () => {
              await lockVisitAccount(client, id, actor);
              const before = await this.get(id, actor, client, true);
              if (before.status !== "PENDING")
                throw new AppError(
                  409,
                  "VISIT_STATE_CONFLICT",
                  "Solo se puede reprogramar una visita pendiente.",
                );
              await validateTimezone(client, input.timezone);
              if (
                before.scheduledAt === new Date(input.scheduledAt).toISOString() &&
                before.timezone === input.timezone
              ) {
                throw new AppError(
                  422,
                  "VISIT_RESCHEDULE_UNCHANGED",
                  "La nueva fecha u hora debe ser diferente de la programación actual.",
                );
              }
              const r = await client.query<{ version: number }>(
                "update visits set scheduled_at=$2,timezone=$3,version=version+1,updated_at=now(),updated_by=$4 where id=$1 and version=$5 returning version",
                [id, input.scheduledAt, input.timezone, actor.userId, input.version],
              );
              if (!r.rowCount)
                throw new AppError(
                  409,
                  "VISIT_VERSION_CONFLICT",
                  "La visita fue modificada por otra operación.",
                );
              await client.query(
                `insert into visit_reschedules(id,visit_id,old_scheduled_at,new_scheduled_at,old_timezone,new_timezone,reason,actor_user_id) values($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                  randomUUID(),
                  id,
                  before.scheduledAt,
                  input.scheduledAt,
                  before.timezone,
                  input.timezone,
                  input.reason,
                  actor.userId,
                ],
              );
              await cancelVisitRemindersInTransaction(client, id);
              await createVisitRemindersInTransaction(
                client,
                id,
                r.rows[0]!.version,
                new Date(input.scheduledAt),
              );
              const value = await this.get(id, actor, client);
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "VISIT_RESCHEDULED",
                entityType: "visit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before: {
                  scheduledAt: before.scheduledAt,
                  timezone: before.timezone,
                  version: before.version,
                },
                after: {
                  scheduledAt: value.scheduledAt,
                  timezone: value.timezone,
                  version: value.version,
                  reasonProvided: true,
                },
              });
              return value;
            },
          )
        ).value,
    );
  }
  async cancel(id: string, input: Cancel, actor: Actor, meta: RequestMeta) {
    return this.finish(id, input, actor, meta, "cancel");
  }
  async complete(id: string, input: Complete, actor: Actor, meta: RequestMeta) {
    if (input.actualStartedAt && new Date(input.actualStartedAt) > new Date(input.actualEndedAt))
      throw new AppError(
        422,
        "INVALID_ACTUAL_RANGE",
        "La hora de inicio no puede ser posterior al cierre.",
      );
    return this.finish(id, input, actor, meta, "complete");
  }
  private async finish(
    id: string,
    input: Cancel | Complete,
    actor: Actor,
    meta: RequestMeta,
    action: "cancel" | "complete",
  ) {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `visit.${action}:${id}`,
              request: input,
              statusCode: 200,
            },
            async () => {
              await lockVisitAccount(client, id, actor);
              const before = await this.get(id, actor, client, true);
              if (before.status !== "PENDING")
                throw new AppError(409, "VISIT_STATE_CONFLICT", "La visita ya no está pendiente.");
              const complete = action === "complete";
              const r = complete
                ? await client.query(
                    `update visits set status='COMPLETED',observation=$2,result=$3,actual_started_at=$4,actual_ended_at=$5,completed_at=now(),completed_by=$6,version=version+1,updated_at=now(),updated_by=$6 where id=$1 and version=$7 returning id`,
                    [
                      id,
                      (input as Complete).observation,
                      (input as Complete).result,
                      (input as Complete).actualStartedAt ?? null,
                      (input as Complete).actualEndedAt,
                      actor.userId,
                      input.version,
                    ],
                  )
                : await client.query(
                    `update visits set status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancellation_reason=$2,version=version+1,updated_at=now(),updated_by=$3 where id=$1 and version=$4 returning id`,
                    [id, (input as Cancel).reason, actor.userId, input.version],
                  );
              if (!r.rowCount)
                throw new AppError(
                  409,
                  "VISIT_VERSION_CONFLICT",
                  "La visita fue modificada por otra operación.",
                );
              if (complete && (input as Complete).followUpTask) {
                const followUp = (input as Complete).followUpTask!;
                await createTaskInTransaction(
                  client,
                  {
                    accountId: before.accountId,
                    visitId: id,
                    responsibleUserId: followUp.responsibleUserId,
                    title: followUp.title,
                    dueDate: followUp.dueDate,
                    timezone: before.timezone,
                    priority: followUp.priority,
                  },
                  actor,
                  meta,
                  followUp.id,
                );
              }
              await cancelVisitRemindersInTransaction(client, id);
              const value = await this.get(id, actor, client);
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: complete ? "VISIT_COMPLETED" : "VISIT_CANCELLED",
                entityType: "visit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before: {
                  scheduledAt: before.scheduledAt,
                  timezone: before.timezone,
                  status: before.status,
                  version: before.version,
                },
                after: {
                  scheduledAt: value.scheduledAt,
                  timezone: value.timezone,
                  status: value.status,
                  ...(complete && { result: (input as Complete).result }),
                  version: value.version,
                  ...(!complete && { reasonProvided: true }),
                },
              });
              return value;
            },
          )
        ).value,
    );
  }
}
