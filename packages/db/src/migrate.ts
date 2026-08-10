import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

import { createDatabaseClient } from "./client.js";
import type { DatabaseConfig } from "./config.js";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(config: DatabaseConfig): Promise<void> {
  const { db, pool } = createDatabaseClient({ ...config, max: 1 });

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export async function migratePool(pool: Pool): Promise<void> {
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder });
}
