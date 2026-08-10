import { migrateDatabase } from "./migrate.js";
import { readDatabaseConfig } from "./config.js";

await migrateDatabase(readDatabaseConfig());
