import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, Record<string, unknown>>();
const mocks = vi.hoisted(() => ({ put: vi.fn() }));

vi.mock("./config", () => ({ offlineEnabled: true }));
vi.mock("./crypto", () => ({
  decryptJson: vi.fn(),
  encryptJson: () => Promise.resolve({ ciphertext: "cifrado", iv: "iv", schemaVersion: 1 }),
}));
vi.mock("./vault", () => ({ getRuntimeDek: () => ({}) }));
vi.mock("./locks", () => ({
  notifyOfflineChange: vi.fn(),
  withOfflineLock: (task: () => Promise<unknown>) => task(),
}));
vi.mock("./db", () => ({
  offlineDb: () => ({
    operations: {
      add: (value: Record<string, unknown>) => {
        rows.set(String(value.clientOperationId), value);
        mocks.put(value);
        return Promise.resolve();
      },
      get: (id: string) => Promise.resolve(rows.get(id)),
    },
    syncState: {
      get: () => Promise.resolve(undefined),
      put: vi.fn(),
    },
    transaction: async (_mode: string, _a: unknown, _b: unknown, task: () => Promise<void>) =>
      task(),
  }),
}));

import { enqueueOperation } from "./queue";

describe("propiedad de operaciones offline", () => {
  beforeEach(() => {
    rows.clear();
    mocks.put.mockClear();
  });

  it("persiste accountId para una operación hija aunque el payload no lo incluya", async () => {
    const accountId = crypto.randomUUID();
    await enqueueOperation({
      accountId,
      action: "UPDATE",
      baseVersion: 2,
      changedFields: ["title"],
      entityId: crypto.randomUUID(),
      entityType: "TASK",
      payload: { title: "Seguimiento" },
    });
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ accountId }));
  });

  it("rechaza una operación hija sin cuenta asociada", async () => {
    await expect(
      enqueueOperation({
        action: "UPDATE",
        baseVersion: 1,
        changedFields: ["fullName"],
        entityId: crypto.randomUUID(),
        entityType: "CONTACT",
        payload: { fullName: "Ana" },
      }),
    ).rejects.toThrow(/requiere la cuenta asociada/i);
  });
});
