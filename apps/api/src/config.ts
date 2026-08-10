import { z } from "zod";

const apiEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  AUTH_SECRET: z.string().min(32).default("vicam-development-secret-change-me-2026"),
  CADDY_TRUSTED_PROXIES: z
    .string()
    .default("127.0.0.1/32,::1/128")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OFFLINE_SYNC_ENABLED: z.enum(["true", "false"]).optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  DOCUMENT_STORAGE_ROOT: z.string().min(1).default("./.vicam-private"),
  CLAMD_HOST: z.string().min(1).optional(),
  CLAMD_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
});

type ParsedApiConfig = z.infer<typeof apiEnvironmentSchema>;
export type ApiConfig = Omit<ParsedApiConfig, "OFFLINE_SYNC_ENABLED"> & {
  OFFLINE_SYNC_ENABLED: boolean;
};

export function readApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiEnvironmentSchema.parse(environment);
  const config: ApiConfig = {
    ...parsed,
    OFFLINE_SYNC_ENABLED:
      parsed.OFFLINE_SYNC_ENABLED === undefined
        ? parsed.NODE_ENV !== "production"
        : parsed.OFFLINE_SYNC_ENABLED === "true",
  };
  if (config.NODE_ENV === "production" && config.AUTH_SECRET.includes("development")) {
    throw new Error("AUTH_SECRET must be configured in production");
  }
  if (
    config.CADDY_TRUSTED_PROXIES.some(
      (entry) => entry === "*" || entry === "0.0.0.0/0" || entry === "::/0",
    )
  ) {
    throw new Error("CADDY_TRUSTED_PROXIES must contain only known Caddy addresses or subnets");
  }
  if (config.NODE_ENV === "production" && environment.CADDY_TRUSTED_PROXIES === undefined) {
    throw new Error("CADDY_TRUSTED_PROXIES must be configured in production");
  }
  if (config.NODE_ENV === "production" && environment.DOCUMENT_STORAGE_ROOT === undefined) {
    throw new Error("DOCUMENT_STORAGE_ROOT must be configured in production");
  }
  return config;
}
