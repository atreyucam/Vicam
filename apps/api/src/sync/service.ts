import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  createCommercialAccountRequestSchema,
  createCommercialContactRequestSchema,
  completeVisitRequestSchema,
  createTaskRequestSchema,
  createVisitRequestSchema,
  deviceSchema,
  offlineGrantSchema,
  syncConflictSchema,
  syncOperationResultSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  syncStatusSchema,
  type SyncOperation,
} from "@vicam/contracts";
import { z } from "zod";

import type { DbClient, DbPool } from "../db.js";
import { inTransaction, requestHash, writeAudit } from "../db.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { normalizeSearch } from "../domain/shared.js";
import { AppError } from "../errors.js";
import { createTaskInTransaction } from "../tasks/service.js";
import {
  cancelVisitRemindersInTransaction,
  createVisitRemindersInTransaction,
} from "../visits/service.js";

const successStatuses = new Set(["APPLIED", "MERGED", "DUPLICATE"]);
const entityTables = {
  ACCOUNT: "commercial_accounts",
  CONTACT: "commercial_contacts",
  VISIT: "visits",
  TASK: "tasks",
} as const;

type EntityType = keyof typeof entityTables;
type ResultStatus = "APPLIED" | "MERGED" | "DUPLICATE" | "CONFLICT" | "REJECTED" | "BLOCKED";
type OperationResult = {
  clientOperationId: string;
  status: ResultStatus;
  entityId: string;
  entityVersion: number | null;
  conflictId: string | null;
  code: string | null;
};

type DeviceRow = {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  status: "ACTIVE" | "REVOKED";
  last_seen_at: Date;
};

type EntityRow = {
  version: number;
  owner_user_id: string;
  responsible_user_id: string | null;
  status: string | null;
  data: Record<string, unknown>;
};

const accountUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    legalName: z.string().trim().max(250).nullable().optional(),
    accountType: z.string().trim().min(1).max(50).optional(),
    ownerUserId: z.uuid().optional(),
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
    stateProvince: z.string().trim().max(150).nullable().optional(),
    city: z.string().trim().min(1).max(150).optional(),
    address: z.string().trim().max(1_000).nullable().optional(),
    postalCode: z.string().trim().max(30).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    timezone: z.string().max(100).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    locationSource: z.enum(["MANUAL", "DEVICE"]).nullable().optional(),
    locationCapturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    fruitIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict();
const contactCreateSchema = createCommercialContactRequestSchema
  .extend({ accountId: z.uuid() })
  .strict();
const contactUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().max(150).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();
const visitUpdateSchema = createVisitRequestSchema
  .pick({ reason: true, priority: true, notes: true })
  .partial()
  .strict();
const taskUpdateSchema = createTaskRequestSchema
  .partial()
  .extend({ status: z.enum(["PENDING", "IN_PROGRESS"]).optional() })
  .strict();
const rescheduleSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
const completeVisitSchema = completeVisitRequestSchema.omit({ version: true });
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();
const noPayloadSchema = z.object({}).strict();

