import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canAccessOwner, canAssignOwner, parseAccessContext } from "./access-context.js";

describe("RBAC and ownership foundation", () => {
  const supervisorId = randomUUID();
  const otherUserId = randomUUID();

  it("allows managers to access and assign any owner", () => {
    const manager = parseAccessContext({ userId: randomUUID(), role: "MANAGER" });
    expect(canAccessOwner(manager, otherUserId)).toBe(true);
    expect(canAssignOwner(manager, otherUserId)).toBe(true);
  });

  it("limits supervisors to their own ownership", () => {
    const supervisor = parseAccessContext({ userId: supervisorId, role: "SUPERVISOR" });
    expect(canAccessOwner(supervisor, supervisorId)).toBe(true);
    expect(canAccessOwner(supervisor, otherUserId)).toBe(false);
    expect(canAssignOwner(supervisor, otherUserId)).toBe(false);
  });
});
