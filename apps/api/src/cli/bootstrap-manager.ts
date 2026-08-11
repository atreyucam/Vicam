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

type BootstrapInput = { fullName: string; username: string };

function validate(input: BootstrapInput): BootstrapInput {
  const username = input.username.trim();
  const fullName = input.fullName.trim();
  if (username !== input.username || username.length < 1 || username.length > 100)
    throw new AppError(422, "INVALID_MANAGER_USERNAME", "El username inicial no es válido.");
  if (fullName !== input.fullName || fullName.length < 1 || fullName.length > 200)
    throw new AppError(422, "INVALID_MANAGER_FULL_NAME", "El nombre inicial no es válido.");
  return { username, fullName };
}

export async function bootstrapInitialManager(
  pool: DbPool,
  rawInput: BootstrapInput,
): Promise<{ temporaryPassword: string; userId: string }> {
  const input = validate(rawInput);
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      "vicam.bootstrap-initial-manager",
    ]);
    const count = await client.query<{ total: number }>(
      "select count(*)::integer total from users",
    );
    if ((count.rows[0]?.total ?? 0) !== 0) {
      throw new AppError(
        409,
        "INITIAL_MANAGER_ALREADY_CONFIGURED",
        "El bootstrap solo puede ejecutarse cuando no existe ningún usuario.",
      );
    }
    const userId = randomUUID();
    const temporaryPassword = generatedInitialPassword();
    await client.query(
      `insert into users
         (id,username,full_name,role,password_hash,status,must_change_password)
       values ($1,$2,$3,'MANAGER',$4,'ACTIVE',true)`,
      [userId, input.username, input.fullName, await hashPassword(temporaryPassword)],
    );
    await client.query(
      `insert into document_categories
         (id,name,normalized_name,active,created_by,updated_by)
       values ($1,'General','general',true,$1,$1)`,
      [userId],
    );
    await writeAudit(client, {
      actorUserId: null,
      action: "MANAGER_BOOTSTRAPPED_CLI",
      entityType: "user",
      entityId: userId,
      requestId: `cli-${randomUUID()}`,
      after: { fullName: input.fullName, role: "MANAGER", status: "ACTIVE" },
    });
    return { userId, temporaryPassword };
  });
}

export function bootstrapInputFromArguments(argv: readonly string[]): BootstrapInput {
  let username: string | undefined;
  let fullName: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") continue;
    if (argument === "--username") username = argv[++index];
    else if (argument.startsWith("--username=")) username = argument.slice(11);
    else if (argument === "--full-name") fullName = argv[++index];
    else if (argument.startsWith("--full-name=")) fullName = argument.slice(12);
    else
      throw new AppError(422, "INVALID_CLI_ARGUMENT", "Use únicamente --username y --full-name.");
  }
  if (username === undefined || fullName === undefined)
    throw new AppError(
      422,
      "INITIAL_MANAGER_IDENTITY_REQUIRED",
      "Indique --username y --full-name.",
    );
  return validate({ username, fullName });
}

async function main(): Promise<void> {
  const input = bootstrapInputFromArguments(process.argv.slice(2));
  const database: DatabaseClient = createDatabaseClient(readDatabaseConfig());
  try {
    const result = await bootstrapInitialManager(database.pool, input);
    process.stdout.write(`${result.temporaryPassword}\n`);
  } finally {
    await closeDatabase(database.pool);
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "MANAGER_BOOTSTRAP_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
