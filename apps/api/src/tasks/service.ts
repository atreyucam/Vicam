import { randomUUID } from "node:crypto";
import {
  type cancelTaskRequestSchema,
  type completeTaskRequestSchema,
  type createTaskRequestSchema,
  taskDetailSchema,
  type tasksQuerySchema,
  tasksPageSchema,
  type updateTaskRequestSchema,
} from "@vicam/contracts";
import type { z } from "zod";
import type { DbClient, DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { CountCache } from "../domain/count-cache.js";
import { mapTask } from "../domain/rows.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { assertCanAssign, pagination } from "../domain/shared.js";
import { AppError } from "../errors.js";
type Query = z.infer<typeof tasksQuerySchema>;
type Create = z.infer<typeof createTaskRequestSchema>;
type Update = z.infer<typeof updateTaskRequestSchema>;
type Complete = z.infer<typeof completeTaskRequestSchema>;
type Cancel = z.infer<typeof cancelTaskRequestSchema>;
const select = `select t.*,a.display_name account_display_name,u.full_name responsible_full_name,
 linked_visit.scheduled_at visit_scheduled_at,linked_visit.reason visit_reason,
 (t.status in ('PENDING','IN_PROGRESS') and ((t.due_date + coalesce(t.due_time,time '23:59:59')) at time zone t.timezone) < now()) overdue
 from tasks t join commercial_accounts a on a.id=t.account_id join users u on u.id=t.responsible_user_id
 left join visits linked_visit on linked_visit.id=t.visit_id`;

async function lockTaskAccounts(
  client: DbClient,
  taskId: string,
  targetAccountId: string | undefined,
  actor: Actor,
): Promise<void> {
  const task = await client.query<{ account_id: string }>(
    "select account_id from tasks where id=$1",
    [taskId],
  );
  const currentAccountId = task.rows[0]?.account_id;
  if (currentAccountId === undefined) {
    throw new AppError(404, "TASK_NOT_FOUND", "La tarea no está disponible.");
  }
  const ids = [
    ...new Set([currentAccountId, targetAccountId].filter((id): id is string => id !== undefined)),
  ].sort();
  const accounts = await client.query<{ id: string; owner_user_id: string }>(
    `select id,owner_user_id from commercial_accounts
     where id=any($1::uuid[]) order by id for update`,
    [ids],
  );
  if (accounts.rows.length !== ids.length) {
    throw new AppError(404, "TASK_NOT_FOUND", "La tarea no está disponible.");
  }
  if (
    actor.role === "SUPERVISOR" &&
    accounts.rows.some((account) => account.owner_user_id !== actor.userId)
  ) {
    throw new AppError(404, "TASK_NOT_FOUND", "La tarea no está disponible.");
  }
}
async function validate(
  client: DbClient,
  accountId: string,
  visitId: string | null | undefined,
  responsibleId: string,
  timezone: string,
  actor: Actor,
) {
  assertCanAssign(actor, responsibleId);
  const a = await client.query<{ owner_user_id: string; status: string }>(
    "select owner_user_id,status from commercial_accounts where id=$1 for update",
    [accountId],
  );
  const responsible = await client.query(
    "select id from users where id=$1 and status='ACTIVE' for share",
    [responsibleId],
  );
  if (!a.rows[0] || a.rows[0].status !== "ACTIVE" || responsible.rows[0] === undefined)
    throw new AppError(
      422,
      "INVALID_TASK_ASSIGNMENT",
      "La cuenta y el responsable deben estar activos.",
    );
  if (actor.role === "SUPERVISOR" && a.rows[0].owner_user_id !== actor.userId)
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "La cuenta no está disponible.");
  if (visitId) {
    const v = await client.query("select id from visits where id=$1 and account_id=$2", [
      visitId,
      accountId,
    ]);
    if (!v.rows[0])
      throw new AppError(
        422,
        "TASK_VISIT_ACCOUNT_MISMATCH",
        "La visita debe pertenecer a la misma cuenta.",
      );
  }
  const tz = await client.query("select 1 from pg_timezone_names where name=$1", [timezone]);
  if (!tz.rows[0]) throw new AppError(422, "INVALID_TIMEZONE", "La zona horaria no es válida.");
}
async function reminders(
  client: DbClient,
  id: string,
  version: number,
  dueDate: string,
  dueTime: string | null | undefined,
  timezone: string,
) {
  const instant = await client.query<{ due_at: Date }>(
    "select (($1::date+coalesce($2::time,time '23:59:59')) at time zone $3) due_at",
    [dueDate, dueTime ?? null, timezone],
  );
  const due = instant.rows[0]!.due_at;
  const settings = await client.query<{ offsets: number[] }>(
    `select coalesce(
       array(select jsonb_array_elements_text(value->'taskReminderOffsetsMinutes')::integer),
       array[1440]
     ) offsets
     from app_settings where settings_key='application'`,
  );
  const offsets = settings.rows[0]?.offsets ?? [1440];
  for (const [name, at] of [
    ...[...new Set(offsets)].map(
      (minutes) => [`m${minutes}`, new Date(due.getTime() - minutes * 60_000)] as const,
    ),
    ["due", due] as const,
  ])
    if (at > new Date())
      await client.query(
        "insert into reminders(id,task_id,scheduled_at,job_key) values($1,$2,$3,$4)",
        [randomUUID(), id, at, `task:${id}:v${version}:${name}`],
      );
}
async function cancelReminders(client: DbClient, id: string) {
  await client.query(
    "update reminders set status='CANCELLED',cancelled_at=now(),updated_at=now() where task_id=$1 and status='PENDING'",
    [id],
  );
}

