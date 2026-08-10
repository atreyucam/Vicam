import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  closeDatabase,
  createDatabaseClient,
  readDatabaseConfig,
  type DatabaseClient,
} from "@vicam/db";

import { hashPassword } from "../auth/password.js";
import type { DbPool } from "../db.js";
import { inTransaction, writeAudit } from "../db.js";
import { generatedInitialPassword } from "../domain/shared.js";
import { AppError } from "../errors.js";

export async function resetActiveManagerPassword(
  pool: DbPool,
  username: string,
): Promise<{ userId: string; temporaryPassword: string }> {
  if (username.trim() !== username || username.length < 1 || username.length > 100) {
    throw new AppError(422, "INVALID_MANAGER_USERNAME", "El username objetivo no es válido.");
  }
  return inTransaction(pool, async (client) => {
    const found = await client.query<{ id: string; must_change_password: boolean }>(
      `select id,must_change_password from users
       where username=$1 and role='MANAGER' and status='ACTIVE' for update`,
      [username],
    );
    const manager = found.rows[0];
    if (manager === undefined) {
      throw new AppError(
        404,
        "ACTIVE_MANAGER_NOT_FOUND",
        "No existe un Manager activo con ese username exacto.",
      );
    }
    const temporaryPassword = generatedInitialPassword();
    await client.query(
      `update users set password_hash=$2,must_change_password=true,updated_at=now(),updated_by=$1
       where id=$1`,
      [manager.id, await hashPassword(temporaryPassword)],
    );
    await client.query(
      "update user_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1",
      [manager.id],
    );
    await client.query(
      "update devices set status='REVOKED',updated_at=now(),updated_by=$1 where user_id=$1",
      [manager.id],
    );
    await writeAudit(client, {
      actorUserId: null,
      action: "MANAGER_PASSWORD_RESET_CLI",
      entityType: "user",
      entityId: manager.id,
      requestId: `cli-${randomUUID()}`,
      before: { mustChangePassword: manager.must_change_password },
      after: { mustChangePassword: true, sessionsRevoked: true },
    });
    return { userId: manager.id, temporaryPassword };
  });
}

export async function executeManagerPasswordReset(
  pool: DbPool,
  username: string,
  write: (value: string) => void,
): Promise<void> {
  const result = await resetActiveManagerPassword(pool, username);
  write(`${result.temporaryPassword}\n`);
}

export function managerUsernameFromInput(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): string {
  let argumentUsername: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("--username=")) {
      argumentUsername = argument.slice("--username=".length);
      continue;
    }
    if (argument === "--username") {
      argumentUsername = argv[index + 1];
      index += 1;
      continue;
    }
    throw new AppError(422, "INVALID_CLI_ARGUMENT", "Use únicamente --username.");
  }
  const environmentUsername = environment.VICAM_MANAGER_USERNAME;
  if (
    argumentUsername !== undefined &&
    environmentUsername !== undefined &&
    argumentUsername !== environmentUsername
  ) {
    throw new AppError(422, "AMBIGUOUS_MANAGER_USERNAME", "El username difiere entre arg y env.");
  }
  const username = argumentUsername ?? environmentUsername;
  if (username === undefined) {
    throw new AppError(
      422,
      "MANAGER_USERNAME_REQUIRED",
      "Indique --username o VICAM_MANAGER_USERNAME.",
    );
  }
  return username;
}

async function main(): Promise<void> {
  const username = managerUsernameFromInput(process.argv.slice(2), process.env);
  const database: DatabaseClient = createDatabaseClient(readDatabaseConfig());
  try {
    await executeManagerPasswordReset(database.pool, username, (value) =>
      process.stdout.write(value),
    );
  } finally {
    await closeDatabase(database.pool);
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "MANAGER_RESET_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
