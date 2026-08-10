import { ApiError } from "../api/api";
import { offlineEnabled } from "./config";

function mayUseFallback(reason: unknown): boolean {
  return !(reason instanceof ApiError) || reason.status >= 500;
}

export async function withOfflineFallback<T>(
  online: () => Promise<T>,
  offline: () => Promise<unknown>,
): Promise<T> {
  if (!offlineEnabled) return online();
  if (navigator.onLine) {
    try {
      return await online();
    } catch (reason) {
      if (!mayUseFallback(reason)) throw reason;
    }
  }
  const stored = await offline();
  if (stored !== undefined) return stored as T;
  throw new Error("No hay datos autorizados guardados para esta pantalla.");
}