const fieldColumns: Record<EntityType, Record<string, string>> = {
  ACCOUNT: {
    displayName: "display_name",
    legalName: "legal_name",
    accountType: "account_type",
    ownerUserId: "owner_user_id",
    countryCode: "country_code",
    stateProvince: "state_province",
    city: "city",
    address: "address",
    postalCode: "postal_code",
    phone: "phone",
    email: "email",
    timezone: "timezone",
    latitude: "latitude",
    longitude: "longitude",
    locationSource: "location_source",
    locationCapturedAt: "location_captured_at",
    fruitIds: "__relation__",
  },
  CONTACT: {
    fullName: "full_name",
    title: "title",
    phone: "phone",
    email: "email",
    notes: "notes",
    isPrimary: "is_primary",
  },
  VISIT: { reason: "reason", priority: "priority", notes: "notes" },
  TASK: {
    accountId: "account_id",
    visitId: "visit_id",
    responsibleUserId: "responsible_user_id",
    title: "title",
    description: "description",
    dueDate: "due_date",
    dueTime: "due_time",
    timezone: "timezone",
    priority: "priority",
    status: "status",
  },
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapDevice(row: DeviceRow) {
  return deviceSchema.parse({
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
    lastSeenAt: row.last_seen_at.toISOString(),
  });
}

function result(input: OperationResult): OperationResult {
  return syncOperationResultSchema.parse(input);
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function assertChangedFields(operation: SyncOperation, payload: Record<string, unknown>): void {
  const fields = Object.keys(payload);
  const allowed = fieldColumns[operation.entityType];
  if (
    !sameStringSet(operation.changedFields, fields) ||
    fields.some((field) => allowed[field] === undefined)
  ) {
    throw new AppError(
      422,
      "INVALID_CHANGED_FIELDS",
      "Los campos modificados no coinciden con el contenido de la operación.",
    );
  }
}

function issueGrantToken(secret: string): string {
  const opaque = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", secret).update(`v1.${opaque}`).digest("base64url");
  return `v1.${opaque}.${signature}`;
}

async function ownedDevice(
  client: DbClient,
  actor: Actor,
  deviceId: string,
  lock = false,
): Promise<DeviceRow> {
  const found = await client.query<DeviceRow>(
    `select id,user_id,name,platform,status,last_seen_at from devices where id=$1 and user_id=$2${lock ? " for update" : ""}`,
    [deviceId, actor.userId],
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new AppError(404, "DEVICE_NOT_FOUND", "El dispositivo no está disponible.");
  return row;
}

async function requireGrant(
  client: DbClient,
  actor: Actor,
  deviceId: string,
  grantToken: string,
): Promise<Date> {
  const device = await ownedDevice(client, actor, deviceId, true);
  if (device.status !== "ACTIVE")
    throw new AppError(403, "DEVICE_REVOKED", "El dispositivo fue revocado.");
  const grant = await client.query<{ expires_at: Date }>(
    `select expires_at from offline_grants
     where user_id=$1 and device_id=$2 and token_hash=$3 and revoked_at is null and expires_at>now()
     order by expires_at desc limit 1 for update`,
    [actor.userId, deviceId, sha256(grantToken)],
  );
  const expiresAt = grant.rows[0]?.expires_at;
  if (expiresAt === undefined)
    throw new AppError(403, "OFFLINE_GRANT_REQUIRED", "La autorización offline no está vigente.");
  await client.query("update devices set last_seen_at=now(),updated_at=now() where id=$1", [
    deviceId,
  ]);
  return expiresAt;
}

async function scopeHash(client: DbClient, actor: Actor): Promise<string> {
  if (actor.role === "MANAGER") return sha256("MANAGER|ALL_STRUCTURED");
  const accounts = await client.query<{ id: string }>(
    "select id from commercial_accounts where owner_user_id=$1 and status='ACTIVE' order by id",
    [actor.userId],
  );
  return sha256(`SUPERVISOR|${accounts.rows.map((row) => row.id).join("|")}`);
}

export class SyncIdentityService {
  constructor(
    private readonly pool: DbPool,
    private readonly secret: string,
  ) {}

  async registerDevice(actor: Actor, input: { name: string; platform: string }, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) => {
      const id = randomUUID();
      const found = await client.query<DeviceRow>(
        `insert into devices(id,user_id,name,platform,created_by,updated_by)
         values($1,$2,$3,$4,$2,$2) returning id,user_id,name,platform,status,last_seen_at`,
        [id, actor.userId, input.name, input.platform],
      );
      await writeAudit(client, {
        actorUserId: actor.userId,
        action: "DEVICE_REGISTERED",
        entityType: "device",
        entityId: id,
        requestId: meta.requestId,
        deviceId: actor.deviceId,
        ipAddress: meta.ipAddress,
        after: { status: "ACTIVE" },
      });
      return mapDevice(found.rows[0]!);
    });
  }

  async revokeDevice(actor: Actor, deviceId: string, meta: RequestMeta): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const device = await ownedDevice(client, actor, deviceId, true);
      if (device.status === "REVOKED") return;
      await client.query(
        "update devices set status='REVOKED',updated_at=now(),updated_by=$2 where id=$1",
        [deviceId, actor.userId],
      );
      await client.query(
        "update offline_grants set revoked_at=coalesce(revoked_at,now()) where device_id=$1",
        [deviceId],
      );
      await client.query(
        "update user_sessions set revoked_at=coalesce(revoked_at,now()) where device_id=$1",
        [deviceId],
      );
      await writeAudit(client, {
        actorUserId: actor.userId,
        action: "DEVICE_REVOKED",
        entityType: "device",
        entityId: deviceId,
        requestId: meta.requestId,
        deviceId: actor.deviceId,
        ipAddress: meta.ipAddress,
        before: { status: "ACTIVE" },
        after: { status: "REVOKED" },
      });
    });
  }

  async createGrant(actor: Actor, deviceId: string, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) => {
      const device = await ownedDevice(client, actor, deviceId, true);
      if (device.status !== "ACTIVE")
        throw new AppError(403, "DEVICE_REVOKED", "El dispositivo fue revocado.");
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 72 * 60 * 60 * 1_000);
      const grantToken = issueGrantToken(this.secret);
      const id = randomUUID();
      await client.query(
        "update offline_grants set revoked_at=now() where user_id=$1 and device_id=$2 and revoked_at is null",
        [actor.userId, deviceId],
      );
      await client.query(
        `insert into offline_grants(id,user_id,device_id,token_hash,scope_hash,issued_at,expires_at)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          actor.userId,
          deviceId,
          sha256(grantToken),
          await scopeHash(client, actor),
          issuedAt,
          expiresAt,
        ],
      );
      await writeAudit(client, {
        actorUserId: actor.userId,
        action: "OFFLINE_GRANT_ISSUED",
        entityType: "offline_grant",
        entityId: id,
        requestId: meta.requestId,
        deviceId,
        ipAddress: meta.ipAddress,
        after: { status: "ACTIVE", deviceId },
      });
      return offlineGrantSchema.parse({
        id,
        deviceId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        grantToken,
      });
    });
  }
}

function topologicalOperations(operations: SyncOperation[]): {
  ordered: SyncOperation[];
  cyclic: SyncOperation[];
} {
  const byId = new Map(operations.map((operation) => [operation.clientOperationId, operation]));
  const pending = new Set(byId.keys());
  const ordered: SyncOperation[] = [];
  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const id of [...pending]) {
      const operation = byId.get(id)!;
      if (
        operation.dependsOn.every((dependency) => !byId.has(dependency) || !pending.has(dependency))
      ) {
        ordered.push(operation);
        pending.delete(id);
        progressed = true;
      }
    }
  }
  return { ordered, cyclic: [...pending].map((id) => byId.get(id)!) };
}

async function loadEntity(
  client: DbClient,
  type: EntityType,
  id: string,
): Promise<EntityRow | undefined> {
  const table = entityTables[type];
  const accountJoin = type === "ACCOUNT" ? "" : " join commercial_accounts a on a.id=e.account_id";
  const owner = type === "ACCOUNT" ? "e.owner_user_id" : "a.owner_user_id";
  const responsible = type === "VISIT" || type === "TASK" ? "e.responsible_user_id" : "null::uuid";
  const status =
    type === "ACCOUNT" || type === "VISIT" || type === "TASK"
      ? "e.status"
      : "case when e.deleted_at is null then 'ACTIVE' else 'ARCHIVED' end";
  const found = await client.query<EntityRow>(
    `select e.version,${owner} owner_user_id,${responsible} responsible_user_id,${status} status,sync_entity_data($2::text,to_jsonb(e)) data
     from ${table} e${accountJoin} where e.id=$1 for update`,
    [id, table],
  );
  return found.rows[0];
}

function assertEntityAccess(actor: Actor, type: EntityType, row: EntityRow): void {
  if (
    actor.role === "SUPERVISOR" &&
    (row.owner_user_id !== actor.userId ||
      ((type === "VISIT" || type === "TASK") && row.responsible_user_id !== actor.userId))
  ) {
    throw new AppError(403, "ACCESS_REVOKED", "El recurso ya no está dentro de su asignación.");
  }
}

async function hadEntityAccessAtBase(
  client: DbClient,
  actor: Actor,
  operation: SyncOperation,
): Promise<boolean> {
  if (actor.role !== "SUPERVISOR" || operation.baseVersion === null) return false;
  const base = await client.query<{ data: Record<string, unknown> }>(
    `select data from change_log
     where entity_type=$1 and entity_id=$2 and version=$3 and operation='UPSERT' and owner_user_id=$4
     order by cursor desc limit 1`,
    [operation.entityType, operation.entityId, operation.baseVersion, actor.userId],
  );
  const snapshot = base.rows[0]?.data;
  if (snapshot === undefined) return false;
  if (operation.entityType === "VISIT" || operation.entityType === "TASK") {
    return snapshot.responsibleUserId === actor.userId;
  }
  return true;
}

async function assertAccountAccess(
  client: DbClient,
  actor: Actor,
  accountId: string,
): Promise<void> {
  const found = await client.query<{ owner_user_id: string; status: string }>(
    "select owner_user_id,status from commercial_accounts where id=$1 for update",
    [accountId],
  );
  const account = found.rows[0];
  if (account === undefined || account.status !== "ACTIVE")
    throw new AppError(404, "ACCOUNT_NOT_AVAILABLE", "La cuenta no está disponible.");
  if (actor.role === "SUPERVISOR" && account.owner_user_id !== actor.userId)
    throw new AppError(403, "ACCESS_REVOKED", "La cuenta ya no está dentro de su asignación.");
}

async function createEntity(
  client: DbClient,
  actor: Actor,
  operation: SyncOperation,
): Promise<number> {
  if (operation.baseVersion !== null)
    throw new AppError(422, "INVALID_BASE_VERSION", "Una creación no admite versión base.");
  if (operation.entityType === "ACCOUNT") {
    const value = createCommercialAccountRequestSchema.parse(operation.payload);
    if (actor.role === "SUPERVISOR" && value.ownerUserId !== actor.userId)
      throw new AppError(403, "ASSIGNMENT_FORBIDDEN", "No puede asignar la cuenta a otro usuario.");
    const fruitIds = [...new Set(value.fruitIds)];
    if (fruitIds.length !== value.fruitIds.length) {
      throw new AppError(
        422,
        "DUPLICATE_ACCOUNT_FRUIT",
        "Una fruta no puede seleccionarse dos veces.",
      );
    }
    if (fruitIds.length > 0) {
      const activeFruits = await client.query<{ id: string }>(
        "select id from fruits where id=any($1::uuid[]) and active for share",
        [fruitIds],
      );
      if (activeFruits.rows.length !== fruitIds.length) {
        throw new AppError(
          422,
          "INVALID_ACCOUNT_FRUIT",
          "Todas las frutas seleccionadas deben estar activas.",
        );
      }
    }
    await client.query(
      `insert into commercial_accounts(id,display_name,normalized_display_name,legal_name,account_type,owner_user_id,country_code,state_province,city,address,postal_code,phone,email,timezone,latitude,longitude,location_source,location_captured_at,location_captured_by,created_by,updated_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,case when $15::numeric is null then null::uuid else $19::uuid end,$19::uuid,$19::uuid)`,
      [
        operation.entityId,
        value.displayName,
        normalizeSearch(value.displayName),
        value.legalName ?? null,
        value.accountType,
        value.ownerUserId,
        value.countryCode,
        value.stateProvince ?? null,
        value.city,
        value.address ?? null,
        value.postalCode ?? null,
        value.phone ?? null,
        value.email ?? null,
        value.timezone ?? null,
        value.latitude ?? null,
        value.longitude ?? null,
        value.locationSource ?? null,
        value.locationCapturedAt ?? null,
        actor.userId,
      ],
    );
    if (fruitIds.length === 0) return 1;
    await client.query(
      `insert into commercial_account_fruits(account_id,fruit_id,created_by)
       select $1,id,$3 from unnest($2::uuid[]) as selected(id)`,
      [operation.entityId, fruitIds, actor.userId],
    );
    const completed = await client.query<{ version: number }>(
      "update commercial_accounts set version=version+1,updated_at=now(),updated_by=$2 where id=$1 returning version",
      [operation.entityId, actor.userId],
    );
    return completed.rows[0]!.version;
  }
  if (operation.entityType === "CONTACT") {
    const value = contactCreateSchema.parse(operation.payload);
    await assertAccountAccess(client, actor, value.accountId);
    const count = await client.query<{ count: string }>(
      "select count(*) from commercial_contacts where account_id=$1 and deleted_at is null",
      [value.accountId],
    );
    const primary = count.rows[0]?.count === "0" ? true : value.isPrimary;
    if (primary)
      await client.query(
        "update commercial_contacts set is_primary=false,version=version+1,updated_at=now(),updated_by=$2 where account_id=$1 and is_primary and deleted_at is null",
        [value.accountId, actor.userId],
      );
    await client.query(
      `insert into commercial_contacts(id,account_id,full_name,normalized_full_name,title,phone,email,notes,is_primary,created_by,updated_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [
        operation.entityId,
        value.accountId,
        value.fullName,
        normalizeSearch(value.fullName),
        value.title ?? null,
        value.phone ?? null,
        value.email ?? null,
        value.notes ?? null,
        primary,
        actor.userId,
      ],
    );
    return 1;
  }
  if (operation.entityType === "VISIT") {
    const value = createVisitRequestSchema.parse(operation.payload);
    await assertAccountAccess(client, actor, value.accountId);
    if (actor.role === "SUPERVISOR" && value.responsibleUserId !== actor.userId)
      throw new AppError(403, "ASSIGNMENT_FORBIDDEN", "No puede asignar la visita a otro usuario.");
    await client.query(
      `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,notes,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [
        operation.entityId,
        value.accountId,
        value.responsibleUserId,
        value.scheduledAt,
        value.timezone,
        value.reason,
        value.priority,
        value.notes ?? null,
        actor.userId,
      ],
    );
    return 1;
  }
  const value = createTaskRequestSchema.parse(operation.payload);
  await assertAccountAccess(client, actor, value.accountId);
  if (actor.role === "SUPERVISOR" && value.responsibleUserId !== actor.userId)
    throw new AppError(403, "ASSIGNMENT_FORBIDDEN", "No puede asignar la tarea a otro usuario.");
  await client.query(
    `insert into tasks(id,account_id,visit_id,responsible_user_id,title,description,due_date,due_time,timezone,priority,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      operation.entityId,
      value.accountId,
      value.visitId ?? null,
      value.responsibleUserId,
      value.title,
      value.description ?? null,
      value.dueDate,
      value.dueTime ?? null,
      value.timezone,
      value.priority,
      actor.userId,
    ],
  );
  return 1;
}

