import { api, unwrap } from "../api/api";
import { idempotencyParams } from "../api/idempotency";
import { runtimeConfig } from "../config/runtime";

export type WebPushResult =
  { kind: "active" } | { kind: "denied" } | { kind: "unsupported" } | { kind: "unconfigured" };

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function registerWebPush(
  idempotencyKey: string,
  publicKey: unknown = runtimeConfig().webPushPublicKey ?? import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY,
): Promise<WebPushResult> {
  if (
    !("Notification" in globalThis) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in globalThis)
  )
    return { kind: "unsupported" };

  if (typeof publicKey !== "string" || !publicKey.trim()) return { kind: "unconfigured" };

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { kind: "denied" };

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      applicationServerKey: applicationServerKey(publicKey),
      userVisibleOnly: true,
    }));
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth)
    throw new Error("El navegador no devolvió una suscripción push completa.");

  const sessions = unwrap(await api.GET("/auth/sessions"));
  const current = sessions.find((session) => session.current);
  if (!current) throw new Error("No se encontró el dispositivo de la sesión actual.");

  unwrap(
    await api.POST("/push-subscriptions", {
      params: idempotencyParams(idempotencyKey),
      body: {
        deviceId: current.deviceId,
        endpoint: serialized.endpoint,
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
      },
    }),
  );
  return { kind: "active" };
}
