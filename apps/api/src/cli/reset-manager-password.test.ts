import { describe, expect, it } from "vitest";

import { managerUsernameFromInput } from "./reset-manager-password.js";

describe("Manager password reset CLI input", () => {
  it("accepts one exact username from arg or environment", () => {
    expect(managerUsernameFromInput(["--username", "manager.demo"], {})).toBe("manager.demo");
    expect(managerUsernameFromInput([], { VICAM_MANAGER_USERNAME: "manager.demo" })).toBe(
      "manager.demo",
    );
  });

  it("rejects secret-like or ambiguous arguments", () => {
    expect(() => managerUsernameFromInput(["--password", "secret"], {})).toThrowError(
      "Use únicamente --username.",
    );
    expect(() =>
      managerUsernameFromInput(["--username=manager.one"], {
        VICAM_MANAGER_USERNAME: "manager.two",
      }),
    ).toThrowError("El username difiere entre arg y env.");
  });
});
