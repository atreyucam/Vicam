import { createHash } from "node:crypto";

import { AppError } from "../errors.js";

export type Actor = {
  userId: string;
  role: "MANAGER" | "SUPERVISOR";
  sessionId: string;
  deviceId: string;
};

export type RequestMeta = {
  requestId: string;
  ipAddress: string | null;
  idempotencyKey?: string;
};

export function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function assertCanAssign(actor: Actor, targetUserId: string): void {
  if (actor.role !== "MANAGER" && actor.userId !== targetUserId) {
    throw new AppError(
      403,
      "ASSIGNMENT_FORBIDDEN",
      "No tiene permiso para asignar otro responsable.",
    );
  }
}

export function isPgError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function safeChangedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

export function generatedInitialPassword(): string {
  return `${createHash("sha256").update(crypto.randomUUID()).digest("base64url")}!Aa1`;
}
