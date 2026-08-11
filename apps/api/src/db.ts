import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient, DatabasePoolClient } from "@vicam/db";

import { AppError } from "./errors.js";

export type DbPool = DatabaseClient["pool"];
export type DbClient = DatabasePoolClient;

export async function inTransaction<T>(
  pool: DbPool,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const auditFields: Record<string, ReadonlySet<string>> = {
  commercial_account: new Set([
    "ownerUserId",
    "status",
    "version",
    "locationSource",
    "locationCapturedAt",
    "fruitIds",
    "changedFields",
  ]),
  commercial_contact: new Set(["accountId", "isPrimary", "version", "changedFields"]),
  visit: new Set([
    "accountId",
    "responsibleUserId",
    "scheduledAt",
    "timezone",
    "priority",
    "status",
    "result",
    "version",
    "reasonProvided",
    "changedFields",
  ]),
  task: new Set([
    "accountId",
    "visitId",
    "responsibleUserId",
    "dueDate",
    "dueTime",
    "timezone",
    "priority",
    "status",
    "version",
    "reasonProvided",
    "changedFields",
  ]),
  user: new Set([
    "username",
    "fullName",
    "role",
    "status",
    "mustChangePassword",
    "sessionsRevoked",
    "devicesRevoked",
    "offlineGrantsRevoked",
  ]),
  session: new Set([
    "reason",
    "status",
    "deviceId",
    "previousSessionId",
    "rotatedFromSessionId",
    "familyRevoked",
    "otherSessionsRevoked",
  ]),
  device: new Set(["status"]),
  offline_grant: new Set(["status", "deviceId"]),
  sync_operation: new Set(["status", "changedFields"]),
  sync_conflict: new Set(["status"]),
  document: new Set(["accountId", "categoryId", "format", "sizeBytes", "checksum", "status"]),
  document_category: new Set(["name", "active", "version"]),
  notification: new Set(["type", "resourceType", "resourceId", "read"]),
  app_settings: new Set(["changedFields", "version"]),
  report_export: new Set(["group", "template", "format", "status"]),
  import_batch: new Set(["format", "status", "totalRows", "errorRows"]),
};

const changedFieldNames: Record<string, ReadonlySet<string>> = {
  commercial_account: new Set([
    "displayName",
    "legalName",
    "accountType",
    "ownerUserId",
    "countryCode",
    "stateProvince",
    "city",
    "address",
    "postalCode",
    "phone",
    "email",
    "timezone",
    "latitude",
    "longitude",
    "locationSource",
    "locationCapturedAt",
    "fruitIds",
    "status",
  ]),
  commercial_contact: new Set(["fullName", "title", "phone", "email", "notes", "isPrimary"]),
  visit: new Set(["reason", "priority", "notes", "result"]),
  task: new Set([
    "accountId",
    "visitId",
    "responsibleUserId",
    "title",
    "description",
    "dueDate",
    "dueTime",
    "timezone",
    "priority",
    "status",
  ]),
  sync_operation: new Set([
    "displayName",
    "legalName",
    "accountType",
    "ownerUserId",
    "countryCode",
    "stateProvince",
    "city",
    "address",
    "postalCode",
    "phone",
    "email",
    "timezone",
    "latitude",
    "longitude",
    "locationSource",
    "locationCapturedAt",
    "fullName",
    "title",
    "notes",
    "isPrimary",
    "reason",
    "priority",
    "accountId",
    "visitId",
    "responsibleUserId",
    "description",
    "dueDate",
    "dueTime",
    "status",
    "scheduledAt",
    "observation",
    "actualEndedAt",
    "result",
  ]),
};

export function safeAuditChanges(
  entityType: string,
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const allowed = auditFields[entityType];
  if (allowed === undefined) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowed.has(key))
      .map(([key, item]) => [
        key,
        key === "changedFields" && Array.isArray(item)
          ? item.filter(
              (field): field is string =>
                typeof field === "string" && changedFieldNames[entityType]?.has(field) === true,
            )
          : typeof item === "string" && item.length > 200
            ? "[TRUNCATED]"
            : item,
      ]),
  );
}

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId: string;
  deviceId?: string | null;
  ipAddress?: string | null;
};

