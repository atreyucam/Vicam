import { describe, expect, it } from "vitest";

import { safeAuditChanges } from "./db.js";

describe("audit snapshot allowlist", () => {
  it("retains approved state and strips secrets, content and raw field values", () => {
    expect(
      safeAuditChanges("commercial_account", {
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        status: "ACTIVE",
        version: 2,
        changedFields: ["ownerUserId", "notes", "password", "latitude"],
        latitude: -2.1,
        password: "never-store-this",
        documentContent: "never-store-this-either",
      }),
    ).toEqual({
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      status: "ACTIVE",
      version: 2,
      changedFields: ["ownerUserId", "latitude"],
    });
  });

  it("fails closed for unknown entity snapshot shapes", () => {
    expect(safeAuditChanges("unknown", { value: "not persisted" })).toBeNull();
  });
});
