import { describe, expect, it, vi } from "vitest";

const deleted: string[] = [];
const accountId = "20000000-0000-4000-8000-000000000001";
vi.mock("./config", () => ({
  maximumPinAttempts: 5,
  offlineDatabaseName: "test",
  offlineEnabled: true,
}));
vi.mock("./locks", () => ({
  notifyOfflineChange: vi.fn(),
  notifyOfflinePurge: vi.fn(),
  onOfflinePurge: vi.fn(),
  withOfflineLock: (task: () => Promise<unknown>) => task(),
}));
vi.mock("./db", () => ({
  closeOfflineDb: vi.fn(),
  offlineDb: () => ({
    entities: { bulkDelete: vi.fn(), where: () => ({ anyOf: () => ({ delete: vi.fn() }) }) },
    operations: {
      bulkDelete: (ids: string[]) => {
        deleted.push(...ids);
        return Promise.resolve();
      },
      toArray: () =>
        Promise.resolve([
          {
            accountId,
            clientOperationId: "contacto",
            entityId: crypto.randomUUID(),
            entityType: "CONTACT",
            payload: { ciphertext: "sin-account-id", iv: "iv", schemaVersion: 1 },
          },
          {
            accountId,
            clientOperationId: "visita",
            entityId: crypto.randomUUID(),
            entityType: "VISIT",
            payload: { ciphertext: "sin-account-id", iv: "iv", schemaVersion: 1 },
          },
          {
            accountId,
            clientOperationId: "tarea",
            entityId: crypto.randomUUID(),
            entityType: "TASK",
            payload: { ciphertext: "sin-account-id", iv: "iv", schemaVersion: 1 },
          },
        ]),
    },
    transaction: async (_mode: string, _a: unknown, _b: unknown, task: () => Promise<void>) =>
      task(),
  }),
}));

import { purgeAccountOwnership } from "./vault";

describe("purga por reasignación", () => {
  it("elimina contacto, visita y tarea por metadato sin descifrar payload", async () => {
    await purgeAccountOwnership([accountId]);
    expect(deleted).toEqual(["contacto", "visita", "tarea"]);
  });
});