export async function writeAudit(client: DbClient, input: AuditInput): Promise<void> {
  const retentionClass =
    /^(LOGIN_|SESSION_|PASSWORD_)/.test(input.action) ||
    input.action === "USER_PASSWORD_RESET" ||
    input.action === "MANAGER_PASSWORD_RESET_CLI" ||
    input.action === "MANAGER_BOOTSTRAPPED_CLI"
      ? "SECURITY"
      : "FUNCTIONAL";
  await client.query(
    `insert into audit_logs (
       id, actor_user_id, action, entity_type, entity_id, before_changes, after_changes,
       request_id, device_id, ip_address, retention_class
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      safeAuditChanges(input.entityType, input.before),
      safeAuditChanges(input.entityType, input.after),
      input.requestId,
      input.deviceId ?? null,
      input.ipAddress?.slice(0, 64) ?? null,
      retentionClass,
    ],
  );
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertIdempotencyKey(key: string): void {
  if (key.length < 8 || key.length > 200) {
    throw new AppError(422, "INVALID_IDEMPOTENCY_KEY", "La clave de idempotencia no es válida.");
  }
}

export async function idempotentMutation<T>(
  client: DbClient,
  input: {
    actorUserId: string;
    key?: string | undefined;
    operation: string;
    request: unknown;
    statusCode: number;
  },
  work: () => Promise<T>,
): Promise<{ replayed: boolean; value: T }> {
  if (input.key === undefined) return { replayed: false, value: await work() };
  assertIdempotencyKey(input.key);
  const hash = requestHash(input.request);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${input.actorUserId}|${input.operation}|${input.key}`,
  ]);
  await client.query(
    `delete from mutation_idempotency
     where actor_user_id=$1 and idempotency_key=$2 and operation=$3 and expires_at <= now()`,
    [input.actorUserId, input.key, input.operation],
  );
  const existing = await client.query<{ request_hash: string; response_body: T }>(
    `select request_hash, response_body from mutation_idempotency
     where actor_user_id=$1 and idempotency_key=$2 and operation=$3
     for update`,
    [input.actorUserId, input.key, input.operation],
  );
  const row = existing.rows[0];
  if (row !== undefined) {
    if (row.request_hash !== hash) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya fue usada con otros datos.",
      );
    }
    return { replayed: true, value: row.response_body };
  }
  const value = await work();
  await client.query(
    `insert into mutation_idempotency
       (actor_user_id,idempotency_key,operation,request_hash,status_code,response_body,expires_at)
     values ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')`,
    [input.actorUserId, input.key, input.operation, hash, input.statusCode, JSON.stringify(value)],
  );
  return { replayed: false, value };
}

export async function oneTimeSecretMutation<T>(
  client: DbClient,
  input: {
    actorUserId: string;
    key?: string | undefined;
    operation: string;
    request: unknown;
    statusCode: number;
  },
  work: () => Promise<T>,
): Promise<T> {
  if (input.key === undefined) return work();
  assertIdempotencyKey(input.key);
  const hash = requestHash(input.request);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${input.actorUserId}|${input.operation}|${input.key}`,
  ]);
  await client.query(
    `delete from mutation_idempotency
     where actor_user_id=$1 and idempotency_key=$2 and operation=$3 and expires_at <= now()`,
    [input.actorUserId, input.key, input.operation],
  );
  const existing = await client.query<{ request_hash: string }>(
    `select request_hash from mutation_idempotency
     where actor_user_id=$1 and idempotency_key=$2 and operation=$3
     for update`,
    [input.actorUserId, input.key, input.operation],
  );
  const row = existing.rows[0];
  if (row !== undefined) {
    if (row.request_hash !== hash) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya fue usada con otros datos.",
      );
    }
    throw new AppError(
      409,
      "TEMPORARY_CREDENTIAL_ALREADY_ISSUED",
      "La credencial temporal ya fue emitida y no puede mostrarse nuevamente.",
    );
  }
  const value = await work();
  await client.query(
    `insert into mutation_idempotency
       (actor_user_id,idempotency_key,operation,request_hash,status_code,response_body,expires_at)
     values ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')`,
    [
      input.actorUserId,
      input.key,
      input.operation,
      hash,
      input.statusCode,
      JSON.stringify({ oneTimeCredentialIssued: true }),
    ],
  );
  return value;
}
