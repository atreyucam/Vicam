import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("rollback y política PWA", () => {
  it("mantiene online-only salvo activación explícita", async () => {
    const config = await readFile(path.resolve(process.cwd(), "src/offline/config.ts"), "utf8");
    expect(config).toContain('import.meta.env.VITE_OFFLINE_ENABLED === "true"');
    expect(config).not.toMatch(/!==\s*["']false["']/);
  });

  it("no define caché runtime para API, auth, descargas o documentos", async () => {
    const config = await readFile(path.resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(config).toContain("runtimeCaching: []");
    expect(config).toContain("/^\\/api(?:\\/|$)/");
    expect(config).not.toMatch(/urlPattern.*api/i);
  });

  it("limita la cola a las cuatro entidades estructuradas canónicas", async () => {
    const schema = await readFile(
      path.resolve(process.cwd(), "../../packages/contracts/src/sync.ts"),
      "utf8",
    );
    expect(schema).toContain('["ACCOUNT", "CONTACT", "VISIT", "TASK"]');
    expect(schema).not.toMatch(/syncEntityTypeSchema[^;]*(DOCUMENT|IMAGE|FILE)/s);
  });

  it("exige el grant descifrado en push y pull", async () => {
    const engine = await readFile(path.resolve(process.cwd(), "src/offline/syncEngine.ts"), "utf8");
    expect(engine).toContain("getDecryptedOfflineGrant()");
    expect(engine.match(/"x-offline-grant": grantToken/g)).toHaveLength(2);
    expect(engine).toContain("isOfflineVaultUnlocked()");
  });

  it("purga cuenta, dependencias, cola y almacenamiento sensible", async () => {
    const vault = await readFile(path.resolve(process.cwd(), "src/offline/vault.ts"), "utf8");
    expect(vault).toContain("`ACCOUNT:${accountId}`");
    expect(vault).toContain("operation.accountId");
    expect(vault).toContain("Dexie.delete(offlineDatabaseName)");
    expect(vault).toContain("caches.delete(key)");
  });
});
