import { describe, expect, it } from "vitest";

import { readApiConfig } from "./config.js";

describe("Caddy proxy configuration", () => {
  it("parses an explicit allowlist and rejects broad trust", () => {
    expect(
      readApiConfig({ NODE_ENV: "test", CADDY_TRUSTED_PROXIES: "10.20.0.2/32, 10.20.0.0/28" })
        .CADDY_TRUSTED_PROXIES,
    ).toEqual(["10.20.0.2/32", "10.20.0.0/28"]);
    expect(() => readApiConfig({ NODE_ENV: "test", CADDY_TRUSTED_PROXIES: "0.0.0.0/0" })).toThrow(
      "known Caddy",
    );
  });

  it("uses a safe deterministic offline-sync default per environment", () => {
    expect(readApiConfig({ NODE_ENV: "development" }).OFFLINE_SYNC_ENABLED).toBe(true);
    expect(readApiConfig({ NODE_ENV: "test" }).OFFLINE_SYNC_ENABLED).toBe(true);
    expect(
      readApiConfig({
        NODE_ENV: "production",
        AUTH_SECRET: "production-secret-with-at-least-32-characters",
        CADDY_TRUSTED_PROXIES: "10.20.0.2/32",
        DOCUMENT_STORAGE_ROOT: "/var/lib/vicam/documents",
      }).OFFLINE_SYNC_ENABLED,
    ).toBe(false);
    expect(
      readApiConfig({ NODE_ENV: "test", OFFLINE_SYNC_ENABLED: "false" }).OFFLINE_SYNC_ENABLED,
    ).toBe(false);
    expect(
      readApiConfig({
        NODE_ENV: "production",
        AUTH_SECRET: "production-secret-with-at-least-32-characters",
        CADDY_TRUSTED_PROXIES: "10.20.0.2/32",
        DOCUMENT_STORAGE_ROOT: "/var/lib/vicam/documents",
        OFFLINE_SYNC_ENABLED: "true",
      }).OFFLINE_SYNC_ENABLED,
    ).toBe(true);
  });

  it("requires an explicit Caddy allowlist in production", () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: "production",
        AUTH_SECRET: "production-secret-with-at-least-32-characters",
      }),
    ).toThrow("must be configured in production");
  });
});
