import { describe, expect, it } from "vitest";

import { assertReportTemplate, parseReportFilters } from "./report-filters.js";

describe("report filters", () => {
  it("accepts typed filters for all five groups", () => {
    expect(parseReportFilters("VISITS", { from: "2026-07-01", priority: "HIGH" })).toEqual({
      from: "2026-07-01",
      priority: "HIGH",
    });
    expect(parseReportFilters("TASKS", { city: " Quito ", overdue: true })).toEqual({
      city: "Quito",
      overdue: true,
    });
    expect(
      parseReportFilters("ACCOUNTS", {
        accountId: "019b3e83-7a28-7000-8000-000000000101",
        countryCode: "ec",
        from: "2026-07-01",
      }),
    ).toEqual({
      accountId: "019b3e83-7a28-7000-8000-000000000101",
      countryCode: "EC",
      from: "2026-07-01",
    });
    expect(
      parseReportFilters("DOCUMENTS", {
        city: "Guayaquil",
        format: "PDF",
        responsibleUserId: "019b3e83-7a28-7000-8000-000000000002",
        status: "DELETED",
      }),
    ).toEqual({
      city: "Guayaquil",
      format: "PDF",
      responsibleUserId: "019b3e83-7a28-7000-8000-000000000002",
      status: "DELETED",
    });
    expect(
      parseReportFilters("MANAGEMENT", {
        accountId: "019b3e83-7a28-7000-8000-000000000101",
        city: "Cuenca",
        to: "2026-07-31",
      }),
    ).toEqual({
      accountId: "019b3e83-7a28-7000-8000-000000000101",
      city: "Cuenca",
      to: "2026-07-31",
    });
  });

  it("rejects unknown filters, inverted ranges and cross-group templates", () => {
    expect(() => parseReportFilters("VISITS", { injected: "a' or true --" })).toThrow();
    expect(() => parseReportFilters("TASKS", { from: "2026-08-01", to: "2026-07-01" })).toThrow();
    expect(() => assertReportTemplate("DOCUMENTS", "productivity")).toThrow();
    expect(() => assertReportTemplate("DOCUMENTS", "inventory")).not.toThrow();
    expect(() => assertReportTemplate("TASKS", "all")).not.toThrow();
  });
});