function parsedUpdate(operation: SyncOperation): Record<string, unknown> {
  const payload = operation.payload;
  if (operation.entityType === "ACCOUNT") return accountUpdateSchema.parse(payload);
  if (operation.entityType === "CONTACT") return contactUpdateSchema.parse(payload);
  if (operation.entityType === "VISIT") return visitUpdateSchema.parse(payload);
  return taskUpdateSchema.parse(payload);
}

async function validateUpdateRelations(
  client: DbClient,
  actor: Actor,
  type: EntityType,
  value: Record<string, unknown>,
): Promise<void> {
  if (type === "ACCOUNT" && typeof value.ownerUserId === "string") {
    if (actor.role !== "MANAGER" && value.ownerUserId !== actor.userId)
      throw new AppError(403, "ASSIGNMENT_FORBIDDEN", "No puede reasignar la cuenta.");
    const active = await client.query("select 1 from users where id=$1 and status='ACTIVE'", [
      value.ownerUserId,
    ]);
    if (active.rowCount !== 1)
      throw new AppError(422, "OWNER_NOT_ACTIVE", "El responsable debe estar activo.");
  }
  if (type === "TASK") {
    if (typeof value.accountId === "string")
      await assertAccountAccess(client, actor, value.accountId);
    if (
      typeof value.responsibleUserId === "string" &&
      actor.role === "SUPERVISOR" &&
      value.responsibleUserId !== actor.userId
    )
      throw new AppError(403, "ASSIGNMENT_FORBIDDEN", "No puede reasignar la tarea.");
  }
}

