import { describe, expect, it } from "vitest";

import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password.js";

describe("Argon2id password foundation", () => {
  it("hashes and verifies without retaining the plaintext", async () => {
    const encoded = await hashPassword("VicamLocal!2026");

    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).not.toContain("VicamLocal!2026");
    await expect(verifyPassword(encoded, "VicamLocal!2026")).resolves.toBe(true);
    await expect(verifyPassword(encoded, "incorrect-password")).resolves.toBe(false);
    expect(passwordNeedsRehash(encoded)).toBe(false);
  });

  it("fails closed for malformed hashes", async () => {
    await expect(verifyPassword("not-an-argon2-hash", "password")).resolves.toBe(false);
    expect(passwordNeedsRehash("not-an-argon2-hash")).toBe(true);
  });
});
