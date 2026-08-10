import { offlineDb } from "./db";
import { getOfflineChannelId } from "./channel";

const lockName = "vicam-offline-exclusive";
const owner = crypto.randomUUID();
const leaseKey = "exclusiveLease";
const leaseMilliseconds = 15_000;
const renewalMilliseconds = 5_000;
const channelId = getOfflineChannelId();
const channel =
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`vicam-sync-${channelId}`);

type OfflineChannelMessage = { reason?: string; type: string };

function parseLease(value: unknown): { owner: string; expires: number } | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { owner?: unknown; expires?: unknown };
    return typeof parsed.owner === "string" && typeof parsed.expires === "number"
      ? { owner: parsed.owner, expires: parsed.expires }
      : null;
  } catch {
    return null;
  }
}

async function withLease<T>(task: () => Promise<T>): Promise<T> {
  const db = offlineDb();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const acquired = await db.transaction("rw", db.syncState, async () => {
      const current = await db.syncState.get(leaseKey);
      const lease = parseLease(current?.value);
      if (lease && lease.expires > Date.now() && lease.owner !== owner) return false;
      await db.syncState.put({
        key: leaseKey,
        value: JSON.stringify({ owner, expires: Date.now() + leaseMilliseconds }),
      });
      return true;
    });
    if (acquired) {
      let stopped = false;
      let renewal: ReturnType<typeof setTimeout> | undefined;
      let renewalError: Error | undefined;
      const scheduleRenewal = () => {
        renewal = setTimeout(() => {
          void renew().catch((error: unknown) => {
            renewalError =
              error instanceof Error
                ? error
                : new Error("No fue posible renovar el bloqueo local.");
            stopped = true;
          });
        }, renewalMilliseconds);
      };
      const renew = async () => {
        if (stopped) return;
        await db.transaction("rw", db.syncState, async () => {
          const current = parseLease((await db.syncState.get(leaseKey))?.value);
          if (!current || current.owner !== owner)
            throw new Error("Se perdió el bloqueo exclusivo de los datos locales.");
          await db.syncState.put({
            key: leaseKey,
            value: JSON.stringify({ owner, expires: Date.now() + leaseMilliseconds }),
          });
        });
        if (!stopped) scheduleRenewal();
      };
      scheduleRenewal();
      try {
        const result = await task();
        if (renewalError) throw renewalError;
        return result;
      } finally {
        stopped = true;
        if (renewal) clearTimeout(renewal);
        await db
          .transaction("rw", db.syncState, async () => {
            const current = parseLease((await db.syncState.get(leaseKey))?.value);
            if (current?.owner === owner) await db.syncState.delete(leaseKey);
          })
          .catch(() => undefined);
        channel?.postMessage({ type: "released" });
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Otra pestaña está actualizando los datos locales.");
}

export async function withOfflineLock<T>(task: () => Promise<T>): Promise<T> {
  if (navigator.locks) return await navigator.locks.request(lockName, { mode: "exclusive" }, task);
  return withLease(task);
}

export function notifyOfflineChange(type: string): void {
  channel?.postMessage({ type });
  window.dispatchEvent(new CustomEvent("vicam:offline-change", { detail: type }));
}

export function notifyOfflinePurge(reason: string): void {
  channel?.postMessage({ reason, type: "purge" } satisfies OfflineChannelMessage);
}

export function onOfflinePurge(listener: (reason: string) => void): () => void {
  const remote = (event: MessageEvent<OfflineChannelMessage>) => {
    if (event.data?.type === "purge") listener(event.data.reason ?? "remote-session-purge");
  };
  channel?.addEventListener("message", remote);
  return () => channel?.removeEventListener("message", remote);
}

export function onOfflineChange(listener: () => void): () => void {
  const local = () => listener();
  const remote = () => listener();
  window.addEventListener("vicam:offline-change", local);
  channel?.addEventListener("message", remote);
  return () => {
    window.removeEventListener("vicam:offline-change", local);
    channel?.removeEventListener("message", remote);
  };
}
