import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/api";
import { registerWebPush } from "./webPush";

const originalNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
const originalPushManager = Object.getOwnPropertyDescriptor(globalThis, "PushManager");
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  vi.restoreAllMocks();
  for (const [target, name, descriptor] of [
    [globalThis, "Notification", originalNotification],
    [globalThis, "PushManager", originalPushManager],
    [navigator, "serviceWorker", originalServiceWorker],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

describe("registro Web Push", () => {
  it("solicita permiso por acción, usa PushManager y registra el dispositivo actual", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example.test/subscription",
        keys: { p256dh: "public-key", auth: "auth-secret" },
      }),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe },
        }),
      },
    });
    vi.spyOn(api, "GET").mockResolvedValue({
      data: [
        {
          id: "019b3e83-7a28-7000-8000-000000000902",
          deviceId: "019b3e83-7a28-7000-8000-000000000901",
          deviceName: "PWA VICAM",
          platform: "web",
          createdAt: "2026-07-24T10:00:00.000Z",
          lastUsedAt: "2026-07-24T10:00:00.000Z",
          expiresAt: "2026-07-31T10:00:00.000Z",
          current: true,
        },
      ],
      response: new Response(null, { status: 200 }),
    });
    const post = vi.spyOn(api, "POST").mockResolvedValue({
      data: { id: "019b3e83-7a28-7000-8000-000000000903" },
      response: new Response(null, { status: 201 }),
    });

    await expect(registerWebPush("operation-key", "AQID")).resolves.toEqual({ kind: "active" });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(post).toHaveBeenCalledWith(
      "/push-subscriptions",
      expect.objectContaining({
        body: {
          deviceId: "019b3e83-7a28-7000-8000-000000000901",
          endpoint: "https://push.example.test/subscription",
          p256dh: "public-key",
          auth: "auth-secret",
        },
      }),
    );
  });

  it("no solicita permiso cuando el entorno no tiene clave VAPID pública", async () => {
    const requestPermission = vi.fn();
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({}) },
    });

    await expect(registerWebPush("operation-key", "")).resolves.toEqual({
      kind: "unconfigured",
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
