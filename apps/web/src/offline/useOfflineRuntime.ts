import { useCallback, useEffect } from "react";
import { offlineEnabled, syncIntervalMilliseconds } from "./config";
import { decryptJson } from "./crypto";
import { offlineDb } from "./db";
import { onOfflineChange } from "./locks";
import type { QueueOperation } from "./types";
import { getRuntimeDek } from "./vault";
import { isSyncActive, syncNow } from "./syncEngine";
import { purgeOfflineData } from "./vault";
import { emptyOfflineStatus, useOfflineStore, type OfflineClientStatus } from "./store";

export type OfflineRuntimeStatus = OfflineClientStatus;

export function useOfflineRuntime(active = true) {
  const { error, setError, setStatus, status } = useOfflineStore();

  const refresh = useCallback(async () => {
    if (!offlineEnabled) return setStatus(emptyOfflineStatus);
    const db = offlineDb();
    const [operations, conflicts, lastSync, grant] = await Promise.all([
      db.operations.toArray(),
      db.conflicts.where("status").equals("OPEN").count(),
      db.syncState.get("lastSyncAt"),
      db.auth.get("authorization"),
    ]);
    if (grant && Date.parse(grant.grantExpiresAt) <= Date.now()) {
      await purgeOfflineData("expired");
      setStatus(emptyOfflineStatus);
      setError("La autorización offline venció. Los datos locales fueron eliminados.");
      return;
    }
    setStatus({
      conflicts,
      failed: operations.filter((operation) => operation.status === "FAILED").length,
      pending: operations.filter((operation) => ["PENDING", "SYNCING"].includes(operation.status))
        .length,
      syncing: isSyncActive(),
      ...(typeof lastSync?.value === "string" ? { lastSyncAt: lastSync.value } : {}),
      ...(grant?.grantExpiresAt ? { grantExpiresAt: grant.grantExpiresAt } : {}),
    });
  }, [setError, setStatus]);

  const synchronize = useCallback(async () => {
    setError(undefined);
    try {
      await syncNow();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible sincronizar.");
    } finally {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (!active || !offlineEnabled) return;
    void refresh();
    void synchronize();
    const reconnect = () => void synchronize();
    const foreground = () => document.visibilityState === "visible" && void synchronize();
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", foreground);
    const unsubscribe = onOfflineChange(() => void refresh());
    const interval = window.setInterval(() => void synchronize(), syncIntervalMilliseconds);
    return () => {
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", foreground);
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [active, refresh, synchronize]);

  return { enabled: offlineEnabled, error, refresh, status, synchronize };
}

export async function readQueueOperations(): Promise<QueueOperation[]> {
  return offlineEnabled ? offlineDb().operations.orderBy("sequence").toArray() : [];
}

export async function readConflict<T>(id: string): Promise<T | undefined> {
  const conflict = await offlineDb().conflicts.get(id);
  return conflict
    ? decryptJson<T>(getRuntimeDek(), conflict.value, `conflict:${conflict.id}`)
    : undefined;
}
