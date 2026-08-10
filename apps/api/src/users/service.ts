import { randomUUID } from "node:crypto";

import {
  type createUserRequestSchema,
  temporaryCredentialSchema,
  type updateUserRequestSchema,
  type usersQuerySchema,
  usersPageSchema,
} from "@vicam/contracts";
import type { z } from "zod";

import { hashPassword } from "../auth/password.js";
import type { DbPool } from "../db.js";
import { idempotentMutation, inTransaction, oneTimeSecretMutation, writeAudit } from "../db.js";
import { AppError } from "../errors.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { generatedInitialPassword, isPgError, pagination } from "../domain/shared.js";
import { mapUser } from "../domain/rows.js";

type UsersQuery = z.infer<typeof usersQuerySchema>;
type CreateUser = z.infer<typeof createUserRequestSchema>;
type UpdateUser = z.infer<typeof updateUserRequestSchema>;

export class UsersService {
  constructor(private readonly pool: DbPool) {}

  async list(query: UsersQuery) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.search !== undefined) {
      values.push(`%${query.search}%`);
      where.push(`(username ilike $${values.length} or full_name ilike $${values.length})`);
    }
    if (query.role !== undefined) {
      values.push(query.role);
      where.push(`role=$${values.length}`);
    }
    if (query.status !== undefined) {
      values.push(query.status);
      where.push(`status=$${values.length}`);
    }
    const clause = where.length === 0 ? "" : `where ${where.join(" and ")}`;
    const count = await this.pool.query<{ total: number }>(
      `select count(*)::integer total from users ${clause}`,
      values,
    );
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(
      `select * from users ${clause} order by lower(username),id limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    const total = count.rows[0]?.total ?? 0;
    return usersPageSchema.parse({
      items: result.rows.map(mapUser),
      pagination: pagination(query.page, query.pageSize, total),
    });
  }

  async create(input: CreateUser, actor: Actor, meta: RequestMeta) {
    try {
      return await inTransaction(this.pool, async (client) => {
        return oneTimeSecretMutation(
          client,
          {
            actorUserId: actor.userId,
            key: meta.idempotencyKey,
            operation: "user.create",
            request: input,
            statusCode: 201,
          },
          async () => {
            const id = randomUUID();
            const temporaryPassword = generatedInitialPassword();
            const passwordHash = await hashPassword(temporaryPassword);
            const result = await client.query(
              `insert into users
             (id,username,full_name,role,password_hash,status,must_change_password,created_by,updated_by)
           values ($1,$2,$3,$4,$5,'ACTIVE',true,$6,$6) returning *`,
              [id, input.username, input.fullName, input.role, passwordHash, actor.userId],
            );
            const user = mapUser(result.rows[0] as Record<string, unknown>);
            await writeAudit(client, {
              actorUserId: actor.userId,
              action: "USER_CREATED",
              entityType: "user",
              entityId: id,
              requestId: meta.requestId,
              deviceId: actor.deviceId,
              ipAddress: meta.ipAddress,
              after: {
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                status: user.status,
                mustChangePassword: true,
              },
            });
            return temporaryCredentialSchema.parse({ user, temporaryPassword });
          },
        );
      });
    } catch (error) {
      if (isPgError(error, "23505"))
        throw new AppError(409, "USERNAME_CONFLICT", "El nombre de usuario ya existe.");
      throw error;
    }
  }

  async resetPassword(id: string, actor: Actor, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) =>
      oneTimeSecretMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: `user.reset-password:${id}`,
          request: {},
          statusCode: 200,
        },
        async () => {
          const found = await client.query<Record<string, unknown>>(
            "select * from users where id=$1 for update",
            [id],
          );
          const before = found.rows[0];
          if (before === undefined) {
            throw new AppError(404, "USER_NOT_FOUND", "El usuario no está disponible.");
          }
          if (before.role !== "SUPERVISOR") {
            throw new AppError(
              403,
              "PASSWORD_RESET_FORBIDDEN",
              "El restablecimiento administrativo solo está permitido para Supervisores.",
            );
          }
          const temporaryPassword = generatedInitialPassword();
          const result = await client.query<Record<string, unknown>>(
            `update users set password_hash=$2,must_change_password=true,updated_at=now(),updated_by=$3
             where id=$1 returning *`,
            [id, await hashPassword(temporaryPassword), actor.userId],
          );
          await client.query(
            "update user_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1",
            [id],
          );
          await client.query(
            "update devices set status='REVOKED',updated_at=now(),updated_by=$2 where user_id=$1",
            [id, actor.userId],
          );
          const user = mapUser(result.rows[0]!);
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "USER_PASSWORD_RESET",
            entityType: "user",
            entityId: id,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            before: { mustChangePassword: before.must_change_password },
            after: { mustChangePassword: true, sessionsRevoked: true },
          });
          return temporaryCredentialSchema.parse({ user, temporaryPassword });
        },
      ),
    );
  }

  async update(id: string, input: UpdateUser, actor: Actor, meta: RequestMeta) {
    return inTransaction(this.pool, async (client) => {
      const idempotent = await idempotentMutation(
        client,
        {
          actorUserId: actor.userId,
          key: meta.idempotencyKey,
          operation: `user.update:${id}`,
          request: input,
          statusCode: 200,
        },
        async () => {
          const found = await client.query<Record<string, unknown>>(
            "select * from users where id=$1 for update",
            [id],
          );
          const beforeRow = found.rows[0];
          if (beforeRow === undefined)
            throw new AppError(404, "USER_NOT_FOUND", "El usuario no está disponible.");
          if (input.status === "INACTIVE") {
            const assigned = await client.query<{ total: number }>(
              `select (
             (select count(*) from commercial_accounts where owner_user_id=$1 and status='ACTIVE') +
             (select count(*) from visits where responsible_user_id=$1 and status='PENDING') +
             (select count(*) from tasks where responsible_user_id=$1 and status in ('PENDING','IN_PROGRESS'))
           )::integer total`,
              [id],
            );
            if ((assigned.rows[0]?.total ?? 0) > 0) {
              throw new AppError(
                422,
                "USER_HAS_ACTIVE_ASSIGNMENTS",
                "Reasigne las cuentas, visitas y tareas abiertas antes de desactivar al usuario.",
              );
            }
          }
          const result = await client.query(
            `update users set
           full_name=coalesce($2,full_name), role=coalesce($3,role),
           status=coalesce($4,status), updated_at=now(), updated_by=$5
         where id=$1 returning *`,
            [id, input.fullName ?? null, input.role ?? null, input.status ?? null, actor.userId],
          );
          let sessionsRevoked = false;
          let devicesRevoked = false;
          let offlineGrantsRevoked = false;
          if (input.status === "INACTIVE") {
            const sessions = await client.query(
              "update user_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1",
              [id],
            );
            const devices = await client.query(
              "update devices set status='REVOKED',updated_at=now(),updated_by=$2 where user_id=$1 and status<>'REVOKED'",
              [id, actor.userId],
            );
            const grants = await client.query(
              "update offline_grants set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null",
              [id],
            );
            sessionsRevoked = (sessions.rowCount ?? 0) > 0;
            devicesRevoked = (devices.rowCount ?? 0) > 0;
            offlineGrantsRevoked = (grants.rowCount ?? 0) > 0;
          }
          const user = mapUser(result.rows[0] as Record<string, unknown>);
          await writeAudit(client, {
            actorUserId: actor.userId,
            action: "USER_UPDATED",
            entityType: "user",
            entityId: id,
            requestId: meta.requestId,
            deviceId: actor.deviceId,
            ipAddress: meta.ipAddress,
            before: {
              fullName: beforeRow.full_name,
              role: beforeRow.role,
              status: beforeRow.status,
            },
            after: {
              fullName: user.fullName,
              role: user.role,
              status: user.status,
              ...(input.status === "INACTIVE"
                ? { sessionsRevoked, devicesRevoked, offlineGrantsRevoked }
                : {}),
            },
          });
          return user;
        },
      );
      return idempotent.value;
    });
  }
}
