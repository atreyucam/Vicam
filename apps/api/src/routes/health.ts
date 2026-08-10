import { liveHealthSchema, readyHealthSchema } from "@vicam/contracts";
import { Router } from "express";

export type DatabaseProbe = () => Promise<void>;

export function createHealthRouter(databaseProbe: DatabaseProbe): Router {
  const router = Router();

  router.get("/live", (_request, response) => {
    const body = liveHealthSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });
    response.status(200).json(body);
  });

  router.get("/ready", async (_request, response) => {
    try {
      await databaseProbe();
      const body = readyHealthSchema.parse({
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
        checks: { database: "up" },
      });
      response.status(200).json(body);
    } catch {
      const body = readyHealthSchema.parse({
        status: "degraded",
        service: "api",
        timestamp: new Date().toISOString(),
        checks: { database: "down" },
      });
      response.status(503).json(body);
    }
  });

  return router;
}
