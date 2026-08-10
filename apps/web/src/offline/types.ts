import type { SyncOperation } from "@vicam/contracts";

export type SyncEntityType = SyncOperation["entityType"];
export type QueueStatus = "PENDING" | "SYNCING" | "FAILED" | "CONFLICT" | "APPLIED";

export interface CipherEnvelope {
  ciphertext: string;
  iv: string;
  schemaVersion: 1;
}

export interface OfflineEntity {
  key: string;
  pending?: boolean;
  entityType: SyncEntityType;
  entityId: string;
  accountId?: string;
  version: number;
  updatedAt: string;
  value: CipherEnvelope;
}

export interface QueueOperation extends Omit<SyncOperation, "payload"> {
  accountId: string;
  attempts: number;
  conflictId?: string;
  lastError?: string;
  nextAttemptAt?: string;
  status: QueueStatus;
  payload: CipherEnvelope;
}

export interface StoredCatalog {
  key: "activeFruits";
  updatedAt: string;
  value: CipherEnvelope;
}

export interface OfflineAuthRecord {
  key: "authorization";
  cryptoVersion: 1;
  deviceId: string;
  grantExpiresAt: string;
  grantIssuedAt: string;
  grantToken: CipherEnvelope;
  kdf: { algorithm: "PBKDF2-SHA-256"; iterations: number; salt: string };
  pinAttempts: number;
  profile: CipherEnvelope;
  wrappedDek: CipherEnvelope;
}

export interface SyncStateRecord {
  key: string;
  value: string | number | boolean | null;
}

export interface StoredConflict {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  value: CipherEnvelope;
}
