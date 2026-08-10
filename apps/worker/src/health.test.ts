import { describe, expect, it, vi } from "vitest";

import { workerLiveness, workerReadiness } from "./health.js";

describe("worker health", () => {
  it("returns the shared liveness shape", () => {
    expect(workerLiveness()).toMatchObject({ status: "ok", service: "worker" });
  });

  it("is ready only when pg-boss is started and PostgreSQL responds", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(undefined);
    await expect(workerReadiness(databaseProbe, true)).resolves.toMatchObject({
      status: 200,
      body: { status: "ok", checks: { database: "up" } },
    });
    expect(databaseProbe).toHaveBeenCalledOnce();
  });

  it("is degraded while the queue is stopped", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(undefined);
    await expect(workerReadiness(databaseProbe, false)).resolves.toMatchObject({
      status: 503,
      body: { status: "degraded", checks: { database: "up" } },
    });
    expect(databaseProbe).toHaveBeenCalledOnce();
  });

  it("is degraded when PostgreSQL is unavailable", async () => {
    const databaseProbe = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(workerReadiness(databaseProbe, true)).resolves.toMatchObject({
      status: 503,
      body: { status: "degraded", checks: { database: "down" } },
    });
  });
});
