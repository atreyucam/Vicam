import { describe, expect, it, vi } from "vitest";
import { applyPwaShellUpdateWhenSafe, setPwaShellUpdater } from "./pwaUpdateState";

describe("actualización segura de la PWA", () => {
  it("espera a que termine la sincronización activa antes de recargar", async () => {
    const order: string[] = [];
    const updater = vi.fn(() => {
      order.push("update");
      return Promise.resolve();
    });
    setPwaShellUpdater(updater);
    await applyPwaShellUpdateWhenSafe(() => {
      order.push("sync-finished");
      return Promise.resolve();
    });
    expect(order).toEqual(["sync-finished", "update"]);
    expect(updater).toHaveBeenCalledWith(true);
  });
});
