import { randomUUID } from "node:crypto";

import {
  accountsQuerySchema,
  commercialAccountSummarySchema,
  commercialAccountsPageSchema,
  type createCommercialAccountRequestSchema,
  type createCommercialContactRequestSchema,
  type updateCommercialAccountRequestSchema,
  type updateCommercialContactRequestSchema,
} from "@vicam/contracts";
import type { z } from "zod";

import type { DbClient, DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { CountCache } from "../domain/count-cache.js";
import { AppError } from "../errors.js";
import { mapAccount, mapContact } from "../domain/rows.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { assertCanAssign, normalizeSearch, pagination } from "../domain/shared.js";

type AccountsQuery = z.infer<typeof accountsQuerySchema>;
type CreateAccount = z.infer<typeof createCommercialAccountRequestSchema>;
type UpdateAccount = z.infer<typeof updateCommercialAccountRequestSchema>;
type CreateContact = z.infer<typeof createCommercialContactRequestSchema>;
type UpdateContact = z.infer<typeof updateCommercialContactRequestSchema>;

const accountSelect = `select a.*,u.full_name owner_full_name,
  (select c.full_name from commercial_contacts c where c.account_id=a.id and c.is_primary and c.deleted_at is null) primary_contact_name,
  coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.normalized_name,f.id)
    from commercial_account_fruits af join fruits f on f.id=af.fruit_id where af.account_id=a.id),'[]'::jsonb) fruits
  from commercial_accounts a join users u on u.id=a.owner_user_id`;

const gpsKeys = ["latitude", "longitude", "locationSource", "locationCapturedAt"] as const;

function gpsValues(
  input: Pick<CreateAccount, (typeof gpsKeys)[number]> | UpdateAccount,
  actor: Actor,
  requiredGroup: boolean,
) {
  const touched = gpsKeys.some((key) => key in input);
  if (!touched) {
    return requiredGroup
      ? {
          latitude: null,
          longitude: null,
          locationSource: null,
          locationCapturedAt: null,
          locationCapturedBy: null,
        }
      : undefined;
  }
  if (!("latitude" in input) || !("longitude" in input)) {
    throw new AppError(
      422,
      "GPS_COORDINATES_REQUIRED",
      "La latitud y longitud deben enviarse juntas.",
    );
  }
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) {
    throw new AppError(
      422,
      "GPS_COORDINATES_REQUIRED",
      "La latitud y longitud deben enviarse juntas.",
    );
  }
  if (latitude === null) {
    if (input.locationSource != null || input.locationCapturedAt != null) {
      throw new AppError(
        422,
        "GPS_METADATA_WITHOUT_COORDINATES",
        "No se admite metadata GPS sin coordenadas.",
      );
    }
    return {
      latitude: null,
      longitude: null,
      locationSource: null,
      locationCapturedAt: null,
      locationCapturedBy: null,
    };
  }
  if (input.locationSource == null) {
    throw new AppError(422, "GPS_SOURCE_REQUIRED", "La fuente de la ubicación GPS es obligatoria.");
  }
  return {
    latitude,
    longitude,
    locationSource: input.locationSource,
    locationCapturedAt: input.locationCapturedAt ?? new Date().toISOString(),
    locationCapturedBy: actor.userId,
  };
}

async function replaceFruits(
  client: DbClient,
  accountId: string,
  fruitIds: string[],
  actorUserId: string,
): Promise<void> {
  const uniqueIds = [...new Set(fruitIds)];
  if (uniqueIds.length !== fruitIds.length) {
    throw new AppError(
      422,
      "DUPLICATE_ACCOUNT_FRUIT",
      "Una fruta no puede seleccionarse dos veces.",
    );
  }
  if (uniqueIds.length > 0) {
    const active = await client.query<{ id: string }>(
      "select id from fruits where id=any($1::uuid[]) and active for share",
      [uniqueIds],
    );
    if (active.rows.length !== uniqueIds.length) {
      throw new AppError(
        422,
        "INVALID_ACCOUNT_FRUIT",
        "Todas las frutas seleccionadas deben estar activas.",
      );
    }
  }
  await client.query("delete from commercial_account_fruits where account_id=$1", [accountId]);
  if (uniqueIds.length > 0) {
    await client.query(
      `insert into commercial_account_fruits(account_id,fruit_id,created_by)
       select $1,id,$3 from unnest($2::uuid[]) as selected(id)`,
      [accountId, uniqueIds, actorUserId],
    );
  }
}

