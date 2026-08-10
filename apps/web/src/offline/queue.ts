import type { SyncOperation } from "@vicam/contracts";
import { offlineEnabled } from "./config";
import { decryptJson, encryptJson } from "./crypto";
import { offlineDb } from "./db";
import { notifyOfflineChange, withOfflineLock } from "./locks";
import type { QueueOperation, SyncEntityType } from "./types";
import { getRuntimeDek } from "./vault";

export interface EnqueueInput {
  accountId?: string;
  action: SyncOperation["action"];
  baseVersion: number | null;
  changedFields: string[];
  clientOperationId?: string;
  dependsOn?: string[];
  entityId: string;
  entityType: SyncEntityType;
  payload: Record<string, unknown>;
}

export async function enqueueOperation(input: EnqueueInput): Promise<string> {
  if (!offlineEnabled) throw new Error("El modo offline está desactivado.");
  return withOfflineLock(async () => {
    const db = offlineDb();
    const sequenceState = await db.syncState.get("nextSequence");
    const sequence = typeof sequenceState?.value === "number" ? sequenceState.value : 1;
    const clientOperationId = input.clientOperationId ?? crypto.randomUUID();
    const existing = await db.operations.get(clientOperationId);
    if (existing) return clientOperationId;
    const accountId =
      input.accountId ?? (input.entityType === "ACCOUNT" ? input.entityId : undefined);
    if (!accountId)
      throw new Error("La operación hija requiere la cuenta asociada para proteger su alcance.");
    const operation: QueueOperation = {
      accountId,
      clientOperationId,
      sequence,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      baseVersion: input.baseVersion,
      changedFields: input.changedFields,
      dependsOn: input.dependsOn ?? [],
      occurredAt: new Date().toISOString(),
      attempts: 0,
      status: "PENDING",
      payload: await encryptJson(getRuntimeDek(), input.payload, `operation:${clientOperationId}`),
    };
    await db.transaction("rw", db.operations, db.syncState, async () => {
      await db.operations.add(operation);
      await db.syncState.put({ key: "nextSequence", value: sequence + 1 });
    });
    notifyOfflineChange("queued");
    return clientOperationId;
  });
}

export async function pendingOperations(limit = 100): Promise<SyncOperation[]> {
  const db = offlineDb();
  const allOperations = await db.operations.orderBy("sequence").toArray();
  const operations = allOperations.filter(
    (operation) =>
      (operation.status === "PENDING" || operation.status === "FAILED") &&
      (!operation.nextAttemptAt || Date.parse(operation.nextAttemptAt) <= Date.now()),
  );
  const candidates = operations.filter((operation) =>
    operation.dependsOn.every(
      (dependency) =>
        !allOperations.some((candidate) => candidate.clientOperationId === dependency),
    ),
  );
  return Promise.all(
    candidates.slice(0, limit).map(async (operation) => ({
      clientOperationId: operation.clientOperationId,
      sequence: operation.sequence,
      entityType: operation.entityType,
      entityId: operation.entityId,
      action: operation.action,
      baseVersion: operation.baseVersion,
      changedFields: operation.changedFields,
      dependsOn: operation.dependsOn,
      payload: await decryptJson<Record<string, unknown>>(
        getRuntimeDek(),
        operation.payload,
        `operation:${operation.clientOperationId}`,
      ),
      occurredAt: operation.occurredAt,
    })),
  );
}

export async function findCreateDependency(
  entityType: SyncEntityType,
  entityId: string,
): Promise<string | undefined> {
  const operations = await offlineDb().operations.where("entityId").equals(entityId).toArray();
  return operations.find(
    (operation) => operation.entityType === entityType && operation.action === "CREATE",
  )?.clientOperationId;
}

export async function findLatestEntityDependency(
  entityType: SyncEntityType,
  entityId: string,
): Promise<string | undefined> {
  const operations = await offlineDb().operations.where("entityId").equals(entityId).toArray();
  return operations
    .filter((operation) => operation.entityType === entityType)
    .sort((left, right) => right.sequence - left.sequence)[0]?.clientOperationId;
}

export async function retryOperation(clientOperationId: string): Promise<void> {
  await offlineDb()
    .operations.where({ clientOperationId })
    .modify((operation) => {
      operation.status = "PENDING";
      delete operation.nextAttemptAt;
      delete operation.lastError;
    });
  notifyOfflineChange("retry");
}
