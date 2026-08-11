import { describe, expect, it } from "vitest";

import {
  accountScope,
  documentScope,
  SqlParameters,
  taskOverdueSql,
  taskScope,
  trendUnit,
  visitScope,
} from "./sql.js";

const baseQuery = {
  timezone: "America/Guayaquil",
  page: 1,
  pageSize: 20,
} as const;

describe("report analytics SQL scope", () => {
  it("applies current ownership and responsibility to Supervisor visits and tasks", () => {
    const actor = { userId: "00000000-0000-4000-8000-000000000002", role: "SUPERVISOR" } as const;
    const visitParameters = new SqlParameters();
    const visitWhere = visitScope(baseQuery, actor, visitParameters).join(" and ");
    expect(visitWhere).toContain("v.responsible_user_id=$1");
    expect(visitWhere).toContain("a.owner_user_id=$1");
    expect(visitParameters.values[0]).toBe(actor.userId);

    const taskParameters = new SqlParameters();
    const taskWhere = taskScope(baseQuery, actor, taskParameters).join(" and ");
    expect(taskWhere).toContain("t.responsible_user_id=$1");
    expect(taskWhere).toContain("a.owner_user_id=$1");
  });

  it("scopes accounts and documents by current account owner", () => {
    const actor = { userId: "00000000-0000-4000-8000-000000000002", role: "SUPERVISOR" } as const;
    const accountParameters = new SqlParameters();
    expect(accountScope("a", baseQuery, actor, accountParameters)).toContain("a.owner_user_id=$1");
    const documentParameters = new SqlParameters();
    expect(documentScope(baseQuery, actor, documentParameters)).toContain("a.owner_user_id=$1");
  });

  it("uses the canonical derived overdue rule and bounded trend units", () => {
    expect(taskOverdueSql).toContain("t.status in ('PENDING','IN_PROGRESS')");
    expect(taskOverdueSql).toContain("at time zone t.timezone");
    expect(trendUnit({ from: "2026-08-01", to: "2026-08-31" })).toBe("day");
    expect(trendUnit({ from: "2026-01-01", to: "2026-08-31" })).toBe("month");
  });

  it("does not bind an unused timezone when the civil period is empty", () => {
    const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "MANAGER" } as const;
    const visitParameters = new SqlParameters();
    visitScope(baseQuery, actor, visitParameters);
    expect(visitParameters.values).toEqual([]);

    const documentParameters = new SqlParameters();
    documentScope(baseQuery, actor, documentParameters);
    expect(documentParameters.values).toEqual([]);
  });
});