async function updateFields(
  client: DbClient,
  actor: Actor,
  operation: SyncOperation,
  value: Record<string, unknown>,
  expectedVersion: number,
): Promise<number> {
  assertChangedFields(operation, value);
  await validateUpdateRelations(client, actor, operation.entityType, value);
  const table = entityTables[operation.entityType];
  const columns = fieldColumns[operation.entityType];
  const fruitIds =
    operation.entityType === "ACCOUNT" && Array.isArray(value.fruitIds)
      ? (value.fruitIds as string[])
      : undefined;
  const entries = Object.entries(value).filter(([field]) => field !== "fruitIds");
  if (entries.length === 0)
    if (fruitIds === undefined)
      throw new AppError(422, "EMPTY_OPERATION", "La operación no contiene cambios.");
  if (fruitIds !== undefined) {
    const uniqueIds = [...new Set(fruitIds)];
    if (uniqueIds.length !== fruitIds.length)
      throw new AppError(422, "DUPLICATE_ACCOUNT_FRUIT", "Una fruta no puede repetirse.");
    if (uniqueIds.length > 0) {
      const active = await client.query(
        "select id from fruits where id=any($1::uuid[]) and active for share",
        [uniqueIds],
      );
      if (active.rowCount !== uniqueIds.length)
        throw new AppError(
          422,
          "INVALID_ACCOUNT_FRUIT",
          "Todas las frutas seleccionadas deben estar activas.",
        );
    }
    await client.query("delete from commercial_account_fruits where account_id=$1", [
      operation.entityId,
    ]);
    if (uniqueIds.length > 0)
      await client.query(
        `insert into commercial_account_fruits(account_id,fruit_id,created_by)
         select $1,id,$3 from unnest($2::uuid[]) selected(id)`,
        [operation.entityId, uniqueIds, actor.userId],
      );
  }
  const values: unknown[] = [operation.entityId];
  const sets = entries.map(([field, fieldValue]) => {
    values.push(fieldValue);
    return `${columns[field]}=$${values.length}`;
  });
  if (operation.entityType === "ACCOUNT" && typeof value.displayName === "string") {
    values.push(normalizeSearch(value.displayName));
    sets.push(`normalized_display_name=$${values.length}`);
  }
  if (operation.entityType === "CONTACT" && typeof value.fullName === "string") {
    values.push(normalizeSearch(value.fullName));
    sets.push(`normalized_full_name=$${values.length}`);
  }
  values.push(actor.userId, expectedVersion);
  const updated = await client.query<{ version: number }>(
    `update ${table} set ${sets.length > 0 ? `${sets.join(",")},` : ""}version=version+1,updated_at=now(),updated_by=$${values.length - 1}
     where id=$1 and version=$${values.length} returning version`,
    values,
  );
  const version = updated.rows[0]?.version;
  if (version === undefined)
    throw new AppError(
      409,
      "VERSION_CHANGED_DURING_SYNC",
      "La entidad cambió durante la sincronización.",
    );
  await client.query(
    `update change_log set changed_fields=$3
     where entity_type=$1 and entity_id=$2 and version=$4 and cursor=(
       select max(cursor) from change_log where entity_type=$1 and entity_id=$2 and version=$4
     )`,
    [operation.entityType, operation.entityId, operation.changedFields, version],
  );
  return version;
}

