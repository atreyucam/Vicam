import { describe, expect, it } from "vitest";

import { bootstrapInputFromArguments } from "./bootstrap-manager.js";

describe("initial Manager bootstrap CLI input", () => {
  it("accepts the public identity without accepting a password", () => {
    expect(
      bootstrapInputFromArguments(["--username", "vladimir", "--full-name", "Vladimir"]),
    ).toEqual({ username: "vladimir", fullName: "Vladimir" });
  });

  it("rejects missing, ambiguous or secret arguments", () => {
    expect(() => bootstrapInputFromArguments(["--username", "vladimir"])).toThrow();
    expect(() => bootstrapInputFromArguments(["--password", "NeverPutASecretHere1!"])).toThrowError(
      "Use únicamente --username y --full-name.",
    );
  });
});
