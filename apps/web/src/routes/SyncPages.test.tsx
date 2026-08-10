import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConflictDetailPage, conflictFieldLabel } from "./SyncPages";

const mocks = vi.hoisted(() => ({
  conflictDelete: vi.fn(),
  entityGet: vi.fn(),
  entityPut: vi.fn(),
  operationBulkDelete: vi.fn(),
  post: vi.fn(),
  readConflict: vi.fn(),
}));
vi.mock("../api/api", () => ({
  api: { POST: mocks.post },
  unwrap: (result: { data?: unknown }) => result.data,
}));
vi.mock("../app/session", () => ({ useSession: () => ({ user: { role: "MANAGER" } }) }));
vi.mock("../offline/useOfflineRuntime", () => ({
  readConflict: mocks.readConflict,
  readQueueOperations: vi.fn(),
  useOfflineRuntime: vi.fn(),
}));
vi.mock("../offline/crypto", () => ({
  encryptJson: vi.fn().mockResolvedValue({ ciphertext: "cifrado", iv: "iv", schemaVersion: 1 }),
}));
vi.mock("../offline/db", () => ({
  offlineDb: () => ({
    conflicts: { delete: mocks.conflictDelete },
    entities: { get: mocks.entityGet, put: mocks.entityPut },
    operations: {
      bulkDelete: mocks.operationBulkDelete,
      where: () => ({ equals: () => ({ toArray: () => Promise.resolve([]) }) }),
    },
    transaction: async (...args: unknown[]) => (args.at(-1) as () => Promise<void>)(),
  }),
}));
vi.mock("../offline/vault", () => ({
  enrollOfflineDevice: vi.fn(),
  getOfflineAuthorization: vi.fn(),
  getRuntimeDek: vi.fn(() => ({})),
  isOfflineVaultUnlocked: vi.fn(() => true),
  unlockOfflineVault: vi.fn(),
}));

describe("resolución de conflictos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConflict.mockResolvedValue({
      id: crypto.randomUUID(),
      entityType: "ACCOUNT",
      entityId: crypto.randomUUID(),
      code: "SAME_FIELD_CHANGED",
      conflictingFields: ["displayName", "city"],
      base: { city: "Quito", displayName: "Anterior" },
      server: { city: "Cuenca", displayName: "Servidor" },
      device: { city: "Loja", displayName: "Dispositivo" },
      status: "OPEN",
      createdAt: new Date().toISOString(),
    });
    mocks.post.mockResolvedValue({
      data: {
        entityId: "019b3e83-7a28-7000-8000-000000000101",
        entityType: "ACCOUNT",
        server: { displayName: "Servidor", version: 4 },
      },
      response: new Response(null, { status: 200 }),
    });
  });

  it("traduce campos y envía MERGED con una elección por campo", async () => {
    render(<SyncConflictDetailPage conflictId={crypto.randomUUID()} />);
    expect(await screen.findByRole("rowheader", { name: "Nombre visible" })).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "Combinar por campo" }));
    fireEvent.change(screen.getByLabelText("Elegir valor para Ciudad"), {
      target: { value: "DEVICE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar resolución" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({
      body: {
        resolution: "MERGED",
        mergedFields: { city: "Loja", displayName: "Servidor" },
      },
    });
  });

  it("usa una etiqueta es-EC legible como fallback", () => {
    expect(conflictFieldLabel("customTechnicalName")).toBe("custom technical name");
  });

  it("aplica el snapshot servidor y elimina el conflicto local", async () => {
    render(<SyncConflictDetailPage conflictId="019b3e83-7a28-7000-8000-000000000901" />);
    await screen.findByRole("rowheader", { name: "Nombre visible" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar resolución" }));

    await waitFor(() => expect(mocks.entityPut).toHaveBeenCalledOnce());
    expect(mocks.entityPut).toHaveBeenCalledWith(
      expect.objectContaining({ pending: false, version: 4 }),
    );
    expect(mocks.conflictDelete).toHaveBeenCalledWith("019b3e83-7a28-7000-8000-000000000901");
  });
});