async function activeOwner(client: DbClient, ownerUserId: string): Promise<void> {
  const result = await client.query(
    "select id from users where id=$1 and status='ACTIVE' for share",
    [ownerUserId],
  );
  if (result.rows[0] === undefined)
    throw new AppError(422, "INVALID_ACCOUNT_OWNER", "El responsable debe ser un usuario activo.");
}

export class AccountsService {
  private readonly countCache = new CountCache();

  constructor(private readonly pool: DbPool) {}

  async list(query: AccountsQuery, actor: Actor) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      where.push(`a.owner_user_id=$${values.length}`);
    }
    if (query.search !== undefined) {
      values.push(`%${normalizeSearch(query.search)}%`);
      where.push(`a.normalized_display_name like $${values.length}`);
    }
    if (query.status !== undefined) {
      values.push(query.status);
      where.push(`a.status=$${values.length}`);
    }
    if (query.ownerUserId !== undefined) {
      values.push(query.ownerUserId);
      where.push(`a.owner_user_id=$${values.length}`);
    }
    if (query.city !== undefined) {
      values.push(query.city);
      where.push(`a.city=$${values.length}`);
    }
    const clause = where.length === 0 ? "" : `where ${where.join(" and ")}`;
    const countKey = JSON.stringify({
      role: actor.role,
      userId: actor.userId,
      filters: {
        search: query.search,
        status: query.status,
        ownerUserId: query.ownerUserId,
        city: query.city,
      },
    });
    const total = await this.countCache.get(
      countKey,
      async () =>
        (
          await this.pool.query<{ total: number }>(
            `select count(*)::integer total from commercial_accounts a ${clause}`,
            values,
          )
        ).rows[0]?.total ?? 0,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `with page_ids as (
         select a.id from commercial_accounts a ${clause}
         order by a.normalized_display_name,a.id
         limit $${values.length - 1} offset $${values.length}
       )
       ${accountSelect} join page_ids p on p.id=a.id
       order by a.normalized_display_name,a.id`,
      values,
    );
    return commercialAccountsPageSchema.parse({
      items: result.rows.map(mapAccount),
      pagination: pagination(query.page, query.pageSize, total),
    });
  }

  async get(id: string, actor: Actor, client: DbClient | DbPool = this.pool, lock = false) {
    const values: unknown[] = [id];
    let visible = "a.id=$1";
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      visible += " and a.owner_user_id=$2";
    }
    const result = await client.query<Record<string, unknown>>(
      `${accountSelect} where ${visible}${lock ? " for update of a" : ""}`,
      values,
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "La cuenta no está disponible.");
    return mapAccount(row);
  }

  async commercialSummary(id: string, actor: Actor) {
    await this.get(id, actor);
    const values: unknown[] = [id];
    const visitVisibility = ["v.account_id=$1"];
    const taskVisibility = ["t.account_id=$1"];
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      visitVisibility.push("v.responsible_user_id=$2");
      taskVisibility.push("t.responsible_user_id=$2");
    }
    const visitWhere = visitVisibility.join(" and ");
    const taskWhere = taskVisibility.join(" and ");
    const [nextVisit, taskCounts, activity] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `select v.id,v.scheduled_at,v.reason,u.full_name responsible_full_name,v.priority
         from visits v join users u on u.id=v.responsible_user_id
         where ${visitWhere} and v.status='PENDING' and v.scheduled_at>=now()
         order by v.scheduled_at,v.id limit 1`,
        values,
      ),
      this.pool.query<{ open_task_count: number; due_today_task_count: number }>(
        `select count(*) filter(where t.status in ('PENDING','IN_PROGRESS'))::integer open_task_count,
                count(*) filter(where t.status in ('PENDING','IN_PROGRESS')
                  and t.due_date=(now() at time zone 'America/Guayaquil')::date)::integer due_today_task_count
         from tasks t where ${taskWhere}`,
        values,
      ),
      this.pool.query<Record<string, unknown>>(
        `select activity_id,activity_type,occurred_at,title,description,resource_type,resource_id
         from (
           select v.id::text||':created' activity_id,'VISIT_CREATED'::text activity_type,
                  v.created_at occurred_at,'Visita agendada'::text title,v.reason description,
                  'VISIT'::text resource_type,v.id resource_id
           from visits v where ${visitWhere}
           union all
           select vr.id::text,'VISIT_RESCHEDULED',vr.created_at,'Visita reprogramada',vr.reason,'VISIT',v.id
           from visit_reschedules vr join visits v on v.id=vr.visit_id where ${visitWhere}
           union all
           select v.id::text||':completed','VISIT_COMPLETED',v.completed_at,'Visita completada',
                  left(v.reason||case when v.result is null then '' else ' · Resultado: '||v.result::text end,2000),'VISIT',v.id
           from visits v where ${visitWhere} and v.status='COMPLETED'
           union all
           select v.id::text||':cancelled','VISIT_CANCELLED',v.cancelled_at,'Visita cancelada',
                  v.cancellation_reason,'VISIT',v.id
           from visits v where ${visitWhere} and v.status='CANCELLED'
           union all
           select t.id::text||':created','TASK_CREATED',t.created_at,t.title,t.description,'TASK',t.id
           from tasks t where ${taskWhere}
           union all
           select t.id::text||':completed','TASK_COMPLETED',t.completed_at,t.title,t.description,'TASK',t.id
           from tasks t where ${taskWhere} and t.status='COMPLETED'
         ) recent
         order by occurred_at desc,activity_id desc limit 10`,
        values,
      ),
    ]);
    const next = nextVisit.rows[0];
    const counts = taskCounts.rows[0];
    return commercialAccountSummarySchema.parse({
      nextVisit:
        next == null
          ? null
          : {
              id: next.id,
              scheduledAt: (next.scheduled_at as Date).toISOString(),
              reason: next.reason,
              responsibleFullName: next.responsible_full_name,
              priority: next.priority,
            },
      openTaskCount: counts?.open_task_count ?? 0,
      dueTodayTaskCount: counts?.due_today_task_count ?? 0,
      recentActivity: activity.rows.map((row) => ({
        id: row.activity_id,
        type: row.activity_type,
        occurredAt: (row.occurred_at as Date).toISOString(),
        title: row.title,
        description: row.description,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
      })),
    });
  }

  async create(input: CreateAccount, actor: Actor, meta: RequestMeta) {
    assertCanAssign(actor, input.ownerUserId);
    return inTransaction(this.pool, async (client) => {
      const result = await idempotentMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: "account.create",
          request: input,
          statusCode: 201,
        },
        async () => {
          await activeOwner(client, input.ownerUserId);
          const gps = gpsValues(input, actor, true)!;
          const id = randomUUID();
          await client.query(
            `insert into commercial_accounts
             (id,display_name,normalized_display_name,legal_name,account_type,owner_user_id,country_code,state_province,city,address,postal_code,phone,email,timezone,
              latitude,longitude,location_source,location_captured_at,location_captured_by,created_by,updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`,
            [
              id,
              input.displayName,
              normalizeSearch(input.displayName),
              input.legalName ?? null,
              input.accountType,
              input.ownerUserId,
              input.countryCode,
              input.stateProvince ?? null,
              input.city,
              input.address ?? null,
              input.postalCode ?? null,
              input.phone ?? null,
              input.email ?? null,
              input.timezone ?? null,
              gps.latitude,
              gps.longitude,
              gps.locationSource,
              gps.locationCapturedAt,
              gps.locationCapturedBy,
              actor.userId,
            ],
          );
          await replaceFruits(client, id, input.fruitIds, actor.userId);
          const value = await this.get(id, actor, client);
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "ACCOUNT_CREATED",
            entityType: "commercial_account",
            entityId: id,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            after: {
              ownerUserId: value.ownerUserId,
              status: value.status,
              version: value.version,
              locationSource: value.locationSource,
              locationCapturedAt: value.locationCapturedAt,
              fruitIds: value.fruitIds,
              changedFields: Object.keys(input),
            },
          });
          return value;
        },
      );
      return result.value;
    });
  }

  async update(id: string, input: UpdateAccount, actor: Actor, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) => {
      const replay = await idempotentMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: `account.update:${id}`,
          request: input,
          statusCode: 200,
        },
        async () => {
          const before = await this.get(id, actor, client, true);
          if (input.ownerUserId !== undefined) {
            assertCanAssign(actor, input.ownerUserId);
            await activeOwner(client, input.ownerUserId);
          }
          const gps = gpsValues(input, actor, false);
          const values: unknown[] = [id];
          const sets: string[] = [];
          const set = (column: string, value: unknown) => {
            values.push(value);
            sets.push(`${column}=$${values.length}`);
          };
          if (input.displayName !== undefined) {
            set("display_name", input.displayName);
            set("normalized_display_name", normalizeSearch(input.displayName));
          }
          for (const [key, column] of [
            ["legalName", "legal_name"],
            ["accountType", "account_type"],
            ["ownerUserId", "owner_user_id"],
            ["countryCode", "country_code"],
            ["stateProvince", "state_province"],
            ["city", "city"],
            ["address", "address"],
            ["postalCode", "postal_code"],
            ["phone", "phone"],
            ["email", "email"],
            ["timezone", "timezone"],
            ["status", "status"],
          ] as const) {
            if (key in input) set(column, input[key] ?? null);
          }
          if (input.status !== undefined) {
            sets.push(input.status === "ARCHIVED" ? "archived_at=now()" : "archived_at=null");
          }
          if (gps !== undefined) {
            set("latitude", gps.latitude);
            set("longitude", gps.longitude);
            set("location_source", gps.locationSource);
            set("location_captured_at", gps.locationCapturedAt);
            set("location_captured_by", gps.locationCapturedBy);
          }
          values.push(actor.userId, input.version);
          const result = await client.query<{ id: string; version: number }>(
            `update commercial_accounts set ${sets.length > 0 ? `${sets.join(",")},` : ""}version=version+1,updated_at=now(),updated_by=$${values.length - 1}
             where id=$1 and version=$${values.length} returning id,version`,
            values,
          );
          if (result.rowCount === 0)
            throw new AppError(
              409,
              "ACCOUNT_VERSION_CONFLICT",
              "La cuenta fue modificada por otra operación.",
            );
          if ("fruitIds" in input) {
            await replaceFruits(client, id, input.fruitIds ?? [], actor.userId);
            await client.query(
              `update change_log
               set changed_fields=(
                 select array_agg(distinct field order by field)
                 from unnest(change_log.changed_fields || array['fruitIds']::text[]) field
               )
               where entity_type='ACCOUNT' and entity_id=$1 and version=$2 and cursor=(
                 select max(cursor) from change_log
                 where entity_type='ACCOUNT' and entity_id=$1 and version=$2
               )`,
              [id, result.rows[0]!.version],
            );
          }
          const value = await this.get(id, actor, client);
          if (!value.phone && !value.email)
            throw new AppError(
              422,
              "ACCOUNT_CHANNEL_REQUIRED",
              "La cuenta requiere teléfono o correo electrónico.",
            );
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "ACCOUNT_UPDATED",
            entityType: "commercial_account",
            entityId: id,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            before: {
              ownerUserId: before.ownerUserId,
              status: before.status,
              version: before.version,
              locationSource: before.locationSource,
              locationCapturedAt: before.locationCapturedAt,
              fruitIds: before.fruitIds,
            },
            after: {
              ownerUserId: value.ownerUserId,
              status: value.status,
              version: value.version,
              locationSource: value.locationSource,
              locationCapturedAt: value.locationCapturedAt,
              fruitIds: value.fruitIds,
              changedFields: Object.keys(input).filter((k) => k !== "version"),
            },
          });
          return value;
        },
      );
      return replay.value;
    });
  }

  async contacts(accountId: string, actor: Actor) {
    await this.get(accountId, actor);
    const result = await this.pool.query(
      "select * from commercial_contacts where account_id=$1 and deleted_at is null order by is_primary desc,normalized_full_name,id",
      [accountId],
    );
    return result.rows.map(mapContact);
  }

  async createContact(accountId: string, input: CreateContact, actor: Actor, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) => {
      const result = await idempotentMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: `contact.create:${accountId}`,
          request: input,
          statusCode: 201,
        },
        async () => {
          await this.get(accountId, actor, client, true);
          const count = await client.query<{ total: number }>(
            "select count(*)::integer total from commercial_contacts where account_id=$1 and deleted_at is null",
            [accountId],
          );
          const primary = (count.rows[0]?.total ?? 0) === 0 || input.isPrimary;
          if (primary)
            await client.query(
              "update commercial_contacts set is_primary=false,version=version+1,updated_at=now(),updated_by=$2 where account_id=$1 and is_primary and deleted_at is null",
              [accountId, actor.userId],
            );
          const id = randomUUID();
          const inserted = await client.query(
            `insert into commercial_contacts
          (id,account_id,full_name,normalized_full_name,title,phone,email,notes,is_primary,created_by,updated_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning *`,
            [
              id,
              accountId,
              input.fullName,
              normalizeSearch(input.fullName),
              input.title ?? null,
              input.phone ?? null,
              input.email ?? null,
              input.notes ?? null,
              primary,
              actor.userId,
            ],
          );
          const value = mapContact(inserted.rows[0] as Record<string, unknown>);
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "CONTACT_CREATED",
            entityType: "commercial_contact",
            entityId: id,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            after: {
              accountId,
              isPrimary: value.isPrimary,
              version: value.version,
              changedFields: Object.keys(input),
            },
          });
          return value;
        },
      );
      return result.value;
    });
  }

  async updateContact(
    accountId: string,
    contactId: string,
    input: UpdateContact,
    actor: Actor,
    meta: RequestMeta,
  ) {
    return inTransaction(this.pool, async (client) => {
      const replay = await idempotentMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: `contact.update:${contactId}`,
          request: input,
          statusCode: 200,
        },
        async () => {
          await this.get(accountId, actor, client, true);
          const found = await client.query<Record<string, unknown>>(
            "select * from commercial_contacts where id=$1 and account_id=$2 and deleted_at is null for update",
            [contactId, accountId],
          );
          const before = found.rows[0];
          if (before === undefined)
            throw new AppError(404, "CONTACT_NOT_FOUND", "El contacto no está disponible.");
          if (before.is_primary === true && input.isPrimary === false)
            throw new AppError(
              422,
              "PRIMARY_CONTACT_REQUIRED",
              "Seleccione otro contacto principal antes de quitar el actual.",
            );
          const phone = "phone" in input ? input.phone : before.phone;
          const email = "email" in input ? input.email : before.email;
          if (!phone && !email)
            throw new AppError(
              422,
              "CONTACT_CHANNEL_REQUIRED",
              "El contacto requiere teléfono o correo electrónico.",
            );
          if (input.isPrimary === true)
            await client.query(
              "update commercial_contacts set is_primary=false,version=version+1,updated_at=now(),updated_by=$3 where account_id=$1 and id<>$2 and is_primary and deleted_at is null",
              [accountId, contactId, actor.userId],
            );
          const updated = await client.query(
            `update commercial_contacts set
          full_name=coalesce($3,full_name),normalized_full_name=case when $3::text is null then normalized_full_name else $4 end,
          title=case when $5::boolean then $6 else title end,phone=case when $7::boolean then $8 else phone end,
          email=case when $9::boolean then $10 else email end,notes=case when $11::boolean then $12 else notes end,
          is_primary=coalesce($13,is_primary),version=version+1,updated_at=now(),updated_by=$14
          where id=$1 and account_id=$2 and version=$15 returning *`,
            [
              contactId,
              accountId,
              input.fullName ?? null,
              input.fullName === undefined ? null : normalizeSearch(input.fullName),
              "title" in input,
              input.title ?? null,
              "phone" in input,
              input.phone ?? null,
              "email" in input,
              input.email ?? null,
              "notes" in input,
              input.notes ?? null,
              input.isPrimary ?? null,
              actor.userId,
              input.version,
            ],
          );
          if (updated.rowCount === 0)
            throw new AppError(
              409,
              "CONTACT_VERSION_CONFLICT",
              "El contacto fue modificado por otra operación.",
            );
          const value = mapContact(updated.rows[0] as Record<string, unknown>);
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "CONTACT_UPDATED",
            entityType: "commercial_contact",
            entityId: contactId,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            before: { isPrimary: before.is_primary, version: before.version },
            after: {
              isPrimary: value.isPrimary,
              version: value.version,
              changedFields: Object.keys(input).filter((k) => k !== "version"),
            },
          });
          return value;
        },
      );
      return replay.value;
    });
  }
}
