import { closeDatabase, createDatabaseClient } from "./client.js";
import { readDatabaseConfig } from "./config.js";
import { seedDevelopmentData } from "./seed.js";

if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") {
  throw new Error("Development seed is disabled outside local development and tests");
}

const { pool } = createDatabaseClient(readDatabaseConfig());
try {
  await seedDevelopmentData(pool);
} finally {
  await closeDatabase(pool);
}
