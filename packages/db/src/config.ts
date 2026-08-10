import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL must use the postgres or postgresql protocol",
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
  DATABASE_SSL: z.enum(["disable", "require"]).default("disable"),
});

export type DatabaseConfig = {
  connectionString: string;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  max: number;
  ssl: false | { rejectUnauthorized: true };
};

export function readDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.parse(environment);

  return {
    connectionString: parsed.DATABASE_URL,
    connectionTimeoutMillis: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: parsed.DATABASE_IDLE_TIMEOUT_MS,
    max: parsed.DATABASE_POOL_MAX,
    ssl: parsed.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : false,
  };
}
