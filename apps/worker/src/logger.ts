import pino, { type DestinationStream, type Logger } from "pino";

const sensitivePaths = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "pin",
  "document",
  "documentContent",
  "file",
  "job.data",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.pin",
  "*.documentContent",
];

export function createLogger(level = "info", destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "vicam-worker" },
    redact: { paths: sensitivePaths, censor: "[REDACTED]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function safeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { errorName: error.name, ...(code === undefined ? {} : { errorCode: code }) };
}
