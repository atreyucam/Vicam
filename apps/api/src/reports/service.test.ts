import { describe, expect, it, vi } from "vitest";

import { ReportsAnalyticsService } from "./service.js";

const supervisor = {
  userId: "00000000-0000-4000-8000-000000000002",
  role: "SUPERVISOR" as const,
  sessionId: "00000000-0000-4000-8000-000000000102",
  deviceId: "00000000-0000-4000-8000-000000000202",
};
const query = { timezone: "America/Guayaquil", page: 1, pageSize: 20 } as const;
const manager = {
  ...supervisor,
  userId: "00000000-0000-4000-8000-000000000001",
  role: "MANAGER" as const,
};

describe("ReportsAnalyticsService authorization", () => {
  it("keeps the management summary Manager-only without querying report data", async () => {
    const pool = { query: vi.fn() };
    const service = new ReportsAnalyticsService(pool as never);
    await expect(service.load("summary", query, supervisor)).rejects.toMatchObject({
      status: 403,
      code: "MANAGEMENT_REPORT_MANAGER_ONLY",
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects Supervisor analytics when own reports are disabled", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ enabled: false }] }) };
    const service = new ReportsAnalyticsService(pool as never);
    await expect(service.load("visits", query, supervisor)).rejects.toMatchObject({
      status: 403,
      code: "REPORTS_NOT_ENABLED",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-user Supervisor filter before executing analytics", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ enabled: true }] }) };
    const service = new ReportsAnalyticsService(pool as never);
    await expect(
      service.load(
        "tasks",
        { ...query, responsibleUserId: "00000000-0000-4000-8000-000000000003" },
        supervisor,
      ),
    ).rejects.toMatchObject({ status: 403, code: "REPORT_SCOPE_INVALID" });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("ReportsAnalyticsService metrics", () => {
  it("derives visit KPIs and pagination from the same filtered universe", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ valid: true }] })
        .mockResolvedValueOnce({
          rows: [{ total: 4, completed: 3, pending: 1, cancelled: 0, rescheduled: 1 }],
        })
        .mockResolvedValueOnce({ rows: [{ key: "2026-08-01", value: 4, completed: 3 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 4 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = new ReportsAnalyticsService(pool as never);

    const result = await service.load("visits", query, manager);

    expect(result.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "total", value: 4 }),
        expect.objectContaining({ key: "completed", value: 3 }),
        expect.objectContaining({ key: "rescheduled", value: 1 }),
        expect.objectContaining({ key: "compliance", value: 75, format: "PERCENT" }),
      ]),
    );
    expect(result.pagination).toMatchObject({ total: 4, totalPages: 1 });
    expect(result.distribution.map((item) => item.value)).toEqual([3, 1, 0]);
  });
});
