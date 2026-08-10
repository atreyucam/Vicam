import {
  liveHealthSchema,
  readyHealthSchema,
  type LiveHealth,
  type ReadyHealth,
} from "@vicam/contracts";

export function workerLiveness(): LiveHealth {
  return liveHealthSchema.parse({
    status: "ok",
    service: "worker",
    timestamp: new Date().toISOString(),
  });
}

export async function workerReadiness(
  databaseProbe: () => Promise<void>,
  queueStarted: boolean,
): Promise<{ body: ReadyHealth; status: 200 | 503 }> {
  try {
    await databaseProbe();
    if (!queueStarted) {
      return {
        status: 503,
        body: readyHealthSchema.parse({
          status: "degraded",
          service: "worker",
          timestamp: new Date().toISOString(),
          checks: { database: "up" },
        }),
      };
    }
    return {
      status: 200,
      body: readyHealthSchema.parse({
        status: "ok",
        service: "worker",
        timestamp: new Date().toISOString(),
        checks: { database: "up" },
      }),
    };
  } catch {
    return {
      status: 503,
      body: readyHealthSchema.parse({
        status: "degraded",
        service: "worker",
        timestamp: new Date().toISOString(),
        checks: { database: "down" },
      }),
    };
  }
}
