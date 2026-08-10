import type { CommercialAccount } from "@vicam/contracts";
import { api, ApiError, unwrap } from "../api/api";
import { decryptJson, encryptJson } from "./crypto";
import { offlineDb } from "./db";
import { getRuntimeDek, isOfflineVaultUnlocked } from "./vault";

export interface OfflineFruit {
  id: string;
  name: string;
}

function minimalActiveFruits(value: readonly { active?: boolean; id: string; name: string }[]) {
  return value.filter((fruit) => fruit.active !== false).map(({ id, name }) => ({ id, name }));
}

export async function cacheActiveFruits(
  fruits: readonly { active?: boolean; id: string; name: string }[],
): Promise<OfflineFruit[]> {
  const minimal = minimalActiveFruits(fruits);
  if (!isOfflineVaultUnlocked()) return minimal;
  await offlineDb().catalogs.put({
    key: "activeFruits",
    updatedAt: new Date().toISOString(),
    value: await encryptJson(getRuntimeDek(), minimal, "catalog:activeFruits"),
  });
  return minimal;
}

export async function readActiveFruits(): Promise<OfflineFruit[]> {
  if (!isOfflineVaultUnlocked()) return [];
  const stored = await offlineDb().catalogs.get("activeFruits");
  return stored
    ? decryptJson<OfflineFruit[]>(getRuntimeDek(), stored.value, "catalog:activeFruits")
    : [];
}

export async function loadActiveFruits(): Promise<OfflineFruit[]> {
  if (navigator.onLine) {
    try {
      return await cacheActiveFruits(unwrap(await api.GET("/fruits")));
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
    }
  }
  return readActiveFruits();
}

export function normalizePulledAccount(
  data: Record<string, unknown>,
  entityId: string,
): CommercialAccount {
  const fruitIds = Array.isArray(data.fruitIds)
    ? data.fruitIds.filter((value): value is string => typeof value === "string")
    : [];
  const rawFruits: unknown[] = Array.isArray(data.fruits) ? (data.fruits as unknown[]) : [];
  const fruits = rawFruits.flatMap((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      !("name" in value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string"
    )
      return [];
    return [{ id: value.id, name: value.name }];
  });
  return {
    ...data,
    id: typeof data.id === "string" ? data.id : entityId,
    ownerFullName:
      typeof data.ownerFullName === "string" ? data.ownerFullName : "Responsable asignado",
    primaryContactName:
      typeof data.primaryContactName === "string" ? data.primaryContactName : null,
    fruitIds,
    fruits,
  } as CommercialAccount;
}
