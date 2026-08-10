export interface VicamRuntimeConfig {
  offlineEnabled?: boolean;
  mapStyleUrl?: string;
  mapApiKey?: string;
  webPushPublicKey?: string;
}

declare global {
  var __VICAM_CONFIG__: VicamRuntimeConfig | undefined;
}

const runtimeConfigStorageKey = "vicam.public-runtime-config.v1";

function validatedConfig(value: unknown): VicamRuntimeConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const config: VicamRuntimeConfig = {};
  if (typeof source.offlineEnabled === "boolean") config.offlineEnabled = source.offlineEnabled;
  if (typeof source.mapStyleUrl === "string") config.mapStyleUrl = source.mapStyleUrl;
  if (typeof source.mapApiKey === "string") config.mapApiKey = source.mapApiKey;
  if (typeof source.webPushPublicKey === "string")
    config.webPushPublicKey = source.webPushPublicKey;
  return config;
}

function storedConfig(): VicamRuntimeConfig {
  try {
    return (
      validatedConfig(JSON.parse(localStorage.getItem(runtimeConfigStorageKey) ?? "null")) ?? {}
    );
  } catch {
    return {};
  }
}

export function runtimeConfig(): VicamRuntimeConfig {
  const current = validatedConfig(globalThis.__VICAM_CONFIG__);
  if (!current) return storedConfig();
  try {
    localStorage.setItem(runtimeConfigStorageKey, JSON.stringify(current));
  } catch {
    // Public runtime configuration remains usable when storage is unavailable.
  }
  return current;
}
