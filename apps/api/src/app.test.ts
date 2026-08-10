import pino from "pino";
import { Writable } from "node:stream";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { createLogger } from "./logger.js";

const logger = pino({ enabled: false });

describe("API foundation", () => {
  it("returns the shared liveness contract and a request id", async () => {
    const response = await request(createApp({ databaseProbe: vi.fn(), logger }))
      .get("/api/v1/health/live")
      .set("x-request-id", "test-request-1");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("test-request-1");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
    expect(response.body).toMatchObject({ status: "ok", service: "api" });
  });

  it("reports ready only after a successful database probe", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp({ databaseProbe, logger })).get(
      "/api/v1/health/ready",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", checks: { database: "up" } });
    expect(databaseProbe).toHaveBeenCalledOnce();
  });

  it("returns degraded readiness without exposing the database error", async () => {
    const databaseProbe = vi.fn().mockRejectedValue(new Error("contains-sensitive-hostname"));
    const response = await request(createApp({ databaseProbe, logger })).get(
      "/api/v1/health/ready",
    );

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "degraded", checks: { database: "down" } });
    expect(response.text).not.toContain("contains-sensitive-hostname");
  });

  it("uses the standard error envelope for unknown resources", async () => {
    const response = await request(createApp({ databaseProbe: vi.fn(), logger })).get(
      "/api/v1/not-found",
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: "El recurso solicitado no está disponible.",
    });
    expect(response.body).toHaveProperty("requestId", expect.any(String));
  });

  it("accepts forwarded client IP only from an allowlisted Caddy hop", async () => {
    const addresses: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        const entry = JSON.parse(String(chunk)) as {
          request?: { remoteAddress?: string };
        };
        if (entry.request?.remoteAddress !== undefined) addresses.push(entry.request.remoteAddress);
        callback();
      },
    });
    const trusted = createApp({
      config: readApiConfig({ NODE_ENV: "test", CADDY_TRUSTED_PROXIES: "127.0.0.0/8" }),
      databaseProbe: vi.fn(),
      logger: createLogger("info", destination),
    });
    await request(trusted)
      .get("/api/v1/health/live")
      .set("x-forwarded-for", "198.51.100.44")
      .set("x-forwarded-proto", "https");
    await new Promise((resolve) => setImmediate(resolve));
    expect(addresses.at(-1)).toBe("198.51.100.44");

    const untrusted = createApp({
      config: readApiConfig({ NODE_ENV: "test", CADDY_TRUSTED_PROXIES: "10.20.0.2/32" }),
      databaseProbe: vi.fn(),
      logger: createLogger("info", destination),
    });
    await request(untrusted)
      .get("/api/v1/health/live")
      .set("x-forwarded-for", "203.0.113.99")
      .set("x-forwarded-proto", "https");
    await new Promise((resolve) => setImmediate(resolve));
    expect(addresses.at(-1)).not.toBe("203.0.113.99");
  });

  it("disables every offline surface with a stable error while online routes remain available", async () => {
    const pool = { query: vi.fn() };
    const app = createApp({
      config: readApiConfig({ NODE_ENV: "test", OFFLINE_SYNC_ENABLED: "false" }),
      databaseProbe: vi.fn().mockResolvedValue(undefined),
      logger,
      pool: pool as never,
    });

    for (const offlineRequest of [
      request(app).post("/api/v1/devices").send({}),
      request(app).post("/api/v1/auth/offline-grants").send({}),
      request(app).post("/api/v1/sync/push").send({}),
      request(app).get("/api/v1/sync/pull"),
      request(app).get("/api/v1/sync/status"),
      request(app).get("/api/v1/sync/conflicts"),
    ]) {
      const response = await offlineRequest;
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: "OFFLINE_SYNC_DISABLED" });
    }

    const online = await request(app).get("/api/v1/health/ready");
    expect(online.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
