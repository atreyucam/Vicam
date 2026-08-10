import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/api";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  findCreate: vi.fn(),
  findLatest: vi.fn(),
  put: vi.fn(),
  purgeAccount: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./config", () => ({ offlineEnabled: true }));
vi.mock("./vault", () => ({
  isOfflineVaultUnlocked: () => true,
  purgeAccountOwnership: mocks.purgeAccount,
}));
vi.mock("./entities", () => ({
  putOfflineEntity: mocks.put,
  removeOfflineEntity: mocks.remove,
}));
vi.mock("./queue", () => ({
  enqueueOperation: mocks.enqueue,
  findCreateDependency: mocks.findCreate,
  findLatestEntityDependency: mocks.findLatest,
}));

import { runStructuredMutation } from "./mutations";

describe("mutaciones estructuradas offline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  });

  it("conserva UUID, metadatos y dependencias de creación/operación previa", async () => {
    mocks.findCreate.mockResolvedValue("10000000-0000-4000-8000-000000000001");
    mocks.findLatest.mockResolvedValue("10000000-0000-4000-8000-000000000002");
    const clientOperationId = "10000000-0000-4000-8000-000000000003";
    await runStructuredMutation({
      accountId: "20000000-0000-4000-8000-000000000001",
      action: "COMPLETE",
      baseVersion: 3,
      changedFields: ["status", "observation"],
      clientOperationId,
      dependencyEntities: [
        { entityId: "20000000-0000-4000-8000-000000000001", entityType: "ACCOUNT" },
      ],
      entityId: "30000000-0000-4000-8000-000000000001",
      entityType: "VISIT",
      localValue: { id: "30000000-0000-4000-8000-000000000001", version: 3 },
      online: vi.fn(),
      payload: { observation: "Cierre", version: 3 },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "COMPLETE",
        baseVersion: 3,
        changedFields: ["status", "observation"],
        clientOperationId,
        dependsOn: ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"],
        entityType: "VISIT",
        accountId: "20000000-0000-4000-8000-000000000001",
      }),
    );
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ pending: true }));
  });

  it("no encola errores HTTP de validación o permisos", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await expect(
      runStructuredMutation({
        accountId: crypto.randomUUID(),
        action: "UPDATE",
        baseVersion: 1,
        changedFields: ["title"],
        clientOperationId: crypto.randomUUID(),
        entityId: crypto.randomUUID(),
        entityType: "TASK",
        localValue: { version: 1 },
        online: () => Promise.reject(new ApiError(403)),
        payload: { title: "No autorizado" },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("encola una falla real de red y reutiliza el UUID estable", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const operationId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const result = await runStructuredMutation({
      accountId,
      action: "CREATE",
      baseVersion: null,
      changedFields: ["title"],
      clientOperationId: operationId,
      entityId: crypto.randomUUID(),
      entityType: "TASK",
      localValue: { version: 1 },
      online: () => Promise.reject(new TypeError("Failed to fetch")),
      payload: { title: "Seguimiento" },
    });
    expect(result.pending).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, clientOperationId: operationId }),
    );
  });

  it("retira del almacenamiento local una mutación online que deja de ser operativa", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const entityId = crypto.randomUUID();
    await runStructuredMutation({
      action: "COMPLETE",
      baseVersion: 2,
      changedFields: ["status"],
      clientOperationId: crypto.randomUUID(),
      entityId,
      entityType: "TASK",
      localValue: { id: entityId, status: "COMPLETED", version: 3 },
      online: () => Promise.resolve({ id: entityId, status: "COMPLETED", version: 3 }),
      payload: { version: 2 },
    });
    expect(mocks.remove).toHaveBeenCalledWith("TASK", entityId);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("purga hijos y operaciones al archivar una cuenta online", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const entityId = crypto.randomUUID();
    await runStructuredMutation({
      action: "UPDATE",
      baseVersion: 2,
      changedFields: ["status"],
      clientOperationId: crypto.randomUUID(),
      entityId,
      entityType: "ACCOUNT",
      localValue: { id: entityId, status: "ARCHIVED", version: 3 },
      online: () => Promise.resolve({ id: entityId, status: "ARCHIVED", version: 3 }),
      payload: { status: "ARCHIVED", version: 2 },
    });
    expect(mocks.purgeAccount).toHaveBeenCalledWith([entityId]);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
