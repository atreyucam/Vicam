import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  authenticatedUserSchema,
  sessionTokenResponseSchema,
  userSessionSchema,
  type AuthenticatedUser,
  type LoginRequest,
  type SessionTokenResponse,
} from "@vicam/contracts";

import type { DbClient, DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { AppError } from "../errors.js";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password.js";
import { assertStrongPassword } from "./password-policy.js";
import { opaqueToken, tokenHash } from "./http.js";
import { issueAccessToken } from "./tokens.js";

const dummyPasswordHash =
  "$argon2id$v=19$m=19456,p=1,t=2$qVRGtxcqsVAeUhP8ZXAo7g$9joDtKwJSzJ1SeW/r7M01FNiiiyQcHUGBUEGa1Q4YZQ";

type Meta = { requestId: string; ipAddress: string | null; idempotencyKey?: string };
type SessionIssue = {
  response: SessionTokenResponse;
  refreshToken: string;
  sessionId: string;
  deviceId: string;
};

type UserRow = {
  id: string;
  username: string;
  full_name: string;
  role: "MANAGER" | "SUPERVISOR";
  password_hash: string;
  status: "ACTIVE" | "INACTIVE";
  must_change_password: boolean;
};

function authUser(row: UserRow): AuthenticatedUser {
  return authenticatedUserSchema.parse({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  });
}

async function issueSession(
  client: DbClient,
  user: UserRow,
  input: { deviceName: string; platform: string; familyId?: string; expiresAt?: Date },
  secret: string,
): Promise<SessionIssue> {
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  const familyId = input.familyId ?? randomUUID();
  const refreshToken = opaqueToken();
  const csrfToken = opaqueToken();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 7 * 86_400_000);
  await client.query(
    `insert into devices (id,user_id,name,platform,created_by,updated_by) values ($1,$2,$3,$4,$2,$2)`,
    [deviceId, user.id, input.deviceName, input.platform],
  );
  await client.query(
    `insert into user_sessions
       (id,user_id,device_id,refresh_token_hash,csrf_token_hash,family_id,expires_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      sessionId,
      user.id,
      deviceId,
      tokenHash(refreshToken),
      tokenHash(csrfToken),
      familyId,
      expiresAt,
    ],
  );
  const access = issueAccessToken(
    { sub: user.id, sid: sessionId, did: deviceId, role: user.role },
    secret,
  );
  return {
    refreshToken,
    sessionId,
    deviceId,
    response: sessionTokenResponseSchema.parse({
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      csrfToken,
      user: authUser(user),
    }),
  };
}

function attemptKey(username: string, ipAddress: string | null): string {
  return createHash("sha256")
    .update(`${username.trim().toLocaleLowerCase("en-US")}\0${ipAddress ?? "unknown"}`)
    .digest("hex");
}

async function recordFailedLogin(client: DbClient, key: string): Promise<number> {
  const result = await client.query<{ failure_count: number; blocked_until: Date | null }>(
    `insert into login_attempts (attempt_key,failure_count,last_failed_at,blocked_until)
     values ($1,1,now(),null)
     on conflict (attempt_key) do update set
       failure_count=login_attempts.failure_count+1,
       last_failed_at=now(), updated_at=now(),
       blocked_until=case when login_attempts.failure_count+1 >= 3
         then now() + make_interval(secs => least(300, power(2, login_attempts.failure_count-2)::integer))
         else null end
     returning failure_count, blocked_until`,
    [key],
  );
  const until = result.rows[0]?.blocked_until;
  return until === null || until === undefined
    ? 0
    : Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1_000));
}

export class AuthService {
  constructor(
    private readonly pool: DbPool,
    private readonly secret: string,
  ) {}

  async login(input: LoginRequest, meta: Meta): Promise<SessionIssue> {
    const outcome = await inTransaction(
      this.pool,
      async (client): Promise<SessionIssue | AppError> => {
        const key = attemptKey(input.username, meta.ipAddress);
        const attempt = await client.query<{ blocked_until: Date | null }>(
          "select blocked_until from login_attempts where attempt_key=$1 for update",
          [key],
        );
        const blockedUntil = attempt.rows[0]?.blocked_until;
        if (blockedUntil !== null && blockedUntil !== undefined && blockedUntil > new Date()) {
          const retryAfter = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1_000));
          throw new AppError(429, "LOGIN_RATE_LIMITED", "Espere antes de volver a intentarlo.", {
            retryAfter,
          });
        }
        const found = await client.query<UserRow>(
          "select * from users where lower(username)=lower($1) for update",
          [input.username],
        );
        const user = found.rows[0];
        const valid = await verifyPassword(
          user?.password_hash ?? dummyPasswordHash,
          input.password,
        );
        if (user === undefined || !valid || user.status !== "ACTIVE") {
          const retryAfter = await recordFailedLogin(client, key);
          await writeAudit(client, {
            actorUserId: user?.id ?? null,
            action: "LOGIN_FAILED",
            entityType: "session",
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            after: {
              reason: user?.status === "INACTIVE" ? "inactive_or_invalid" : "invalid_credentials",
              status: "REJECTED",
            },
          });
          if (retryAfter > 0)
            return new AppError(429, "LOGIN_RATE_LIMITED", "Espere antes de volver a intentarlo.", {
              retryAfter,
            });
          return new AppError(401, "INVALID_CREDENTIALS", "Las credenciales no son válidas.");
        }
        await client.query("delete from login_attempts where attempt_key=$1", [key]);
        if (passwordNeedsRehash(user.password_hash)) {
          user.password_hash = await hashPassword(input.password);
          await client.query("update users set password_hash=$2,updated_at=now() where id=$1", [
            user.id,
            user.password_hash,
          ]);
        }
        const issued = await issueSession(client, user, input, this.secret);
        await client.query("update users set last_login_at=now(),updated_at=now() where id=$1", [
          user.id,
        ]);
        await writeAudit(client, {
          actorUserId: user.id,
          action: "LOGIN_SUCCEEDED",
          entityType: "session",
          entityId: issued.sessionId,
          requestId: meta.requestId,
          deviceId: issued.deviceId,
          ipAddress: meta.ipAddress,
          after: { status: "ACTIVE", deviceId: issued.deviceId },
        });
        return issued;
      },
    );
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }

  async refresh(refreshToken: string, csrfToken: string, meta: Meta): Promise<SessionIssue> {
    const outcome = await inTransaction(
      this.pool,
      async (client): Promise<SessionIssue | AppError> => {
        const found = await client.query<
          UserRow & {
            session_id: string;
            device_id: string;
            device_name: string;
            platform: string;
            family_id: string;
            expires_at: Date;
            revoked_at: Date | null;
            replaced_by_session_id: string | null;
            csrf_token_hash: string | null;
          }
        >(
          `select u.*,s.id session_id,s.device_id,d.name device_name,d.platform,s.family_id,s.expires_at,
                s.revoked_at,s.replaced_by_session_id,s.csrf_token_hash
         from user_sessions s join users u on u.id=s.user_id join devices d on d.id=s.device_id
         where s.refresh_token_hash=$1 for update`,
          [tokenHash(refreshToken)],
        );
        const row = found.rows[0];
        if (row === undefined)
          throw new AppError(401, "INVALID_REFRESH_TOKEN", "La sesión no es válida.");
        if (row.csrf_token_hash === null || tokenHash(csrfToken) !== row.csrf_token_hash) {
          throw new AppError(403, "INVALID_CSRF_TOKEN", "La protección CSRF no es válida.");
        }
        if (row.revoked_at !== null || row.replaced_by_session_id !== null) {
          await client.query(
            "update user_sessions set revoked_at=coalesce(revoked_at,now()) where family_id=$1",
            [row.family_id],
          );
          await client.query(
            "update devices set status='REVOKED',updated_at=now() where user_id=$1 and id in (select device_id from user_sessions where family_id=$2)",
            [row.id, row.family_id],
          );
          await writeAudit(client, {
            actorUserId: row.id,
            action: "REFRESH_REUSE_DETECTED",
            entityType: "session",
            entityId: row.session_id,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            before: { status: "REVOKED" },
            after: { status: "REVOKED", familyRevoked: true },
          });
          return new AppError(401, "REFRESH_TOKEN_REUSED", "La familia de sesiones fue revocada.");
        }
        if (row.expires_at <= new Date() || row.status !== "ACTIVE") {
          await client.query(
            "update user_sessions set revoked_at=coalesce(revoked_at,now()) where family_id=$1",
            [row.family_id],
          );
          await writeAudit(client, {
            actorUserId: row.id,
            action: "SESSION_FAMILY_EXPIRED",
            entityType: "session",
            entityId: row.session_id,
            requestId: meta.requestId,
            deviceId: row.device_id,
            ipAddress: meta.ipAddress,
            before: { status: "ACTIVE" },
            after: { status: "REVOKED", familyRevoked: true },
          });
          return new AppError(401, "REFRESH_TOKEN_EXPIRED", "La sesión ha vencido.");
        }
        const nextRefresh = opaqueToken();
        const nextCsrf = opaqueToken();
        const nextSessionId = randomUUID();
        await client.query(
          `insert into user_sessions
           (id,user_id,device_id,refresh_token_hash,csrf_token_hash,family_id,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            nextSessionId,
            row.id,
            row.device_id,
            tokenHash(nextRefresh),
            tokenHash(nextCsrf),
            row.family_id,
            row.expires_at,
          ],
        );
        await client.query(
          "update user_sessions set revoked_at=now(),last_used_at=now(),replaced_by_session_id=$2 where id=$1",
          [row.session_id, nextSessionId],
        );
        await client.query("update devices set last_seen_at=now(),updated_at=now() where id=$1", [
          row.device_id,
        ]);
        await writeAudit(client, {
          actorUserId: row.id,
          action: "REFRESH_ROTATED",
          entityType: "session",
          entityId: nextSessionId,
          requestId: meta.requestId,
          deviceId: row.device_id,
          ipAddress: meta.ipAddress,
          before: { status: "ACTIVE", previousSessionId: row.session_id },
          after: { status: "ACTIVE", rotatedFromSessionId: row.session_id },
        });
        const access = issueAccessToken(
          { sub: row.id, sid: nextSessionId, did: row.device_id, role: row.role },
          this.secret,
        );
        return {
          refreshToken: nextRefresh,
          sessionId: nextSessionId,
          deviceId: row.device_id,
          response: sessionTokenResponseSchema.parse({
            accessToken: access.token,
            accessTokenExpiresAt: access.expiresAt.toISOString(),
            csrfToken: nextCsrf,
            user: authUser(row),
          }),
        };
      },
    );
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }

  async logout(refreshToken: string, csrfToken: string, meta: Meta): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const found = await client.query<{
        id: string;
        user_id: string;
        device_id: string;
        csrf_token_hash: string | null;
      }>(
        "select id,user_id,device_id,csrf_token_hash from user_sessions where refresh_token_hash=$1 for update",
        [tokenHash(refreshToken)],
      );
      const row = found.rows[0];
      if (row === undefined)
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "La sesión no es válida.");
      if (row.csrf_token_hash === null || tokenHash(csrfToken) !== row.csrf_token_hash) {
        throw new AppError(403, "INVALID_CSRF_TOKEN", "La protección CSRF no es válida.");
      }
      await idempotentMutation(
        client,
        {
          actorUserId: row.user_id,
          key: meta.idempotencyKey,
          operation: `session.logout:${row.id}`,
          request: {},
          statusCode: 204,
        },
        async () => {
          await client.query(
            "update user_sessions set revoked_at=coalesce(revoked_at,now()) where id=$1",
            [row.id],
          );
          await client.query("update devices set status='REVOKED',updated_at=now() where id=$1", [
            row.device_id,
          ]);
          await writeAudit(client, {
            actorUserId: row.user_id,
            action: "LOGOUT",
            entityType: "session",
            entityId: row.id,
            requestId: meta.requestId,
            deviceId: row.device_id,
            ipAddress: meta.ipAddress,
            before: { status: "ACTIVE" },
            after: { status: "REVOKED" },
          });
          return { ok: true };
        },
      );
    });
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const result = await this.pool.query<UserRow>(
      "select * from users where id=$1 and status='ACTIVE'",
      [userId],
    );
    const user = result.rows[0];
    if (user === undefined)
      throw new AppError(401, "SESSION_REVOKED", "La sesión ya no está activa.");
    return authUser(user);
  }

  async sessions(userId: string, currentSessionId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `select s.id,s.device_id,d.name device_name,d.platform,s.created_at,s.last_used_at,s.expires_at
       from user_sessions s join devices d on d.id=s.device_id
       where s.user_id=$1 and s.revoked_at is null and s.expires_at>now() order by s.created_at desc`,
      [userId],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      userSessionSchema.parse({
        id: row.id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        platform: row.platform,
        createdAt: (row.created_at as Date).toISOString(),
        lastUsedAt: row.last_used_at === null ? null : (row.last_used_at as Date).toISOString(),
        expiresAt: (row.expires_at as Date).toISOString(),
        current: row.id === currentSessionId,
      }),
    );
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    actorDeviceId: string,
    meta: Meta,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await idempotentMutation(
        client,
        {
          actorUserId: userId,
          key: meta.idempotencyKey,
          operation: `session.revoke:${sessionId}`,
          request: {},
          statusCode: 204,
        },
        async () => {
          const result = await client.query<{ device_id: string }>(
            "select device_id from user_sessions where id=$1 and user_id=$2 and revoked_at is null for update",
            [sessionId, userId],
          );
          const row = result.rows[0];
          if (row === undefined)
            throw new AppError(404, "SESSION_NOT_FOUND", "La sesión no está disponible.");
          await client.query("update user_sessions set revoked_at=now() where id=$1", [sessionId]);
          await client.query("update devices set status='REVOKED',updated_at=now() where id=$1", [
            row.device_id,
          ]);
          await writeAudit(client, {
            actorUserId: userId,
            action: "SESSION_REVOKED",
            entityType: "session",
            entityId: sessionId,
            requestId: meta.requestId,
            deviceId: actorDeviceId,
            ipAddress: meta.ipAddress,
            before: { status: "ACTIVE" },
            after: { status: "REVOKED" },
          });
          return { ok: true };
        },
      );
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
    actorDeviceId: string,
    meta: Meta,
  ): Promise<void> {
    assertStrongPassword(newPassword);
    await inTransaction(this.pool, async (client) => {
      await idempotentMutation(
        client,
        {
          actorUserId: userId,
          key: meta.idempotencyKey,
          operation: `user.change-password:${userId}`,
          request: {
            fingerprint: createHmac("sha256", this.secret)
              .update(`${currentPassword}\0${newPassword}`)
              .digest("hex"),
          },
          statusCode: 204,
        },
        async () => {
          const found = await client.query<UserRow>(
            "select * from users where id=$1 and status='ACTIVE' for update",
            [userId],
          );
          const user = found.rows[0];
          if (user === undefined || !(await verifyPassword(user.password_hash, currentPassword))) {
            throw new AppError(
              401,
              "INVALID_CURRENT_PASSWORD",
              "La contraseña actual no es válida.",
            );
          }
          if (await verifyPassword(user.password_hash, newPassword)) {
            throw new AppError(
              422,
              "PASSWORD_UNCHANGED",
              "La nueva contraseña debe ser diferente.",
            );
          }
          await client.query(
            "update users set password_hash=$2,must_change_password=false,updated_at=now(),updated_by=$1 where id=$1",
            [userId, await hashPassword(newPassword)],
          );
          await client.query(
            "update user_sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null",
            [userId, currentSessionId],
          );
          await writeAudit(client, {
            actorUserId: userId,
            action: "PASSWORD_CHANGED",
            entityType: "user",
            entityId: userId,
            requestId: meta.requestId,
            deviceId: actorDeviceId,
            ipAddress: meta.ipAddress,
            before: { mustChangePassword: user.must_change_password },
            after: { mustChangePassword: false, sessionsRevoked: true },
          });
          return { ok: true };
        },
      );
    });
  }
}