async function specialAction(
  client: DbClient,
  actor: Actor,
  operation: SyncOperation,
  row: EntityRow,
  meta: RequestMeta,
): Promise<number> {
  if (operation.entityType === "VISIT" && operation.action === "RESCHEDULE") {
    if (row.status !== "PENDING")
      throw new AppError(409, "STATE_CHANGED", "La visita ya no puede reprogramarse.");
    const value = rescheduleSchema.parse(operation.payload);
    if (!sameStringSet(operation.changedFields, ["scheduledAt", "timezone"]))
      throw new AppError(
        422,
        "INVALID_CHANGED_FIELDS",
        "Los campos de reprogramación no son válidos.",
      );
    await client.query(
      `insert into visit_reschedules(id,visit_id,old_scheduled_at,new_scheduled_at,old_timezone,new_timezone,reason,actor_user_id) select $1,id,scheduled_at,$3,timezone,$4,$5,$6 from visits where id=$2`,
      [
        randomUUID(),
        operation.entityId,
        value.scheduledAt,
        value.timezone,
        value.reason,
        actor.userId,
      ],
    );
    const updated = await client.query<{ version: number }>(
      `update visits set scheduled_at=$2,timezone=$3,version=version+1,updated_at=now(),updated_by=$4 where id=$1 and version=$5 returning version`,
      [operation.entityId, value.scheduledAt, value.timezone, actor.userId, row.version],
    );
    await cancelVisitRemindersInTransaction(client, operation.entityId);
    await createVisitRemindersInTransaction(
      client,
      operation.entityId,
      updated.rows[0]?.version ?? row.version,
      new Date(value.scheduledAt),
    );
    await writeAudit(client, {
      actorUserId: actor.userId,
      action: "VISIT_RESCHEDULED",
      entityType: "visit",
      entityId: operation.entityId,
      requestId: meta.requestId,
      deviceId: actor.deviceId,
      ipAddress: meta.ipAddress,
      before: {
        scheduledAt: row.data.scheduledAt,
        timezone: row.data.timezone,
        version: row.version,
      },
      after: {
        scheduledAt: value.scheduledAt,
        timezone: value.timezone,
        version: updated.rows[0]?.version ?? row.version,
        reasonProvided: true,
      },
    });
    return updated.rows[0]?.version ?? row.version;
  }
  if (operation.entityType === "VISIT" && operation.action === "COMPLETE") {
    if (row.status !== "PENDING")
      throw new AppError(409, "STATE_CHANGED", "La visita ya no puede completarse.");
    const value = completeVisitSchema.parse(operation.payload);
    const updated = await client.query<{ version: number }>(
      `update visits set status='COMPLETED',observation=$2,result=$3,actual_started_at=$4,
         actual_ended_at=$5,completed_at=now(),completed_by=$6,version=version+1,
         updated_at=now(),updated_by=$6 where id=$1 and version=$7 returning version`,
      [
        operation.entityId,
        value.observation,
        value.result,
        value.actualStartedAt ?? null,
        value.actualEndedAt,
        actor.userId,
        row.version,
      ],
    );
    if (value.followUpTask) {
      const visit = await client.query<{ account_id: string; timezone: string }>(
        "select account_id,timezone from visits where id=$1",
        [operation.entityId],
      );
      const context = visit.rows[0]!;
      await createTaskInTransaction(
        client,
        {
          accountId: context.account_id,
          visitId: operation.entityId,
          responsibleUserId: value.followUpTask.responsibleUserId,
          title: value.followUpTask.title,
          dueDate: value.followUpTask.dueDate,
          timezone: context.timezone,
          priority: value.followUpTask.priority,
        },
        actor,
        meta,
        value.followUpTask.id,
      );
    }
    await cancelVisitRemindersInTransaction(client, operation.entityId);
    await writeAudit(client, {
      actorUserId: actor.userId,
      action: "VISIT_COMPLETED",
      entityType: "visit",
      entityId: operation.entityId,
      requestId: meta.requestId,
      deviceId: actor.deviceId,
      ipAddress: meta.ipAddress,
      before: { status: row.status, version: row.version },
      after: {
        status: "COMPLETED",
        result: value.result,
        version: updated.rows[0]?.version ?? row.version,
      },
    });
    return updated.rows[0]?.version ?? row.version;
  }
  if (operation.action === "CANCEL" && operation.entityType === "VISIT") {
    if (row.status !== "PENDING")
      throw new AppError(409, "STATE_CHANGED", "La visita ya no puede cancelarse.");
    const value = cancelSchema.parse(operation.payload);
    const updated = await client.query<{ version: number }>(
      `update visits set status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancellation_reason=$3,version=version+1,updated_at=now(),updated_by=$2 where id=$1 and version=$4 returning version`,
      [operation.entityId, actor.userId, value.reason, row.version],
    );
    await cancelVisitRemindersInTransaction(client, operation.entityId);
    await writeAudit(client, {
      actorUserId: actor.userId,
      action: "VISIT_CANCELLED",
      entityType: "visit",
      entityId: operation.entityId,
      requestId: meta.requestId,
      deviceId: actor.deviceId,
      ipAddress: meta.ipAddress,
      before: { status: row.status, version: row.version },
      after: {
        status: "CANCELLED",
        version: updated.rows[0]?.version ?? row.version,
        reasonProvided: true,
      },
    });
    return updated.rows[0]?.version ?? row.version;
  }
  if (operation.entityType === "TASK" && operation.action === "COMPLETE") {
    noPayloadSchema.parse(operation.payload);
    if (!new Set(["PENDING", "IN_PROGRESS"]).has(row.status ?? ""))
      throw new AppError(409, "STATE_CHANGED", "La tarea ya no puede completarse.");
    const updated = await client.query<{ version: number }>(
      `update tasks set status='COMPLETED',completed_at=now(),completed_by=$2,version=version+1,updated_at=now(),updated_by=$2 where id=$1 and version=$3 returning version`,
      [operation.entityId, actor.userId, row.version],
    );
    return updated.rows[0]?.version ?? row.version;
  }
  if (operation.entityType === "TASK" && operation.action === "CANCEL") {
    if (!new Set(["PENDING", "IN_PROGRESS"]).has(row.status ?? ""))
      throw new AppError(409, "STATE_CHANGED", "La tarea ya no puede cancelarse.");
    const value = cancelSchema.parse(operation.payload);
    const updated = await client.query<{ version: number }>(
      `update tasks set status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancellation_reason=$3,version=version+1,updated_at=now(),updated_by=$2 where id=$1 and version=$4 returning version`,
      [operation.entityId, actor.userId, value.reason, row.version],
    );
    return updated.rows[0]?.version ?? row.version;
  }
  throw new AppError(422, "ACTION_NOT_SUPPORTED", "La acción no es válida para esta entidad.");
}

