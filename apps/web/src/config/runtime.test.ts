import { afterEach, describe, expect, it } from "vitest";

import { runtimeConfig } from "./runtime";

describe("runtimeConfig", () => {
  afterEach(() => {
    globalThis.__VICAM_CONFIG__ = undefined;
    localStorage.clear();
  });

  it("reads environment-specific public configuration at runtime", () => {
    globalThis.__VICAM_CONFIG__ = {
      offlineEnabled: true,
      mapStyleUrl: "https://maps.example.test/style.json",
      mapApiKey: "public-map-key",
      webPushPublicKey: "public-vapid-key",
    };

    expect(runtimeConfig()).toEqual(globalThis.__VICAM_CONFIG__);
  });

  it("uses the last public runtime configuration when the script is unavailable offline", () => {
    globalThis.__VICAM_CONFIG__ = { offlineEnabled: true, mapApiKey: "public-map-key" };
    runtimeConfig();
    globalThis.__VICAM_CONFIG__ = undefined;

    expect(runtimeConfig()).toEqual({ offlineEnabled: true, mapApiKey: "public-map-key" });
  });

  it("replaces the stored feature flag when online runtime configuration changes", () => {
    globalThis.__VICAM_CONFIG__ = { offlineEnabled: true };
    runtimeConfig();
    globalThis.__VICAM_CONFIG__ = { offlineEnabled: false };
    runtimeConfig();
    globalThis.__VICAM_CONFIG__ = undefined;

    expect(runtimeConfig()).toEqual({ offlineEnabled: false });
  });

  it("ignores malformed stored configuration", () => {
    localStorage.setItem("vicam.public-runtime-config.v1", "{invalid");

    expect(runtimeConfig()).toEqual({});
  });

  it("defaults to an empty configuration for local Vite development", () => {
    expect(runtimeConfig()).toEqual({});
  });
});
