import { createHash, randomBytes } from "node:crypto";

import type { Request, Response } from "express";

import { AppError } from "../errors.js";

export const refreshCookieName = "vicam_refresh";
export const csrfCookieName = "vicam_csrf";

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readCookie(request: Request, name: string): string | undefined {
  const source = request.headers.cookie;
  if (source === undefined) return undefined;
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name)
      return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export function setSessionCookies(
  response: Response,
  refreshToken: string,
  csrfToken: string,
  production: boolean,
): void {
  response.setHeader("set-cookie", [
    `${refreshCookieName}=${encodeURIComponent(refreshToken)}; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Lax${production ? "; Secure" : ""}`,
    `${csrfCookieName}=${encodeURIComponent(csrfToken)}; Path=/; Max-Age=604800; SameSite=Lax${production ? "; Secure" : ""}`,
  ]);
}

export function clearSessionCookies(response: Response, production: boolean): void {
  response.setHeader("set-cookie", [
    `${refreshCookieName}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; SameSite=Lax${production ? "; Secure" : ""}`,
    `${csrfCookieName}=; Path=/; Max-Age=0; SameSite=Lax${production ? "; Secure" : ""}`,
  ]);
}

export function requireTrustedOrigin(request: Request, allowedOrigin: string): void {
  const origin = request.headers.origin;
  if (origin === undefined || origin !== allowedOrigin) {
    throw new AppError(403, "UNTRUSTED_ORIGIN", "El origen de la solicitud no está autorizado.");
  }
}

export function requireSecureTransport(request: Request, production: boolean): void {
  if (production && !request.secure) {
    throw new AppError(
      403,
      "HTTPS_REQUIRED",
      "La autenticación solo está disponible mediante el gateway HTTPS autorizado.",
    );
  }
}

export function requireCsrf(request: Request, expectedHash: string | null): void {
  const supplied = request.headers["x-csrf-token"];
  if (
    typeof supplied !== "string" ||
    expectedHash === null ||
    tokenHash(supplied) !== expectedHash
  ) {
    throw new AppError(403, "INVALID_CSRF_TOKEN", "La protección CSRF no es válida.");
  }
}

export function requestIp(request: Request): string | null {
  return request.ip || request.socket.remoteAddress || null;
}