async function createConflict(
  client: DbClient,
  operationId: string,
  operation: SyncOperation,
  row: EntityRow,
  code:
    | "SAME_FIELD_CHANGED"
    | "STATE_CHANGED"
    | "ENTITY_ARCHIVED"
    | "ACCESS_REVOKED"
    | "DEPENDENCY_FAILED"
    | "BASE_VERSION_REQUIRED",
  fields: string[],
): Promise<OperationResult> {
  const base =
    operation.baseVersion === null
      ? undefined
      : (
          await client.query<{ data: Record<string, unknown> }>(
            `select data from change_log where entity_type=$1 and entity_id=$2 and version=$3 and operation='UPSERT' order by cursor desc limit 1`,
            [operation.entityType, operation.entityId, operation.baseVersion],
          )
        ).rows[0]?.data;
  const conflictId = randomUUID();
  const baseSnapshot = base ?? {};
  const clientSnapshot = { ...baseSnapshot, ...operation.payload };
  await client.query(
    `insert into sync_conflicts(id,operation_id,entity_type,entity_id,base_version,server_version,conflicting_fields,base_snapshot_hash,client_snapshot_hash,server_snapshot_hash,code,base_snapshot,client_snapshot,server_snapshot)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      conflictId,
      operationId,
      operation.entityType,
      operation.entityId,
      operation.baseVersion ?? 1,
      row.version,
      fields,
      requestHash(baseSnapshot),
      requestHash(clientSnapshot),
      requestHash(row.data),
      code,
      JSON.stringify(baseSnapshot),
      JSON.stringify(clientSnapshot),
      JSON.stringify(row.data),
    ],
  );
  return result({
    clientOperationId: operation.clientOperationId,
    status: "CONFLICT",
    entityId: operation.entityId,
    entityVersion: row.version,
    conflictId,
    code,
  });
}

async function applyOperation(
  client: DbClient,
  actor: Actor,
  operationId: string,
  operation: SyncOperation,
  meta: RequestMeta,
): Promise<OperationResult> {
  if (operation.action === "CREATE") {
    const existing = await loadEntity(client, operation.entityType, operation.entityId);
    if (existing !== undefined)
      return createConflict(client, operationId, operation, existing, "STATE_CHANGED", ["id"]);
    return result({
      clientOperationId: operation.clientOperationId,
      status: "APPLIED",
      entityId: operation.entityId,
      entityVersion: await createEntity(client, actor, operation),
      conflictId: null,
      code: null,
    });
  }
  const row = await loadEntity(client, operation.entityType, operation.entityId);
  if (row === undefined)
    throw new AppError(404, "ENTITY_NOT_AVAILABLE", "La entidad no está disponible.");
  try {
    assertEntityAccess(actor, operation.entityType, row);
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "ACCESS_REVOKED" &&
      (await hadEntityAccessAtBase(client, actor, operation))
    ) {
      return createConflict(
        client,
        operationId,
        operation,
        row,
        "ACCESS_REVOKED",
        operation.changedFields,
      );
    }
    throw error;
  }
  if (
    row.status === "ARCHIVED" ||
    row.status === "CANCELLED" ||
    (operation.entityType === "ACCOUNT" && row.status !== "ACTIVE")
  )
    return createConflict(
      client,
      operationId,
      operation,
      row,
      "ENTITY_ARCHIVED",
      operation.changedFields,
    );
  if (operation.baseVersion === null)
    return createConflict(
      client,
      operationId,
      operation,
      row,
      "BASE_VERSION_REQUIRED",
      operation.changedFields,
    );

  if (operation.action !== "UPDATE") {
    if (operation.baseVersion !== row.version)
      return createConflict(client, operationId, operation, row, "STATE_CHANGED", ["status"]);
    const version = await specialAction(client, actor, operation, row, meta);
    return result({
      clientOperationId: operation.clientOperationId,
      status: "APPLIED",
      entityId: operation.entityId,
      entityVersion: version,
      conflictId: null,
      code: null,
    });
  }

  const value = parsedUpdate(operation);
  assertChangedFields(operation, value);
  let status: ResultStatus = "APPLIED";
  if (operation.baseVersion !== row.version) {
    const base = await client.query(
      `select 1 from change_log where entity_type=$1 and entity_id=$2 and version=$3 and operation='UPSERT'`,
      [operation.entityType, operation.entityId, operation.baseVersion],
    );
    if (base.rowCount === 0)
      return createConflict(
        client,
        operationId,
        operation,
        row,
        "BASE_VERSION_REQUIRED",
        operation.changedFields,
      );
    const changed = await client.query<{ field: string }>(
      `select distinct unnest(changed_fields) field from change_log where entity_type=$1 and entity_id=$2 and version>$3`,
      [operation.entityType, operation.entityId, operation.baseVersion],
    );
    const serverFields = new Set(changed.rows.map((item) => item.field));
    const overlap = operation.changedFields.filter((field) => serverFields.has(field));
    if (overlap.length > 0)
      return createConflict(
        client,
        operationId,
        operation,
        row,
        overlap.includes("status") ? "STATE_CHANGED" : "SAME_FIELD_CHANGED",
        overlap,
      );
    status = "MERGED";
  }
  const version = await updateFields(client, actor, operation, value, row.version);
  return result({
    clientOperationId: operation.clientOperationId,
    status,
    entityId: operation.entityId,
    entityVersion: version,
    conflictId: null,
    code: null,
  });
}

function persistedStatus(status: ResultStatus): "APPLIED" | "REJECTED" | "CONFLICT" {
  if (status === "CONFLICT") return "CONFLICT";
  if (status === "REJECTED" || status === "BLOCKED") return "REJECTED";
  return "APPLIED";
}

function appErrorResult(operation: SyncOperation, error: unknown): OperationResult {
  const code =
    error instanceof AppError
      ? error.code
      : error instanceof z.ZodError
        ? "VALIDATION_ERROR"
        : "OPERATION_FAILED";
  return result({
    clientOperationId: operation.clientOperationId,
    status: "REJECTED",
    entityId: operation.entityId,
    entityVersion: null,
    conflictId: null,
    code,
  });
}

export class SyncService {
  constructor(private readonly pool: DbPool) {}

  async push(
    actor: Actor,
    deviceId: string,
    grantToken: string,
    operations: SyncOperation[],
    meta: RequestMeta,
  ) {
    return inTransaction(this.pool, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `sync:${deviceId}`,
      ]);
      await client.query("select set_config('vicam.request_id',$1,true)", [meta.requestId]);
      await requireGrant(client, actor, deviceId, grantToken);
      const duplicateIds = operations.filter(
        (operation, index) =>
          operations.findIndex(
            (candidate) => candidate.clientOperationId === operation.clientOperationId,
          ) !== index,
      );
      if (duplicateIds.length > 0)
        throw new AppError(
          422,
          "DUPLICATE_CLIENT_OPERATION_ID",
          "El lote repite un identificador de operación.",
        );
      const { ordered, cyclic } = topologicalOperations(operations);
      const results = new Map<string, OperationResult>();

      for (const operation of [...ordered, ...cyclic]) {
        const operationHash = requestHash(operation);
        const existing = await client.query<{ payload_hash: string; result_body: OperationResult }>(
          `select payload_hash,result_body from sync_operations where device_id=$1 and client_operation_id=$2`,
          [deviceId, operation.clientOperationId],
        );
        const prior = existing.rows[0];
        if (prior !== undefined) {
          const replay =
            prior.payload_hash === operationHash && prior.result_body !== null
              ? result({ ...prior.result_body, status: "DUPLICATE" })
              : result({
                  clientOperationId: operation.clientOperationId,
                  status: "REJECTED",
                  entityId: operation.entityId,
                  entityVersion: null,
                  conflictId: null,
                  code: "CLIENT_OPERATION_ID_REUSED",
                });
          results.set(operation.clientOperationId, replay);
          continue;
        }
        const operationId = randomUUID();
        let operationResult: OperationResult;
        const dependencies = operation.dependsOn;
        const dependencyRows =
          dependencies.length === 0
            ? []
            : (
                await client.query<{ client_operation_id: string; result_status: ResultStatus }>(
                  `select client_operation_id,result_status from sync_operations where device_id=$1 and client_operation_id=any($2::uuid[])`,
                  [deviceId, dependencies],
                )
              ).rows;
        const storedDependencies = new Map(
          dependencyRows.map((row) => [row.client_operation_id, row.result_status]),
        );
        const failedDependency =
          cyclic.includes(operation) ||
          dependencies.some((id) => {
            const local = results.get(id)?.status;
            return local !== undefined
              ? !successStatuses.has(local)
              : !successStatuses.has(storedDependencies.get(id) ?? "");
          });
        await client.query(
          `insert into sync_operations(id,device_id,actor_user_id,client_operation_id,sequence,entity_type,entity_id,action,base_version,payload_hash,changed_fields,occurred_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            operationId,
            deviceId,
            actor.userId,
            operation.clientOperationId,
            operation.sequence,
            operation.entityType,
            operation.entityId,
            operation.action,
            operation.baseVersion,
            operationHash,
            operation.changedFields,
            operation.occurredAt,
          ],
        );
        if (failedDependency) {
          operationResult = result({
            clientOperationId: operation.clientOperationId,
            status: "BLOCKED",
            entityId: operation.entityId,
            entityVersion: null,
            conflictId: null,
            code: "DEPENDENCY_FAILED",
          });
        } else {
          try {
            await client.query("savepoint sync_operation_apply");
            try {
              operationResult = await applyOperation(client, actor, operationId, operation, meta);
              await client.query("release savepoint sync_operation_apply");
            } catch (error) {
              await client.query("rollback to savepoint sync_operation_apply");
              await client.query("release savepoint sync_operation_apply");
              throw error;
            }
          } catch (error) {
            if (!(error instanceof AppError) && !(error instanceof z.ZodError)) throw error;
            operationResult = appErrorResult(operation, error);
          }
        }
        for (const dependency of dependencies) {
          await client.query(
            `insert into sync_operation_dependencies(operation_id,depends_on_operation_id) select $1,id from sync_operations where device_id=$2 and client_operation_id=$3 on conflict do nothing`,
            [operationId, deviceId, dependency],
          );
        }
        await client.query(
          `update sync_operations set status=$2,result_status=$3::varchar,result_code=$4,result_entity_version=$5,conflict_id=$6,result_body=$7,applied_at=case when $3::varchar in ('APPLIED','MERGED') then now() else null end where id=$1`,
          [
            operationId,
            persistedStatus(operationResult.status),
            operationResult.status,
            operationResult.code,
            operationResult.entityVersion,
            operationResult.conflictId,
            JSON.stringify(operationResult),
          ],
        );
        await writeAudit(client, {
          actorUserId: actor.userId,
          action: `SYNC_${operationResult.status}`,
          entityType: "sync_operation",
          entityId: operationId,
          requestId: meta.requestId,
          deviceId,
          ipAddress: meta.ipAddress,
          after: { status: operationResult.status, changedFields: operation.changedFields },
        });
        results.set(operation.clientOperationId, operationResult);
      }
      return syncPushResponseSchema.parse({
        results: operations.map((operation) => results.get(operation.clientOperationId)!),
      });
    });
  }

  async pull(actor: Actor, deviceId: string, grantToken: string, cursor: string, limit: number) {
    return inTransaction(this.pool, async (client) => {
      const expiresAt = await requireGrant(client, actor, deviceId, grantToken);
      const visibility =
        actor.role === "MANAGER"
          ? "true"
          : `(cl.operation='REVOKE' and cl.owner_user_id=$3) or (cl.operation<>'REVOKE' and case cl.entity_type when 'ACCOUNT' then exists(select 1 from commercial_accounts a where a.id=cl.entity_id and a.owner_user_id=$3) when 'CONTACT' then exists(select 1 from commercial_contacts e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and a.owner_user_id=$3) when 'VISIT' then exists(select 1 from visits e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and a.owner_user_id=$3 and e.responsible_user_id=$3) when 'TASK' then exists(select 1 from tasks e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and a.owner_user_id=$3 and e.responsible_user_id=$3) else false end)`;
      const rows = await client.query<{
        cursor: string;
        entity_type: EntityType;
        entity_id: string;
        operation: "UPSERT" | "DELETE" | "REVOKE";
        version: number;
        data: Record<string, unknown> | null;
        cacheable: boolean;
      }>(
        `select cl.cursor::text,cl.entity_type,cl.entity_id,cl.operation,
           case when cl.entity_type='ACCOUNT' and cl.operation<>'REVOKE'
             then coalesce((select a.version from commercial_accounts a where a.id=cl.entity_id),cl.version)
             else cl.version end version,
           case when cl.entity_type='ACCOUNT' and cl.operation<>'REVOKE'
             then coalesce((select sync_entity_data('commercial_accounts',to_jsonb(a)) from commercial_accounts a where a.id=cl.entity_id),cl.data)
             else cl.data end data,
           case cl.entity_type
             when 'ACCOUNT' then exists(select 1 from commercial_accounts a where a.id=cl.entity_id and a.status='ACTIVE')
             when 'CONTACT' then exists(select 1 from commercial_contacts e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and e.deleted_at is null and a.status='ACTIVE')
             when 'VISIT' then exists(select 1 from visits e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and e.status='PENDING' and a.status='ACTIVE')
             when 'TASK' then exists(select 1 from tasks e join commercial_accounts a on a.id=e.account_id where e.id=cl.entity_id and e.status in ('PENDING','IN_PROGRESS') and a.status='ACTIVE')
             else false end cacheable
         from change_log cl where cl.cursor>$1::bigint and (${visibility}) order by cl.cursor limit $2`,
        actor.role === "MANAGER" ? [cursor, limit + 1] : [cursor, limit + 1, actor.userId],
      );
      const hasMore = rows.rows.length > limit;
      const page = rows.rows.slice(0, limit);
      const nextCursor = page.at(-1)?.cursor ?? cursor;
      const purgeAccountIds = [
        ...new Set(
          page
            .filter(
              (row) =>
                row.entity_type === "ACCOUNT" &&
                (row.operation === "REVOKE" || (row.operation === "UPSERT" && !row.cacheable)),
            )
            .map((row) => row.entity_id),
        ),
      ];
      return syncPullResponseSchema.parse({
        changes: page.map((row) => ({
          cursor: row.cursor,
          entityType: row.entity_type,
          entityId: row.entity_id,
          operation: row.operation === "UPSERT" && !row.cacheable ? "DELETE" : row.operation,
          version: row.version,
          data: row.operation !== "UPSERT" || !row.cacheable ? null : row.data,
        })),
        nextCursor,
        hasMore,
        purgeAccountIds,
        serverTime: new Date().toISOString(),
        grantExpiresAt: expiresAt.toISOString(),
        deviceRevoked: false,
      });
    });
  }

  async status(actor: Actor, deviceId: string) {
    const deviceResult = await this.pool.query<DeviceRow>(
      "select id,user_id,name,platform,status,last_seen_at from devices where id=$1 and user_id=$2",
      [deviceId, actor.userId],
    );
    const device = deviceResult.rows[0];
    if (device === undefined)
      throw new AppError(404, "DEVICE_NOT_FOUND", "El dispositivo no está disponible.");
    const [grant, conflicts, cursor] = await Promise.all([
      this.pool.query<{ expires_at: Date }>(
        `select expires_at from offline_grants where user_id=$1 and device_id=$2 and revoked_at is null and expires_at>now() order by expires_at desc limit 1`,
        [actor.userId, deviceId],
      ),
      this.pool.query<{ count: number }>(
        `select count(*)::integer count from sync_conflicts c join sync_operations o on o.id=c.operation_id where c.status='OPEN' and ($1='MANAGER' or o.actor_user_id=$2)`,
        [actor.role, actor.userId],
      ),
      this.pool.query<{ cursor: string }>(
        "select coalesce(max(cursor),0)::text cursor from change_log",
      ),
    ]);
    return syncStatusSchema.parse({
      device: mapDevice(device),
      grantExpiresAt: grant.rows[0]?.expires_at.toISOString() ?? null,
      pendingConflicts: conflicts.rows[0]?.count ?? 0,
      latestCursor: cursor.rows[0]?.cursor ?? "0",
    });
  }

  async conflicts(actor: Actor) {
    const rows = await this.pool.query<Record<string, unknown>>(
      `select c.* from sync_conflicts c join sync_operations o on o.id=c.operation_id
       where c.status='OPEN' and ($1='MANAGER' or o.actor_user_id=$2) order by c.created_at`,
      [actor.role, actor.userId],
    );
    return rows.rows.map((row) => mapConflict(row, actor));
  }

  async resolve(
    actor: Actor,
    conflictId: string,
    input: { resolution: "SERVER" | "DEVICE" | "MERGED"; mergedFields?: Record<string, unknown> },
    meta: RequestMeta,
  ) {
    if (actor.role !== "MANAGER")
      throw new AppError(403, "INSUFFICIENT_ROLE", "Solo Manager puede resolver conflictos.");
    return inTransaction(this.pool, async (client) => {
      await client.query("select set_config('vicam.request_id',$1,true)", [meta.requestId]);
      const found = await client.query<Record<string, unknown>>(
        `select c.*,o.changed_fields from sync_conflicts c join sync_operations o on o.id=c.operation_id where c.id=$1 for update`,
        [conflictId],
      );
      const conflict = found.rows[0];
      if (conflict === undefined)
        throw new AppError(404, "CONFLICT_NOT_FOUND", "El conflicto no está disponible.");
      if (conflict.status !== "OPEN")
        throw new AppError(409, "CONFLICT_ALREADY_RESOLVED", "El conflicto ya fue resuelto.");
      if (input.resolution !== "SERVER") {
        const entityType = conflict.entity_type as EntityType;
        const current = await loadEntity(client, entityType, conflict.entity_id as string);
        if (current === undefined)
          throw new AppError(404, "ENTITY_NOT_AVAILABLE", "La entidad no está disponible.");
        const selected =
          input.resolution === "DEVICE"
            ? (conflict.client_snapshot as Record<string, unknown>)
            : input.mergedFields;
        if (selected === undefined)
          throw new AppError(422, "MERGED_FIELDS_REQUIRED", "Debe indicar los campos fusionados.");
        const allowed = fieldColumns[entityType];
        const mutable = Object.fromEntries(
          Object.entries(selected).filter(
            ([key]) => allowed[key] !== undefined && key !== "status",
          ),
        );
        const synthetic: SyncOperation = {
          clientOperationId: randomUUID(),
          sequence: 1,
          entityType,
          entityId: conflict.entity_id as string,
          action: "UPDATE",
          baseVersion: current.version,
          changedFields: Object.keys(mutable),
          dependsOn: [],
          payload: mutable,
          occurredAt: new Date().toISOString(),
        };
        const parsed = parsedUpdate(synthetic);
        await updateFields(client, actor, synthetic, parsed, current.version);
      } else {
        const current = await loadEntity(
          client,
          conflict.entity_type as EntityType,
          conflict.entity_id as string,
        );
        if (current === undefined)
          throw new AppError(404, "ENTITY_NOT_AVAILABLE", "La entidad no está disponible.");
        await client.query(
          `update sync_conflicts set server_version=$2,server_snapshot=$3,server_snapshot_hash=$4
           where id=$1`,
          [conflictId, current.version, JSON.stringify(current.data), requestHash(current.data)],
        );
      }
      await client.query(
        "update sync_conflicts set status='RESOLVED',resolution=$2,resolved_at=now(),resolved_by=$3 where id=$1",
        [conflictId, input.resolution, actor.userId],
      );
      await writeAudit(client, {
        actorUserId: actor.userId,
        action: "SYNC_CONFLICT_RESOLVED",
        entityType: "sync_conflict",
        entityId: conflictId,
        requestId: meta.requestId,
        deviceId: actor.deviceId,
        ipAddress: meta.ipAddress,
        before: { status: "OPEN" },
        after: { status: "RESOLVED" },
      });
      const resolved = await client.query<Record<string, unknown>>(
        `select c.* from sync_conflicts c where c.id=$1`,
        [conflictId],
      );
      return mapConflict(resolved.rows[0]!);
    });
  }
}

function mapConflict(row: Record<string, unknown>, actor?: Actor) {
  const redactSnapshots = actor?.role === "SUPERVISOR" && row.code === "ACCESS_REVOKED";
  return syncConflictSchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    serverVersion: row.server_version,
    code: row.code,
    conflictingFields: row.conflicting_fields,
    base: redactSnapshots ? {} : row.base_snapshot,
    server: redactSnapshots ? {} : row.server_snapshot,
    device: redactSnapshots ? {} : row.client_snapshot,
    status: row.status,
    createdAt: (row.created_at as Date).toISOString(),
  });
}
