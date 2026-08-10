import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import type { DatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type DatabasePoolClient = PoolClient;

export function createDatabaseClient(config: DatabaseConfig) {
  const pool = new Pool({
    ...config,
    application_name: "vicam",
  });
  const db = drizzle({ client: pool, schema });

  return { db, pool };
}

export async function checkDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ users_table: string | null; reminders_table: string | null }>(
    "select to_regclass('public.users')::text as users_table, to_regclass('public.reminders')::text as reminders_table",
  );
  if (result.rows[0]?.users_table !== "users" || result.rows[0]?.reminders_table !== "reminders") {
    throw new Error("VICAM database migration is not applied");
  }
}

export async function closeDatabase(pool: Pool): Promise<void> {
  await pool.end();
}
