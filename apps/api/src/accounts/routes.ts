import {
  accountsQuerySchema,
  commercialAccountSchema,
  commercialAccountsPageSchema,
  commercialAccountSummarySchema,
  commercialContactSchema,
  createCommercialAccountRequestSchema,
  createCommercialContactRequestSchema,
  updateCommercialAccountRequestSchema,
  updateCommercialContactRequestSchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { AccountsService } from "./service.js";

function meta(request: Request) {
  const key = request.headers["idempotency-key"];
  return {
    requestId: request.requestId,
    ipAddress: requestIp(request),
    ...(typeof key === "string" ? { idempotencyKey: key } : {}),
  };
}

function updateAccountInput(body: unknown) {
  const parsed = updateCommercialAccountRequestSchema.parse(body);
  if (
    typeof body === "object" &&
    body !== null &&
    !Object.prototype.hasOwnProperty.call(body, "fruitIds")
  ) {
    delete parsed.fruitIds;
  }
  return parsed;
}
export function createAccountsRouter(pool: DbPool, config: ApiConfig): Router {
  const router = Router();
  const service = new AccountsService(pool);
  router.use(authenticate(pool, config.AUTH_SECRET));
  router.use(requirePasswordChangeComplete);
  router.get("/", async (req, res, next) => {
    try {
      res.json(
        commercialAccountsPageSchema.parse(
          await service.list(accountsQuerySchema.parse(req.query), requireAuth(req)),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      res
        .status(201)
        .json(
          commercialAccountSchema.parse(
            await service.create(
              createCommercialAccountRequestSchema.parse(req.body),
              requireAuth(req),
              meta(req),
            ),
          ),
        );
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      res.json(
        commercialAccountSchema.parse(
          await service.get(z.uuid().parse(req.params.id), requireAuth(req)),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id/commercial-summary", async (req, res, next) => {
    try {
      res.json(
        commercialAccountSummarySchema.parse(
          await service.commercialSummary(z.uuid().parse(req.params.id), requireAuth(req)),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.patch("/:id", async (req, res, next) => {
    try {
      res.json(
        commercialAccountSchema.parse(
          await service.update(
            z.uuid().parse(req.params.id),
            updateAccountInput(req.body),
            requireAuth(req),
            meta(req),
          ),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id/contacts", async (req, res, next) => {
    try {
      res.json(
        z
          .array(commercialContactSchema)
          .parse(await service.contacts(z.uuid().parse(req.params.id), requireAuth(req))),
      );
    } catch (e) {
      next(e);
    }
  });
  router.post("/:id/contacts", async (req, res, next) => {
    try {
      res
        .status(201)
        .json(
          commercialContactSchema.parse(
            await service.createContact(
              z.uuid().parse(req.params.id),
              createCommercialContactRequestSchema.parse(req.body),
              requireAuth(req),
              meta(req),
            ),
          ),
        );
    } catch (e) {
      next(e);
    }
  });
  router.patch("/:id/contacts/:contactId", async (req, res, next) => {
    try {
      res.json(
        commercialContactSchema.parse(
          await service.updateContact(
            z.uuid().parse(req.params.id),
            z.uuid().parse(req.params.contactId),
            updateCommercialContactRequestSchema.parse(req.body),
            requireAuth(req),
            meta(req),
          ),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  return router;
}
