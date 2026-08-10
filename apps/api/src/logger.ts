import pino, { type DestinationStream, type Logger } from "pino";

const sensitivePaths = [
  "password",
  "passwordHash",
  "temporaryPassword",
  "token",
  "accessToken",
  "refreshToken",
  "pin",
  "document",
  "documentContent",
  "file",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.temporaryPassword",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.pin",
  "*.documentContent",
];

export function createLogger(level = "info", destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "vicam-api" },
    redact: { paths: sensitivePaths, censor: "[REDACTED]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function safeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { errorName: error.name, ...(code === undefined ? {} : { errorCode: code }) };
}
