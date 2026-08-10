import { z } from "./zod.js";

export const offlineMaximumHours = 72;
export const clientOperationIdSchema = z.uuid();
export const syncCursorSchema = z.string().regex(/^\d+$/);
export const syncEntityTypeSchema = z.enum(["ACCOUNT", "CONTACT", "VISIT", "TASK"]);
export const syncActionSchema = z.enum(["CREATE", "UPDATE", "RESCHEDULE", "CANCEL", "COMPLETE"]);
export const syncResultStatusSchema = z.enum([
  "APPLIED",
  "MERGED",
  "DUPLICATE",
  "CONFLICT",
  "REJECTED",
  "BLOCKED",
]);
export const syncConflictCodeSchema = z.enum([
  "SAME_FIELD_CHANGED",
  "STATE_CHANGED",
  "ENTITY_ARCHIVED",
  "ACCESS_REVOKED",
  "DEPENDENCY_FAILED",
  "BASE_VERSION_REQUIRED",
]);

export const registerDeviceRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(100),
});
export const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: z.string(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  lastSeenAt: z.iso.datetime({ offset: true }),
});
export const createOfflineGrantRequestSchema = z.object({ deviceId: z.uuid() });
export const offlineGrantSchema = z.object({
  id: z.uuid(),
  deviceId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  issuedAt: z.iso.datetime({ offset: true }),
  grantToken: z.string().min(32),
});
export const offlineGrantHeaderSchema = z.object({
  "x-offline-grant": z.string().min(32).max(512),
});

export const syncOperationSchema = z.object({
  clientOperationId: clientOperationIdSchema,
  sequence: z.number().int().positive(),
  entityType: syncEntityTypeSchema,
  entityId: z.uuid(),
  action: syncActionSchema,
  baseVersion: z.number().int().positive().nullable(),
  changedFields: z.array(z.string().min(1).max(100)).max(50),
  dependsOn: z.array(clientOperationIdSchema).max(20).default([]),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const syncPushRequestSchema = z.object({
  deviceId: z.uuid(),
  operations: z.array(syncOperationSchema).min(1).max(100),
});
export const syncOperationResultSchema = z.object({
  clientOperationId: clientOperationIdSchema,
  status: syncResultStatusSchema,
  entityId: z.uuid(),
  entityVersion: z.number().int().positive().nullable(),
  conflictId: z.uuid().nullable(),
  code: z.string().max(100).nullable(),
});
export const syncPushResponseSchema = z.object({ results: z.array(syncOperationResultSchema) });

export const syncPullQuerySchema = z.object({
  deviceId: z.uuid(),
  cursor: syncCursorSchema.default("0"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const syncChangeSchema = z.object({
  cursor: syncCursorSchema,
  entityType: syncEntityTypeSchema,
  entityId: z.uuid(),
  operation: z.enum(["UPSERT", "DELETE", "REVOKE"]),
  version: z.number().int().positive(),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export const syncPullResponseSchema = z.object({
  changes: z.array(syncChangeSchema),
  nextCursor: syncCursorSchema,
  hasMore: z.boolean(),
  purgeAccountIds: z.array(z.uuid()),
  serverTime: z.iso.datetime({ offset: true }),
  grantExpiresAt: z.iso.datetime({ offset: true }),
  deviceRevoked: z.boolean(),
});

export const syncConflictSchema = z.object({
  id: z.uuid(),
  entityType: syncEntityTypeSchema,
  entityId: z.uuid(),
  serverVersion: z.number().int().positive(),
  code: syncConflictCodeSchema,
  conflictingFields: z.array(z.string()),
  base: z.record(z.string(), z.unknown()),
  server: z.record(z.string(), z.unknown()),
  device: z.record(z.string(), z.unknown()),
  status: z.enum(["OPEN", "RESOLVED"]),
  createdAt: z.iso.datetime({ offset: true }),
});
export const resolveSyncConflictRequestSchema = z.object({
  resolution: z.enum(["SERVER", "DEVICE", "MERGED"]),
  mergedFields: z.record(z.string(), z.unknown()).optional(),
});
export const syncStatusSchema = z.object({
  device: deviceSchema,
  grantExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  pendingConflicts: z.number().int().nonnegative(),
  latestCursor: syncCursorSchema,
});

export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
