import { describe, expect, it } from "vitest";

import { assertReportTemplate, parseReportFilters } from "./report-filters.js";

describe("report filters", () => {
  it("accepts typed filters for all five groups", () => {
    expect(parseReportFilters("VISITS", { from: "2026-07-01", priority: "HIGH" })).toEqual({
      from: "2026-07-01",
      priority: "HIGH",
    });
    expect(parseReportFilters("TASKS", { overdue: true })).toEqual({ overdue: true });
    expect(parseReportFilters("ACCOUNTS", { countryCode: "ec" })).toEqual({
      countryCode: "EC",
    });
    expect(parseReportFilters("DOCUMENTS", { format: "PDF" })).toEqual({ format: "PDF" });
    expect(parseReportFilters("MANAGEMENT", { to: "2026-07-31" })).toEqual({
      to: "2026-07-31",
    });
  });

  it("rejects unknown filters, inverted ranges and cross-group templates", () => {
    expect(() => parseReportFilters("VISITS", { injected: "a' or true --" })).toThrow();
    expect(() => parseReportFilters("TASKS", { from: "2026-08-01", to: "2026-07-01" })).toThrow();
    expect(() => assertReportTemplate("DOCUMENTS", "productivity")).toThrow();
    expect(() => assertReportTemplate("DOCUMENTS", "inventory")).not.toThrow();
  });
});
