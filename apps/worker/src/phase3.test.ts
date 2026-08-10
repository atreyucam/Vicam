import { createServer } from "node:net";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { readWorkerConfig } from "./config.js";
import { parseCsv } from "./import-processing.js";
import { clamScan, notificationResourceUrl } from "./phase3-jobs.js";
import { loadReportRecords, renderReport } from "./reporting.js";

describe("Phase 3 worker", () => {
  it("parses quoted CSV fields and preserves embedded commas", () => {
    expect(
      parseCsv(
        'displayName,city,phone,fruits\r\n"Cuenta, Uno",Guayaquil,+5931,"Banano; Mango"\r\n',
      ),
    ).toEqual([
      {
        displayName: "Cuenta, Uno",
        city: "Guayaquil",
        phone: "+5931",
        fruits: "Banano; Mango",
      },
    ]);
  });

  it("requires complete VAPID configuration but permits in-app-only operation", () => {
    expect(readWorkerConfig({}).VAPID_SUBJECT).toBeUndefined();
    expect(() => readWorkerConfig({ VAPID_PUBLIC_KEY: "public" })).toThrow(
      "must be configured together",
    );
  });

  it("builds only application URLs accepted by the push handler", () => {
    expect(notificationResourceUrl("visit", "visit-1")).toBe("/app/visits/visit-1");
    expect(notificationResourceUrl("task", "task-1")).toBe("/app/tasks/task-1");
    expect(notificationResourceUrl("report_export", "export-1")).toBe("/app/reports/exports");
    expect(notificationResourceUrl("unknown", null)).toBe("/app/notifications");
  });

  it("renders the same records and metadata to PDF and XLSX", async () => {
    const records = [{ cuenta: "Cuenta Ficticia", estado: "ACTIVE" }];
    const base = {
      report_group: "ACCOUNTS" as const,
      timezone: "America/Guayaquil",
      filters: { countryCode: "EC" },
      template: "directory",
    };
    const xlsx = await renderReport({ ...base, format: "XLSX" }, records);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx as never);
    const values = workbook.worksheets[0]!.getSheetValues().flat().map(String);
    expect(values).toEqual(
      expect.arrayContaining(["ACCOUNTS", "directory", "America/Guayaquil", "Cuenta Ficticia"]),
    );
    const pdf = await renderReport({ ...base, format: "PDF" }, records);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("uses distinct SQL shapes for workload and management activity templates", async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn((sql: string) => {
        if (sql.startsWith("select role from users")) return { rows: [{ role: "MANAGER" }] };
        queries.push(sql);
        return { rows: [] };
      }),
    };
    const base = {
      id: "019b3e83-7a28-7000-8000-000000000501",
      format: "PDF" as const,
      requester_user_id: "019b3e83-7a28-7000-8000-000000000001",
      requester_role: "MANAGER" as const,
      scope_user_id: null,
      timezone: "America/Guayaquil",
      filters: {},
    };
    await loadReportRecords(pool as never, {
      ...base,
      report_group: "TASKS",
      template: "workload",
    });
    await loadReportRecords(pool as never, {
      ...base,
      report_group: "TASKS",
      template: "open",
    });
    await loadReportRecords(pool as never, {
      ...base,
      report_group: "MANAGEMENT",
      template: "kpis",
    });
    await loadReportRecords(pool as never, {
      ...base,
      report_group: "MANAGEMENT",
      template: "period-activity",
    });

    expect(queries[0]).toContain("group by u.id,u.full_name");
    expect(queries[1]).toContain("t.title titulo");
    expect(queries[2]).toContain("cumplimiento_porcentaje");
    expect(queries[3]).toContain("'VISIT'::text kind");
    expect(new Set(queries).size).toBe(4);
  });

  it("interprets ClamAV clean and infected responses without logging content", async () => {
    const scan = async (response: string) => {
      const server = createServer((socket) => {
        socket.on("data", () => {
          socket.end(response);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      try {
        return await clamScan(Buffer.from("archivo-ficticio"), {
          ...readWorkerConfig({}),
          CLAMD_HOST: "127.0.0.1",
          CLAMD_PORT: address.port,
        });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    };
    await expect(scan("stream: OK\0")).resolves.toBe(true);
    await expect(scan("stream: Eicar-Test-Signature FOUND\0")).resolves.toBe(false);
  });
});
