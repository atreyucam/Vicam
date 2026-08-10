import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ encrypt: vi.fn(), put: vi.fn() }));
vi.mock("./vault", () => ({ getRuntimeDek: () => ({}), isOfflineVaultUnlocked: () => true }));
vi.mock("./crypto", () => ({
  decryptJson: vi.fn(),
  encryptJson: mocks.encrypt,
}));
vi.mock("./db", () => ({
  offlineDb: () => ({ catalogs: { get: vi.fn(), put: mocks.put } }),
}));

import { cacheActiveFruits, normalizePulledAccount } from "./catalogs";

describe("catálogo offline protegido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.encrypt.mockResolvedValue({ ciphertext: "cifrado", iv: "iv", schemaVersion: 1 });
  });

  it("cifra solo id y nombre de frutas activas", async () => {
    const fruits = [
      { active: true, id: "1", name: "Pitahaya", internal: "no-cachear" },
      { active: false, id: "2", name: "Mango" },
    ];
    await cacheActiveFruits(fruits);
    expect(mocks.encrypt).toHaveBeenCalledWith(
      {},
      [{ id: "1", name: "Pitahaya" }],
      "catalog:activeFruits",
    );
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "activeFruits",
        value: { ciphertext: "cifrado", iv: "iv", schemaVersion: 1 },
      }),
    );
  });

  it("normaliza la forma real y mínima de ACCOUNT recibida por pull", () => {
    const account = normalizePulledAccount(
      {
        accountType: "DISTRIBUTOR",
        city: "Quito",
        countryCode: "EC",
        displayName: "Distribuidora Sierra",
        ownerUserId: crypto.randomUUID(),
        status: "ACTIVE",
        version: 2,
      },
      crypto.randomUUID(),
    );
    expect(account.fruits).toEqual([]);
    expect(account.fruitIds).toEqual([]);
    expect(account.ownerFullName).toBe("Responsable asignado");
  });
});
