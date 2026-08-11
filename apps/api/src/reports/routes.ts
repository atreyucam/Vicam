import {
  reportAnalyticsQuerySchema,
  reportAnalyticsResponseSchema,
  reportAnalyticsViewSchema,
} from "@vicam/contracts";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { requireAuth } from "../auth/authenticate.js";
import type { DbPool } from "../db.js";
import { ReportsAnalyticsService } from "./service.js";

/**
 * This router intentionally does not install authentication middleware itself.
 * It must be mounted below the API's existing authenticate/password-change guard.
 */
export function createReportsAnalyticsRouter(pool: DbPool): ExpressRouter {
  const router = Router();
  const service = new ReportsAnalyticsService(pool);

  router.get("/reports/analytics/:view", async (request, response, next) => {
    try {
      const actor = requireAuth(request);
      const view = reportAnalyticsViewSchema.parse(request.params.view);
      const query = reportAnalyticsQuerySchema.parse(request.query);
      const result = await service.load(view, query, actor);
      response.json(reportAnalyticsResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
