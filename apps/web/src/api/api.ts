import type { ErrorEnvelope, SessionTokenResponse } from "@vicam/contracts";
import { createVicamApiClient } from "@vicam/contracts/client";
import { clearLocalStoragePreservingOfflineChannel } from "../offline/channel";

let accessToken: string | null = null;
let refreshPromise: Promise<SessionTokenResponse | null> | null = null;
let recoveryPromise: Promise<SessionTokenResponse | null> | null = null;
const retryTemplates = new WeakMap<Request, Request>();
const sessionExpiredListeners = new Set<() => void>();
const csrfStorageKey = "vicam.csrf";
const csrfCookieName = "vicam_csrf";

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}

let csrfToken: string | null = sessionStorage.getItem(csrfStorageKey) ?? readCookie(csrfCookieName);

const configuredBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL;
const baseUrl = new URL(
  typeof configuredBaseUrl === "string" ? configuredBaseUrl : "/api/v1",
  window.location.origin,
)
  .toString()
  .replace(/\/$/, "");
export const api = createVicamApiClient(baseUrl);

api.use({
  onRequest({ request }) {
    if (accessToken) request.headers.set("authorization", `Bearer ${accessToken}`);
    if (csrfToken && request.method !== "GET" && request.method !== "HEAD")
      request.headers.set("x-csrf-token", csrfToken);
    retryTemplates.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || isAuthenticationRequest(request.url)) return response;
    const session = await refreshSession();
    if (!session) {
      await expireSession();
      return response;
    }
    const retry = retryTemplates.get(request)?.clone();
    if (!retry) {
      await expireSession();
      return response;
    }
    retry.headers.set("authorization", `Bearer ${session.accessToken}`);
    if (retry.method !== "GET" && retry.method !== "HEAD")
      retry.headers.set("x-csrf-token", session.csrfToken);
    const retriedResponse = await fetch(retry);
    if (retriedResponse.status === 401) await expireSession();
    return retriedResponse;
  },
});

function isAuthenticationRequest(url: string) {
  const pathname = new URL(url, window.location.origin).pathname;
  return ["/auth/login", "/auth/refresh", "/auth/logout"].some((path) => pathname.endsWith(path));
}

async function performRefresh() {
  const recoveryCsrf = getSessionCsrfToken();
  if (!recoveryCsrf) return null;
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "x-csrf-token": recoveryCsrf },
  });
  if (!response.ok) return null;
  const session = (await response.json()) as SessionTokenResponse;
  setSessionTokens(session);
  return session;
}

export function refreshSession() {
  refreshPromise ??= performRefresh()
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export function recoverSession() {
  recoveryPromise ??= refreshSession();
  return recoveryPromise;
}

async function expireSession() {
  setSessionTokens(null);
  await purgeLocalCaches();
  sessionExpiredListeners.forEach((listener) => listener());
}

export function onSessionExpired(listener: () => void) {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export function setSessionTokens(session: SessionTokenResponse | null) {
  accessToken = session?.accessToken ?? null;
  csrfToken = session?.csrfToken ?? null;
  if (csrfToken) sessionStorage.setItem(csrfStorageKey, csrfToken);
  else sessionStorage.removeItem(csrfStorageKey);
}

export function getSessionCsrfToken() {
  csrfToken ??= sessionStorage.getItem(csrfStorageKey) ?? readCookie(csrfCookieName);
  return csrfToken;
}

export function hasOnlineAccessToken() {
  return Boolean(accessToken);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public envelope?: ErrorEnvelope,
  ) {
    super(envelope?.message ?? "No fue posible completar la solicitud.");
  }
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  throw new ApiError(result.response.status, result.error as ErrorEnvelope | undefined);
}

export async function purgeLocalCaches() {
  document.cookie = `${csrfCookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    clearLocalStoragePreservingOfflineChannel();
  } catch {
    /* almacenamiento no disponible */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* almacenamiento no disponible */
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ("indexedDB" in window && "databases" in indexedDB) {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases.flatMap((database) =>
        database.name
          ? [
              new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(database.name!);
                request.onsuccess = request.onerror = request.onblocked = () => resolve();
              }),
            ]
          : [],
      ),
    );
  }
  window.dispatchEvent(new CustomEvent("vicam:offline-purged", { detail: "session-purge" }));
}
