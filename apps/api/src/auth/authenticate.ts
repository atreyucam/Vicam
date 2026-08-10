import type { RequestHandler } from "express";

import type { DbPool } from "../db.js";
import { AppError } from "../errors.js";
import { verifyAccessToken } from "./tokens.js";

export function authenticate(pool: DbPool, secret: string): RequestHandler {
  return async (request, _response, next) => {
    try {
      const authorization = request.headers.authorization;
      if (authorization === undefined || !authorization.startsWith("Bearer ")) {
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Se requiere iniciar sesión.");
      }
      const payload = verifyAccessToken(authorization.slice(7), secret);
      const result = await pool.query<{
        user_id: string;
        role: "MANAGER" | "SUPERVISOR";
        device_id: string;
        must_change_password: boolean;
      }>(
        `select s.user_id, u.role, s.device_id, u.must_change_password
         from user_sessions s join users u on u.id=s.user_id join devices d on d.id=s.device_id
         where s.id=$1 and s.user_id=$2 and s.device_id=$3 and s.revoked_at is null
           and s.expires_at > now() and u.status='ACTIVE' and d.status='ACTIVE'`,
        [payload.sid, payload.sub, payload.did],
      );
      const row = result.rows[0];
      if (row === undefined || row.role !== payload.role) {
        throw new AppError(401, "SESSION_REVOKED", "La sesión ya no está activa.");
      }
      request.auth = {
        userId: row.user_id,
        role: row.role,
        sessionId: payload.sid,
        deviceId: row.device_id,
        mustChangePassword: row.must_change_password,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(request: Express.Request): NonNullable<Express.Request["auth"]> {
  if (request.auth === undefined)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Se requiere iniciar sesión.");
  return request.auth;
}

export function requireManager(request: Express.Request): NonNullable<Express.Request["auth"]> {
  const auth = requireAuth(request);
  if (auth.role !== "MANAGER")
    throw new AppError(403, "INSUFFICIENT_ROLE", "No tiene permiso para esta operación.");
  return auth;
}

export const requirePasswordChangeComplete: RequestHandler = (request, _response, next) => {
  try {
    if (requireAuth(request).mustChangePassword) {
      throw new AppError(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "Debe cambiar la contraseña temporal antes de continuar.",
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};
