import { describe, expect, it, vi } from "vitest";

import { CountCache } from "./count-cache.js";

describe("CountCache", () => {
  it("coalesces concurrent loads for the same authorization and filter key", async () => {
    const cache = new CountCache();
    const load = vi.fn(() => Promise.resolve(42));

    await expect(
      Promise.all([cache.get("manager:all", load), cache.get("manager:all", load)]),
    ).resolves.toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves stale values while a single refresh updates the cache", async () => {
    vi.useFakeTimers();
    try {
      const cache = new CountCache(1_000);
      const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      await expect(cache.get("key", load)).resolves.toBe(1);
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(cache.get("key", load)).resolves.toBe(1);
      await vi.runAllTimersAsync();
      await expect(cache.get("key", load)).resolves.toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retain a failed initial load", async () => {
    const cache = new CountCache();
    const load = vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(2);

    await expect(cache.get("key", load)).rejects.toThrow("db");
    await expect(cache.get("key", load)).resolves.toBe(2);
  });
});
