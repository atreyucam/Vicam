import Dexie, { type EntityTable } from "dexie";
import { offlineDatabaseName } from "./config";
import type {
  OfflineAuthRecord,
  OfflineEntity,
  QueueOperation,
  StoredCatalog,
  StoredConflict,
  SyncStateRecord,
} from "./types";

export class VicamOfflineDatabase extends Dexie {
  auth!: EntityTable<OfflineAuthRecord, "key">;
  catalogs!: EntityTable<StoredCatalog, "key">;
  conflicts!: EntityTable<StoredConflict, "id">;
  entities!: EntityTable<OfflineEntity, "key">;
  operations!: EntityTable<QueueOperation, "clientOperationId">;
  syncState!: EntityTable<SyncStateRecord, "key">;

  constructor() {
    super(offlineDatabaseName);
    this.version(1).stores({
      auth: "key",
      conflicts: "id, status, createdAt, entityType, entityId",
      entities: "key, [entityType+entityId], entityType, accountId, updatedAt",
      operations:
        "clientOperationId, sequence, status, entityType, entityId, occurredAt, nextAttemptAt",
      syncState: "key",
    });
    this.version(2).stores({
      auth: "key",
      catalogs: "key, updatedAt",
      conflicts: "id, status, createdAt, entityType, entityId",
      entities: "key, [entityType+entityId], entityType, accountId, updatedAt",
      operations:
        "clientOperationId, sequence, status, entityType, entityId, accountId, occurredAt, nextAttemptAt",
      syncState: "key",
    });
  }
}

let instance: VicamOfflineDatabase | undefined;

export function offlineDb(): VicamOfflineDatabase {
  instance ??= new VicamOfflineDatabase();
  return instance;
}

export function closeOfflineDb(): void {
  instance?.close();
  instance = undefined;
}
