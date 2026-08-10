import { offlineEnabled } from "./config";
import { decryptJson, encryptJson } from "./crypto";
import { offlineDb } from "./db";
import { notifyOfflineChange, withOfflineLock } from "./locks";
import type { SyncEntityType } from "./types";
import { getRuntimeDek, isOfflineVaultUnlocked } from "./vault";

export type OfflineValue<T> = T & { __offline: true; __pending: boolean };

function key(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export async function putOfflineEntity<T extends object>(input: {
  accountId?: string;
  entityId: string;
  entityType: SyncEntityType;
  pending?: boolean;
  value: T;
  version: number;
}): Promise<void> {
  if (!offlineEnabled || !isOfflineVaultUnlocked()) return;
  await withOfflineLock(async () => {
    const entityKey = key(input.entityType, input.entityId);
    await offlineDb().entities.put({
      key: entityKey,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      pending: input.pending ?? false,
      updatedAt: new Date().toISOString(),
      value: await encryptJson(getRuntimeDek(), input.value, `entity:${entityKey}`),
      version: input.version,
    });
  });
  notifyOfflineChange("entity-updated");
}

export async function readOfflineEntity<T>(
  entityType: SyncEntityType,
  entityId: string,
): Promise<OfflineValue<T> | undefined> {
  if (!offlineEnabled || !isOfflineVaultUnlocked()) return undefined;
  const stored = await offlineDb().entities.get(key(entityType, entityId));
  if (!stored) return undefined;
  const value = await decryptJson<T>(getRuntimeDek(), stored.value, `entity:${stored.key}`);
  return Object.assign(value as object, {
    __offline: true as const,
    __pending: Boolean(stored.pending),
  }) as OfflineValue<T>;
}

export async function removeOfflineEntity(
  entityType: SyncEntityType,
  entityId: string,
): Promise<void> {
  if (!offlineEnabled || !isOfflineVaultUnlocked()) return;
  await withOfflineLock(() => offlineDb().entities.delete(key(entityType, entityId)));
  notifyOfflineChange("entity-removed");
}

export async function readOfflineEntities<T>(
  entityType: SyncEntityType,
  predicate?: (value: OfflineValue<T>) => boolean,
): Promise<OfflineValue<T>[]> {
  if (!offlineEnabled || !isOfflineVaultUnlocked()) return [];
  const stored = await offlineDb().entities.where("entityType").equals(entityType).toArray();
  const values = await Promise.all(
    stored.map(async (entity) => {
      const value = await decryptJson<T>(getRuntimeDek(), entity.value, `entity:${entity.key}`);
      return Object.assign(value as object, {
        __offline: true as const,
        __pending: Boolean(entity.pending),
      }) as OfflineValue<T>;
    }),
  );
  return predicate ? values.filter(predicate) : values;
}

export function isPendingOfflineValue(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "__pending" in value && value.__pending);
}
