import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let leaseValue: string | number | boolean | null | undefined;
vi.mock("./db", () => ({
  offlineDb: () => ({
    syncState: {
      delete: () => {
        leaseValue = undefined;
        return Promise.resolve();
      },
      get: () => Promise.resolve(leaseValue === undefined ? undefined : { value: leaseValue }),
      put: (record: { value: string | number | boolean | null }) => {
        leaseValue = record.value;
        return Promise.resolve();
      },
    },
    transaction: async (_mode: string, _table: unknown, task: () => Promise<unknown>) => task(),
  }),
}));

import { withOfflineLock } from "./locks";

describe("lease fallback mult pestaña", () => {
  beforeEach(() => {
    leaseValue = undefined;
    vi.useFakeTimers({ now: 0 });
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });

  afterEach(() => vi.useRealTimers());

  it("renueva la exclusión durante una tarea mayor a 15 segundos", async () => {
    let finish!: () => void;
    const running = withOfflineLock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(16_000);
    const lease = JSON.parse(String(leaseValue)) as { expires: number };
    expect(lease.expires).toBeGreaterThan(Date.now());
    finish();
    await running;
    expect(leaseValue).toBeUndefined();
  });
});
