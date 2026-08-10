import {
  changePasswordRequestSchema,
  loginRequestSchema,
  sessionTokenResponseSchema,
} from "@vicam/contracts";
import { Router } from "express";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { AppError } from "../errors.js";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "./authenticate.js";
import {
  clearSessionCookies,
  readCookie,
  refreshCookieName,
  requestIp,
  requireSecureTransport,
  requireTrustedOrigin,
  setSessionCookies,
} from "./http.js";
import { AuthService } from "./service.js";

const idSchema = z.uuid();

function mutationMeta(request: import("express").Request) {
  const key = request.headers["idempotency-key"];
  return {
    requestId: request.requestId,
    ipAddress: requestIp(request),
    ...(typeof key === "string" ? { idempotencyKey: key } : {}),
  };
}

export function createAuthRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const service = new AuthService(pool, config.AUTH_SECRET);
  const production = config.NODE_ENV === "production";
  const bearer = authenticate(pool, config.AUTH_SECRET);

  router.post("/login", async (request, response, next) => {
    try {
      requireSecureTransport(request, production);
      requireTrustedOrigin(request, config.APP_ORIGIN);
      const input = loginRequestSchema.parse(request.body);
      const issued = await service.login(input, {
        requestId: request.requestId,
        ipAddress: requestIp(request),
      });
      setSessionCookies(response, issued.refreshToken, issued.response.csrfToken, production);
      response.status(200).json(sessionTokenResponseSchema.parse(issued.response));
    } catch (error) {
      next(error);
    }
  });

  router.post("/refresh", async (request, response, next) => {
    try {
      requireSecureTransport(request, production);
      requireTrustedOrigin(request, config.APP_ORIGIN);
      const refresh = readCookie(request, refreshCookieName);
      const csrf = request.headers["x-csrf-token"];
      if (refresh === undefined) {
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Se requiere iniciar sesión.");
      }
      if (typeof csrf !== "string")
        throw new AppError(403, "INVALID_CSRF_TOKEN", "La protección CSRF no es válida.");
      const issued = await service.refresh(refresh, csrf, {
        requestId: request.requestId,
        ipAddress: requestIp(request),
      });
      setSessionCookies(response, issued.refreshToken, issued.response.csrfToken, production);
      response.status(200).json(sessionTokenResponseSchema.parse(issued.response));
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (request, response, next) => {
    try {
      requireSecureTransport(request, production);
      requireTrustedOrigin(request, config.APP_ORIGIN);
      const refresh = readCookie(request, refreshCookieName);
      const csrf = request.headers["x-csrf-token"];
      if (refresh === undefined)
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Se requiere iniciar sesión.");
      if (typeof csrf !== "string")
        throw new AppError(403, "INVALID_CSRF_TOKEN", "La protección CSRF no es válida.");
      await service.logout(refresh, csrf, mutationMeta(request));
      clearSessionCookies(response, production);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", bearer, async (request, response, next) => {
    try {
      response.json(await service.me(requireAuth(request).userId));
    } catch (error) {
      next(error);
    }
  });
  router.get(
    "/sessions",
    bearer,
    requirePasswordChangeComplete,
    async (request, response, next) => {
      try {
        const auth = requireAuth(request);
        response.json(await service.sessions(auth.userId, auth.sessionId));
      } catch (error) {
        next(error);
      }
    },
  );
  router.delete(
    "/sessions/:id",
    bearer,
    requirePasswordChangeComplete,
    async (request, response, next) => {
      try {
        const auth = requireAuth(request);
        await service.revokeSession(
          auth.userId,
          idSchema.parse(request.params.id),
          auth.deviceId,
          mutationMeta(request),
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );
  router.post("/change-password", bearer, async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const input = changePasswordRequestSchema.parse(request.body);
      await service.changePassword(
        auth.userId,
        input.currentPassword,
        input.newPassword,
        auth.sessionId,
        auth.deviceId,
        mutationMeta(request),
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
