import { ApiError } from "../api/api";
import { offlineEnabled } from "./config";
import { putOfflineEntity, removeOfflineEntity } from "./entities";
import { enqueueOperation, findCreateDependency, findLatestEntityDependency } from "./queue";
import type { SyncEntityType } from "./types";
import { isOfflineVaultUnlocked, purgeAccountOwnership } from "./vault";

export interface StructuredMutation<T extends object> {
  accountId?: string;
  action: "CREATE" | "UPDATE" | "RESCHEDULE" | "CANCEL" | "COMPLETE";
  baseVersion: number | null;
  changedFields: string[];
  clientOperationId: string;
  dependencyEntities?: { entityId: string; entityType: SyncEntityType }[];
  entityId: string;
  entityType: SyncEntityType;
  localValue: T;
  online: () => Promise<T>;
  payload: Record<string, unknown>;
}

function isNetworkFailure(reason: unknown): boolean {
  return !(reason instanceof ApiError);
}

function isOperational(entityType: SyncEntityType, value: object): boolean {
  const status = (value as { status?: unknown }).status;
  if (entityType === "ACCOUNT") return status === "ACTIVE";
  if (entityType === "VISIT") return status === "PENDING";
  if (entityType === "TASK") return status === "PENDING" || status === "IN_PROGRESS";
  return true;
}

export async function runStructuredMutation<T extends object>(
  input: StructuredMutation<T>,
): Promise<{ pending: boolean; value: T }> {
  if (navigator.onLine) {
    try {
      const value = await input.online();
      const returnedVersion = (value as { version?: unknown }).version;
      const storedEntityId =
        "id" in value && typeof value.id === "string" ? value.id : input.entityId;
      if (isOperational(input.entityType, value))
        await putOfflineEntity({
          ...(input.accountId ? { accountId: input.accountId } : {}),
          entityId: storedEntityId,
          entityType: input.entityType,
          value,
          version:
            typeof returnedVersion === "number" ? returnedVersion : (input.baseVersion ?? 0) + 1,
        });
      else if (input.entityType === "ACCOUNT") await purgeAccountOwnership([storedEntityId]);
      else await removeOfflineEntity(input.entityType, storedEntityId);
      return { pending: false, value };
    } catch (reason) {
      if (!isNetworkFailure(reason)) throw reason;
    }
  }
  if (!offlineEnabled || !isOfflineVaultUnlocked())
    throw new Error(
      offlineEnabled
        ? "Desbloquea el acceso offline antes de guardar sin conexión."
        : "No hay conexión. El modo offline está desactivado.",
    );
  const dependencyIds = await Promise.all(
    (input.dependencyEntities ?? []).map((dependency) =>
      findCreateDependency(dependency.entityType, dependency.entityId),
    ),
  );
  if (input.action !== "CREATE")
    dependencyIds.push(await findLatestEntityDependency(input.entityType, input.entityId));
  const dependsOn = Array.from(
    new Set(dependencyIds.filter((value): value is string => Boolean(value))),
  );
  await enqueueOperation({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    action: input.action,
    baseVersion: input.baseVersion,
    changedFields: input.changedFields,
    clientOperationId: input.clientOperationId,
    dependsOn,
    entityId: input.entityId,
    entityType: input.entityType,
    payload: input.payload,
  });
  await putOfflineEntity({
    ...(input.accountId ? { accountId: input.accountId } : {}),
    entityId: input.entityId,
    entityType: input.entityType,
    pending: true,
    value: input.localValue,
    version: input.baseVersion ?? 1,
  });
  return { pending: true, value: input.localValue };
}
