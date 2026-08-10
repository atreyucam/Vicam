import { runtimeConfig } from "../config/runtime";

export const offlineEnabled =
  runtimeConfig().offlineEnabled ?? import.meta.env.VITE_OFFLINE_ENABLED === "true";
export const offlineDatabaseName = "vicam-offline-v1";
export const offlineMaximumMilliseconds = 72 * 60 * 60 * 1000;
export const maximumPinAttempts = 5;
export const syncIntervalMilliseconds = 5 * 60 * 1000;

export function assertOfflineEnabled(): void {
  if (!offlineEnabled) throw new Error("El modo offline está desactivado.");
}