export async function createTaskInTransaction(
  client: DbClient,
  input: Create,
  actor: Actor,
  meta: RequestMeta,
  id: string = randomUUID(),
) {
  await validate(
    client,
    input.accountId,
    input.visitId,
    input.responsibleUserId,
    input.timezone,
    actor,
  );
  await client.query(
    `insert into tasks(id,account_id,visit_id,responsible_user_id,title,description,due_date,due_time,timezone,priority,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      id,
      input.accountId,
      input.visitId ?? null,
      input.responsibleUserId,
      input.title,
      input.description ?? null,
      input.dueDate,
      input.dueTime ?? null,
      input.timezone,
      input.priority,
      actor.userId,
    ],
  );
  await reminders(client, id, 1, input.dueDate, input.dueTime, input.timezone);
  await writeAudit(client, {
    actorUserId: actor.userId,
    action: "TASK_CREATED",
    entityType: "task",
    entityId: id,
    requestId: meta.requestId,
    deviceId: actor.deviceId,
    ipAddress: meta.ipAddress,
    after: {
      accountId: input.accountId,
      visitId: input.visitId ?? null,
      responsibleUserId: input.responsibleUserId,
      dueDate: input.dueDate,
      dueTime: input.dueTime ?? null,
      timezone: input.timezone,
      priority: input.priority,
      status: "PENDING",
      version: 1,
      changedFields: Object.keys(input),
    },
  });
  return id;
}

export class TasksService {
  private readonly countCache = new CountCache();

  constructor(private pool: DbPool) {}
  async list(q: Query, a: Actor) {
    const v: unknown[] = [];
    const w: string[] = [];
    if (a.role === "SUPERVISOR") {
      v.push(a.userId);
      w.push(`t.responsible_user_id=$${v.length} and a.owner_user_id=$${v.length}`);
    }
    for (const [key, col] of [
      ["responsibleUserId", "t.responsible_user_id"],
      ["accountId", "t.account_id"],
      ["visitId", "t.visit_id"],
      ["status", "t.status"],
      ["dueFrom", "t.due_date"],
      ["dueTo", "t.due_date"],
    ] as const) {
      const value = q[key];
      if (value !== undefined) {
        v.push(value);
        w.push(`${col}${key === "dueFrom" ? ">=" : key === "dueTo" ? "<=" : "="}$${v.length}`);
      }
    }
    const clause = w.length ? `where ${w.join(" and ")}` : "";
    const accountJoin =
      a.role === "SUPERVISOR" ? "join commercial_accounts a on a.id=t.account_id" : "";
    const countKey = JSON.stringify({
      role: a.role,
      userId: a.userId,
      filters: {
        responsibleUserId: q.responsibleUserId,
        accountId: q.accountId,
        visitId: q.visitId,
        status: q.status,
        dueFrom: q.dueFrom,
        dueTo: q.dueTo,
      },
    });
    const total = await this.countCache.get(
      countKey,
      async () =>
        (
          await this.pool.query<{ total: number }>(
            `select count(*)::integer total from tasks t ${accountJoin} ${clause}`,
            v,
          )
        ).rows[0]?.total ?? 0,
    );
    v.push(q.pageSize, (q.page - 1) * q.pageSize);
    const rows = await this.pool.query(
      `with page_ids as (
         select t.id from tasks t ${accountJoin} ${clause}
         order by t.due_date,t.due_time nulls last,t.id
         limit $${v.length - 1} offset $${v.length}
       )
       ${select} join page_ids p on p.id=t.id
       order by t.due_date,t.due_time nulls last,t.id`,
      v,
    );
    return tasksPageSchema.parse({
      items: rows.rows.map(mapTask),
      pagination: pagination(q.page, q.pageSize, total),
    });
  }
  async get(id: string, a: Actor, c: DbClient | DbPool = this.pool, lock = false) {
    const v: unknown[] = [id];
    let w = "t.id=$1";
    if (a.role === "SUPERVISOR") {
      v.push(a.userId);
      w += " and t.responsible_user_id=$2 and a.owner_user_id=$2";
    }
    const r = await c.query(`${select} where ${w}${lock ? " for update of t" : ""}`, v);
    if (!r.rows[0]) throw new AppError(404, "TASK_NOT_FOUND", "La tarea no está disponible.");
    return mapTask(r.rows[0] as Record<string, unknown>);
  }
  async getDetail(id: string, actor: Actor) {
    const task = await this.get(id, actor);
    const metadata = await this.pool.query<Record<string, unknown>>(
      `select t.created_at,creator.full_name created_by_full_name,
              completer.full_name completed_by_full_name,t.cancelled_at,
              canceller.full_name cancelled_by_full_name,t.cancellation_reason
       from tasks t
       left join users creator on creator.id=t.created_by
       left join users completer on completer.id=t.completed_by
       left join users canceller on canceller.id=t.cancelled_by
       where t.id=$1`,
      [id],
    );
    const row = metadata.rows[0]!;
    return taskDetailSchema.parse({
      ...task,
      createdAt: (row.created_at as Date).toISOString(),
      createdByFullName: row.created_by_full_name,
      completedByFullName: row.completed_by_full_name,
      cancelledAt: row.cancelled_at == null ? null : (row.cancelled_at as Date).toISOString(),
      cancelledByFullName: row.cancelled_by_full_name,
      cancellationReason: row.cancellation_reason,
    });
  }
  async create(i: Create, a: Actor, m: RequestMeta) {
    return inTransaction(
      this.pool,
      async (c) =>
        (
          await idempotentMutation(
            c,
            {
              actorUserId: a.userId,
              key: m.idempotencyKey,
              operation: "task.create",
              request: i,
              statusCode: 201,
            },
            async () => {
              const id = await createTaskInTransaction(c, i, a, m);
              return this.get(id, a, c);
            },
          )
        ).value,
    );
  }
  async update(id: string, i: Update, a: Actor, m: RequestMeta) {
    return inTransaction(
      this.pool,
      async (c) =>
        (
          await idempotentMutation(
            c,
            {
              actorUserId: a.userId,
              key: m.idempotencyKey,
              operation: `task.update:${id}`,
              request: i,
              statusCode: 200,
            },
            async () => {
              await lockTaskAccounts(c, id, i.accountId, a);
              const b = await this.get(id, a, c, true);
              if (["COMPLETED", "CANCELLED"].includes(b.status))
                throw new AppError(
                  409,
                  "TASK_STATE_CONFLICT",
                  "La tarea cerrada no se puede editar.",
                );
              const account = i.accountId ?? b.accountId,
                visit = "visitId" in i ? i.visitId : b.visitId,
                responsible = i.responsibleUserId ?? b.responsibleUserId,
                timezone = i.timezone ?? b.timezone;
              await validate(c, account, visit, responsible, timezone, a);
              const r = await c.query(
                `update tasks set account_id=coalesce($2,account_id),visit_id=case when $3::boolean then $4 else visit_id end,responsible_user_id=coalesce($5,responsible_user_id),title=coalesce($6,title),description=case when $7::boolean then $8 else description end,due_date=coalesce($9,due_date),due_time=case when $10::boolean then $11 else due_time end,timezone=coalesce($12,timezone),priority=coalesce($13,priority),status=coalesce($14,status),version=version+1,updated_at=now(),updated_by=$15 where id=$1 and version=$16 returning version`,
                [
                  id,
                  i.accountId ?? null,
                  "visitId" in i,
                  i.visitId ?? null,
                  i.responsibleUserId ?? null,
                  i.title ?? null,
                  "description" in i,
                  i.description ?? null,
                  i.dueDate ?? null,
                  "dueTime" in i,
                  i.dueTime ?? null,
                  i.timezone ?? null,
                  i.priority ?? null,
                  i.status ?? null,
                  a.userId,
                  i.version,
                ],
              );
              if (!r.rowCount)
                throw new AppError(
                  409,
                  "TASK_VERSION_CONFLICT",
                  "La tarea fue modificada por otra operación.",
                );
              await cancelReminders(c, id);
              const value = await this.get(id, a, c);
              if (["PENDING", "IN_PROGRESS"].includes(value.status))
                await reminders(c, id, value.version, value.dueDate, value.dueTime, value.timezone);
              await writeAudit(c, {
                actorUserId: a.userId,
                action: "TASK_UPDATED",
                entityType: "task",
                entityId: id,
                requestId: m.requestId,
                deviceId: a.deviceId,
                ipAddress: m.ipAddress,
                before: {
                  accountId: b.accountId,
                  visitId: b.visitId,
                  responsibleUserId: b.responsibleUserId,
                  dueDate: b.dueDate,
                  dueTime: b.dueTime,
                  timezone: b.timezone,
                  priority: b.priority,
                  status: b.status,
                  version: b.version,
                },
                after: {
                  accountId: value.accountId,
                  visitId: value.visitId,
                  responsibleUserId: value.responsibleUserId,
                  dueDate: value.dueDate,
                  dueTime: value.dueTime,
                  timezone: value.timezone,
                  priority: value.priority,
                  status: value.status,
                  version: value.version,
                  changedFields: Object.keys(i).filter((k) => k !== "version"),
                },
              });
              return value;
            },
          )
        ).value,
    );
  }
  async complete(id: string, i: Complete, a: Actor, m: RequestMeta) {
    return inTransaction(
      this.pool,
      async (c) =>
        (
          await idempotentMutation(
            c,
            {
              actorUserId: a.userId,
              key: m.idempotencyKey,
              operation: `task.complete:${id}`,
              request: i,
              statusCode: 200,
            },
            async () => {
              await lockTaskAccounts(c, id, undefined, a);
              const b = await this.get(id, a, c, true);
              if (!["PENDING", "IN_PROGRESS"].includes(b.status))
                throw new AppError(409, "TASK_STATE_CONFLICT", "La tarea ya está cerrada.");
              const r = await c.query(
                "update tasks set status='COMPLETED',completed_at=now(),completed_by=$2,version=version+1,updated_at=now(),updated_by=$2 where id=$1 and version=$3 returning id",
                [id, a.userId, i.version],
              );
              if (!r.rowCount)
                throw new AppError(
                  409,
                  "TASK_VERSION_CONFLICT",
                  "La tarea fue modificada por otra operación.",
                );
              await cancelReminders(c, id);
              const value = await this.get(id, a, c);
              await writeAudit(c, {
                actorUserId: a.userId,
                action: "TASK_COMPLETED",
                entityType: "task",
                entityId: id,
                requestId: m.requestId,
                deviceId: a.deviceId,
                ipAddress: m.ipAddress,
                before: { status: b.status, version: b.version },
                after: { status: value.status, version: value.version },
              });
              return value;
            },
          )
        ).value,
    );
  }

  async cancel(id: string, i: Cancel, a: Actor, m: RequestMeta) {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: a.userId,
              key: m.idempotencyKey,
              operation: `task.cancel:${id}`,
              request: i,
              statusCode: 200,
            },
            async () => {
              await lockTaskAccounts(client, id, undefined, a);
              const before = await this.get(id, a, client, true);
              if (!["PENDING", "IN_PROGRESS"].includes(before.status)) {
                throw new AppError(409, "TASK_STATE_CONFLICT", "La tarea ya está cerrada.");
              }
              const updated = await client.query(
                `update tasks set status='CANCELLED',cancelled_at=now(),cancelled_by=$2,
                   cancellation_reason=$3,version=version+1,updated_at=now(),updated_by=$2
                 where id=$1 and version=$4 returning id`,
                [id, a.userId, i.reason, i.version],
              );
              if (!updated.rowCount) {
                throw new AppError(
                  409,
                  "TASK_VERSION_CONFLICT",
                  "La tarea fue modificada por otra operación.",
                );
              }
              await cancelReminders(client, id);
              const value = await this.get(id, a, client);
              await writeAudit(client, {
                actorUserId: a.userId,
                action: "TASK_CANCELLED",
                entityType: "task",
                entityId: id,
                requestId: m.requestId,
                deviceId: a.deviceId,
                ipAddress: m.ipAddress,
                before: { status: before.status, version: before.version },
                after: { status: value.status, version: value.version, reasonProvided: true },
              });
              return value;
            },
          )
        ).value,
    );
  }
}
