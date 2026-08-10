import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import { assertStrongPassword } from "./password-policy.js";
import {
  compromisedPasswordBloomBitCount,
  compromisedPasswordEntryCount,
  compromisedPasswordDenylistVersion,
  compromisedPasswordFingerprint,
  compromisedPasswordSourceSha256,
  compromisedPasswordSourceEntryCount,
  isCompromisedPassword,
} from "./compromised-password-denylist-v2.js";
import { issueAccessToken, verifyAccessToken } from "./tokens.js";

describe("online authentication security", () => {
  it("issues a signed access token for exactly fifteen minutes", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const identity = {
      sub: randomUUID(),
      sid: randomUUID(),
      did: randomUUID(),
      role: "SUPERVISOR" as const,
    };
    const issued = issueAccessToken(identity, "unit-test-secret-with-more-than-32-characters", now);
    expect(issued.expiresAt.toISOString()).toBe("2026-07-22T12:15:00.000Z");
    expect(
      verifyAccessToken(issued.token, "unit-test-secret-with-more-than-32-characters", now),
    ).toMatchObject(identity);
    expect(() =>
      verifyAccessToken(issued.token, "different-secret-with-more-than-32-characters", now),
    ).toThrow(AppError);
    expect(() =>
      verifyAccessToken(
        issued.token,
        "unit-test-secret-with-more-than-32-characters",
        new Date("2026-07-22T12:15:00.000Z"),
      ),
    ).toThrowError("La sesión ha vencido.");
  });

  it("rejects common passwords in addition to the canonical composition policy", () => {
    expect(() => assertStrongPassword("Password1!")).toThrowError("comprometidas");
    expect(() => assertStrongPassword("lowercase-only")).toThrowError("no cumple");
    expect(() => assertStrongPassword("Unique-Vicam!2026-Strong")).not.toThrow();
  });

  it("uses a deterministic versioned compromised-password denylist without plaintext", () => {
    expect(compromisedPasswordDenylistVersion).toBe("vicam-compromised-passwords-v2");
    expect(compromisedPasswordSourceEntryCount).toBe(10_000);
    expect(compromisedPasswordEntryCount).toBe(9_789);
    expect(compromisedPasswordBloomBitCount).toBeGreaterThanOrEqual(262_144);
    expect(compromisedPasswordSourceSha256).toBe(
      "a85ecac41cfbbdbb0e0b8ca6b3d7f9b9b8084089cfba70553c7fd42d9738f795",
    );
    expect(compromisedPasswordFingerprint("Welcome1!")).toBe(
      compromisedPasswordFingerprint("welcome1!"),
    );
    expect(isCompromisedPassword("Welcome1!")).toBe(true);
    expect(isCompromisedPassword("123456")).toBe(true);
    expect(isCompromisedPassword("trustno1")).toBe(true);
    expect(isCompromisedPassword("zaq12wsx")).toBe(true);
    expect(isCompromisedPassword("Unique-Vicam!2026-Strong")).toBe(false);
  });
});
