import { describe, expect, it } from "vitest";
import {
  decryptJson,
  deriveKek,
  encryptJson,
  generateDek,
  importRuntimeDek,
  randomSalt,
} from "./crypto";

describe("bóveda criptográfica offline", () => {
  it("usa salt e IV únicos y conserva una DEK runtime no exportable", async () => {
    const firstSalt = randomSalt();
    const secondSalt = randomSalt();
    expect(firstSalt).not.toBe(secondSalt);

    const { persistedBytes, runtimeKey } = await generateDek();
    expect(runtimeKey.extractable).toBe(false);
    const first = await encryptJson(runtimeKey, { title: "Visita" }, "entity:VISIT:1");
    const second = await encryptJson(runtimeKey, { title: "Visita" }, "entity:VISIT:1");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    await expect(decryptJson(runtimeKey, first, "entity:VISIT:1")).resolves.toEqual({
      title: "Visita",
    });
    await expect(crypto.subtle.exportKey("raw", runtimeKey)).rejects.toThrow();

    const imported = await importRuntimeDek(persistedBytes);
    expect(imported.extractable).toBe(false);
  });

  it("autentica alcance y rechaza PIN/KEK incorrectos", async () => {
    const salt = randomSalt();
    const correct = await deriveKek("123456", salt, 1_000);
    const wrong = await deriveKek("654321", salt, 1_000);
    const envelope = await encryptJson(correct, { protected: true }, "auth:dek");
    await expect(decryptJson(wrong, envelope, "auth:dek")).rejects.toThrow();
    await expect(decryptJson(correct, envelope, "auth:other")).rejects.toThrow();
    await expect(deriveKek("12345", salt)).rejects.toThrow(/seis dígitos/);
  });

  it("codifica y recupera 100 operaciones en menos de 30 segundos", async () => {
    const startedAt = performance.now();
    const { runtimeKey } = await generateDek();
    const envelopes = await Promise.all(
      Array.from({ length: 100 }, (_, sequence) =>
        encryptJson(runtimeKey, { sequence, action: "UPDATE" }, `operation:${sequence}`),
      ),
    );
    const decoded = await Promise.all(
      envelopes.map((envelope, sequence) =>
        decryptJson<{ sequence: number }>(runtimeKey, envelope, `operation:${sequence}`),
      ),
    );
    expect(decoded.at(-1)?.sequence).toBe(99);
    expect(performance.now() - startedAt).toBeLessThan(30_000);
  });
});
