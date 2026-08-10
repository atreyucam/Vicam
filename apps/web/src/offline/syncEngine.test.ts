import { beforeEach, describe, expect, it, vi } from "vitest";

const openConflict = {
  id: "019b3e83-7a28-7000-8000-000000000901",
  entityType: "ACCOUNT" as const,
  entityId: "019b3e83-7a28-7000-8000-000000000101",
  code: "SAME_FIELD_CHANGED" as const,
  conflictingFields: ["displayName"],
  base: { displayName: "Base" },
  server: { displayName: "Servidor", version: 4 },
  device: { displayName: "Dispositivo" },
  status: "OPEN" as const,
  createdAt: "2026-07-22T15:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  bulkDelete: vi.fn(),
  bulkPut: vi.fn(),
  clear: vi.fn(),
  get: vi.fn(),
  notify: vi.fn(),
  operationDelete: vi.fn(),
  operationUpdate: vi.fn(),
}));

vi.mock("../api/api", () => ({
  api: { GET: mocks.get },
  ApiError: class ApiError extends Error {},
  hasOnlineAccessToken: vi.fn(() => true),
  unwrap: (result: { data?: unknown }) => result.data,
}));
vi.mock("./config", () => ({ offlineEnabled: true }));
vi.mock("./crypto", () => ({
  encryptJson: vi.fn().mockResolvedValue({ ciphertext: "cifrado", iv: "iv", schemaVersion: 1 }),
}));
vi.mock("./catalogs", () => ({ cacheActiveFruits: vi.fn(), normalizePulledAccount: vi.fn() }));
vi.mock("./locks", () => ({
  notifyOfflineChange: mocks.notify,
  withOfflineLock: (task: () => Promise<unknown>) => task(),
}));
vi.mock("./queue", () => ({ pendingOperations: vi.fn().mockResolvedValue([]) }));
vi.mock("./vault", () => ({
  getDecryptedOfflineGrant: vi.fn(),
  getOfflineAuthorization: vi.fn(),
  getRuntimeDek: vi.fn(() => ({})),
  isOfflineVaultUnlocked: vi.fn(() => true),
  purgeAccountOwnership: vi.fn(),
  purgeOfflineData: vi.fn(),
}));
vi.mock("./db", () => ({
  offlineDb: () => ({
    conflicts: { bulkPut: mocks.bulkPut, clear: mocks.clear },
    operations: {
      delete: mocks.operationDelete,
      update: mocks.operationUpdate,
      where: () => ({
        equals: () => ({
          toArray: () =>
            Promise.resolve([
              {
                clientOperationId: "legacy-open",
                entityId: openConflict.entityId,
                entityType: openConflict.entityType,
                status: "CONFLICT",
              },
              {
                clientOperationId: "resolved",
                conflictId: "019b3e83-7a28-7000-8000-000000000999",
                entityId: openConflict.entityId,
                entityType: openConflict.entityType,
                status: "CONFLICT",
              },
            ]),
        }),
      }),
    },
    transaction: async (...args: unknown[]) => (args.at(-1) as () => Promise<void>)(),
  }),
}));

import { fetchConflicts } from "./syncEngine";

describe("reconciliación local de conflictos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: [openConflict], response: new Response() });
  });

  it("reemplaza el snapshot local, enlaza la operación abierta y elimina la resuelta", async () => {
    await fetchConflicts();

    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ id: openConflict.id, status: "OPEN" }),
    ]);
    expect(mocks.operationUpdate).toHaveBeenCalledWith("legacy-open", {
      conflictId: openConflict.id,
      lastError: openConflict.code,
      status: "CONFLICT",
    });
    expect(mocks.operationDelete).toHaveBeenCalledWith("resolved");
    expect(mocks.notify).toHaveBeenCalledWith("conflicts-reconciled");
  });
});
