import type { SyncPullResponse } from "@vicam/contracts";
import { api, ApiError, hasOnlineAccessToken, unwrap } from "../api/api";
import { offlineEnabled } from "./config";
import { encryptJson } from "./crypto";
import { cacheActiveFruits, normalizePulledAccount } from "./catalogs";
import { offlineDb } from "./db";
import { notifyOfflineChange, withOfflineLock } from "./locks";
import { pendingOperations } from "./queue";
import type { StoredConflict } from "./types";
import {
  getDecryptedOfflineGrant,
  getOfflineAuthorization,
  getRuntimeDek,
  isOfflineVaultUnlocked,
  purgeAccountOwnership,
  purgeOfflineData,
} from "./vault";

let activeSync = false;
let activePromise: Promise<void> | null = null;

export function isSyncActive(): boolean {
  return activeSync;
}

export async function waitForSyncIdle(): Promise<void> {
  await activePromise;
}

async function push(deviceId: string, grantToken: string): Promise<void> {
  const operations = await pendingOperations(100);
  if (operations.length === 0) return;
  const db = offlineDb();
  await db.operations.bulkUpdate(
    operations.map((operation) => ({
      key: operation.clientOperationId,
      changes: { status: "SYNCING" },
    })),
  );
  try {
    const response = unwrap(
      await api.POST("/sync/push", {
        body: { deviceId, operations },
        params: { header: { "x-offline-grant": grantToken } },
      }),
    );
    await db.transaction("rw", db.operations, async () => {
      for (const result of response.results) {
        if (["APPLIED", "MERGED", "DUPLICATE"].includes(result.status))
          await db.operations.delete(result.clientOperationId);
        else
          await db.operations.update(result.clientOperationId, {
            attempts: (await db.operations.get(result.clientOperationId))!.attempts + 1,
            ...(result.conflictId ? { conflictId: result.conflictId } : {}),
            lastError: result.code ?? result.status,
            status: result.status === "CONFLICT" ? "CONFLICT" : "FAILED",
          });
      }
    });
  } catch (error) {
    const nextAttemptAt = new Date(Date.now() + 5_000).toISOString();
    const stored = await db.operations.bulkGet(
      operations.map((operation) => operation.clientOperationId),
    );
    await db.operations.bulkUpdate(
      operations.map((operation, index) => ({
        key: operation.clientOperationId,
        changes: {
          attempts: (stored[index]?.attempts ?? 0) + 1,
          lastError: error instanceof Error ? error.message : "Error de sincronización",
          nextAttemptAt,
          status: "FAILED",
        },
      })),
    );
    throw error;
  }
}

async function applyPull(response: SyncPullResponse): Promise<void> {
  if (response.deviceRevoked || Date.parse(response.grantExpiresAt) <= Date.now()) {
    await purgeOfflineData(response.deviceRevoked ? "device-revoked" : "expired");
    throw new Error("El acceso offline de este dispositivo ya no está vigente.");
  }
  await purgeAccountOwnership(response.purgeAccountIds);
  const db = offlineDb();
  const dek = getRuntimeDek();
  await db.transaction("rw", db.entities, db.syncState, async () => {
    for (const change of response.changes) {
      const key = `${change.entityType}:${change.entityId}`;
      if (change.operation === "UPSERT" && change.data) {
        const accountId =
          typeof change.data.accountId === "string"
            ? change.data.accountId
            : change.entityType === "ACCOUNT"
              ? change.entityId
              : undefined;
        const value =
          change.entityType === "ACCOUNT"
            ? normalizePulledAccount(change.data, change.entityId)
            : change.data;
        await db.entities.put({
          key,
          entityType: change.entityType,
          entityId: change.entityId,
          ...(accountId ? { accountId } : {}),
          version: change.version,
          updatedAt: response.serverTime,
          value: await encryptJson(dek, value, `entity:${key}`),
        });
      } else await db.entities.delete(key);
    }
    await db.syncState.bulkPut([
      { key: "cursor", value: response.nextCursor },
      { key: "lastSyncAt", value: response.serverTime },
      { key: "grantExpiresAt", value: response.grantExpiresAt },
    ]);
  });
}

async function pull(deviceId: string, grantToken: string): Promise<void> {
  const db = offlineDb();
  let cursor = String((await db.syncState.get("cursor"))?.value ?? "0");
  let hasMore = true;
  while (hasMore) {
    const response = unwrap(
      await api.GET("/sync/pull", {
        params: {
          header: { "x-offline-grant": grantToken },
          query: { deviceId, cursor, limit: 200 },
        },
      }),
    );
    await applyPull(response);
    cursor = response.nextCursor;
    hasMore = response.hasMore;
  }
}

export async function fetchConflicts(): Promise<void> {
  const conflicts = unwrap(await api.GET("/sync/conflicts"));
  const dek = getRuntimeDek();
  const openConflicts = conflicts.filter((conflict) => conflict.status === "OPEN");
  const stored: StoredConflict[] = await Promise.all(
    openConflicts.map(async (conflict) => ({
      id: conflict.id,
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      status: conflict.status,
      createdAt: conflict.createdAt,
      value: await encryptJson(dek, conflict, `conflict:${conflict.id}`),
    })),
  );
  const db = offlineDb();
  await db.transaction("rw", db.conflicts, db.operations, async () => {
    await db.conflicts.clear();
    if (stored.length > 0) await db.conflicts.bulkPut(stored);
    const conflictOperations = await db.operations.where("status").equals("CONFLICT").toArray();
    for (const operation of conflictOperations) {
      const openConflict = openConflicts.find((conflict) =>
        operation.conflictId
          ? conflict.id === operation.conflictId
          : conflict.entityType === operation.entityType &&
            conflict.entityId === operation.entityId,
      );
      if (!openConflict) await db.operations.delete(operation.clientOperationId);
      else
        await db.operations.update(operation.clientOperationId, {
          conflictId: openConflict.id,
          lastError: openConflict.code,
          status: "CONFLICT",
        });
    }
  });
  notifyOfflineChange("conflicts-reconciled");
}

async function run(): Promise<void> {
  if (!offlineEnabled || !navigator.onLine || !isOfflineVaultUnlocked()) return;
  const auth = await getOfflineAuthorization();
  if (!auth) return;
  await withOfflineLock(async () => {
    activeSync = true;
    notifyOfflineChange("syncing");
    try {
      // The grant is decrypted only after the vault is unlocked and remains in memory for this sync.
      const grantToken = await getDecryptedOfflineGrant();
      await push(auth.deviceId, grantToken);
      await cacheActiveFruits(unwrap(await api.GET("/fruits")));
      await pull(auth.deviceId, grantToken);
      if (hasOnlineAccessToken()) await fetchConflicts();
      notifyOfflineChange("synced");
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        ["DEVICE_REVOKED", "OFFLINE_GRANT_REVOKED", "OFFLINE_GRANT_EXPIRED"].includes(
          reason.envelope?.code ?? "",
        )
      )
        await purgeOfflineData("device-revoked");
      throw reason;
    } finally {
      activeSync = false;
    }
  });
}

export function syncNow(): Promise<void> {
  activePromise ??= run().finally(() => {
    activePromise = null;
  });
  return activePromise;
}
