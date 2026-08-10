import { z } from "zod";

const workerEnvironmentSchema = z.object({
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WORKER_HEALTH_HOST: z.string().min(1).default("0.0.0.0"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  DOCUMENT_STORAGE_ROOT: z.string().min(1).default("./.vicam-private"),
  CLAMD_HOST: z.string().min(1).optional(),
  CLAMD_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  VAPID_SUBJECT: z.string().url().optional(),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
});

export type WorkerConfig = z.infer<typeof workerEnvironmentSchema>;

export function readWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const config = workerEnvironmentSchema.parse(environment);
  const vapidValues = [
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  ].filter((value) => value !== undefined);
  if (vapidValues.length !== 0 && vapidValues.length !== 3)
    throw new Error(
      "VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together",
    );
  return config;
}
