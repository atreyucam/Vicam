import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  getSessionCsrfToken,
  onSessionExpired,
  purgeLocalCaches,
  setSessionTokens,
  unwrap,
} from "./api";

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  return mock;
});

const cookieCsrf = "csrf-cookie-ficticio-de-pruebas-123456";
const user = {
  id: "019b3e83-7a28-7000-8000-000000000001",
  username: "manager",
  fullName: "María Manager",
  role: "MANAGER" as const,
  timezone: "America/Guayaquil",
  mustChangePassword: false,
};
const session = (accessToken: string, csrfToken: string) => ({
  accessToken,
  accessTokenExpiresAt: "2026-07-22T22:00:00.000Z",
  csrfToken,
  user,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("recuperación CSRF", () => {
  afterEach(async () => {
    await purgeLocalCaches();
    setSessionTokens(null);
    fetchMock.mockReset();
  });

  it("recupera vicam_csrf cuando memoria y sessionStorage están vacíos", () => {
    setSessionTokens(null);
    document.cookie = `vicam_csrf=${encodeURIComponent(cookieCsrf)}; Path=/; SameSite=Lax`;

    expect(sessionStorage.getItem("vicam.csrf")).toBeNull();
    expect(getSessionCsrfToken()).toBe(cookieCsrf);
  });

  it("purga almacenamiento y la cookie CSRF legible", async () => {
    localStorage.setItem("vicam.test", "dato");
    localStorage.setItem("vicam.offline-channel", "canal-tecnico-estable");
    sessionStorage.setItem("vicam.test", "dato");
    document.cookie = `vicam_csrf=${encodeURIComponent(cookieCsrf)}; Path=/; SameSite=Lax`;

    await purgeLocalCaches();

    expect(Object.keys(localStorage)).toEqual(["vicam.offline-channel"]);
    expect(localStorage.getItem("vicam.offline-channel")).toBe("canal-tecnico-estable");
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain("vicam_csrf=");
  });

  it("comparte un único refresh, rota tokens y reintenta cada 401 una vez", async () => {
    setSessionTokens(session("access-viejo", cookieCsrf));
    let refreshes = 0;
    const requests: Array<{ authorization: string | null; csrf: string | null; url: string }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push({
        authorization: request.headers.get("authorization"),
        csrf: request.headers.get("x-csrf-token"),
        url: request.url,
      });
      if (request.url.endsWith("/auth/refresh")) {
        refreshes += 1;
        await Promise.resolve();
        return json(session("access-rotado", "csrf-rotado-ficticio-123456789012345"));
      }
      if (request.headers.get("authorization") === "Bearer access-viejo") return json({}, 401);
      return json(user);
    });

    const [first, second] = await Promise.all([api.GET("/auth/me"), api.GET("/auth/me")]);

    expect(unwrap(first).id).toBe(user.id);
    expect(unwrap(second).id).toBe(user.id);
    expect(refreshes).toBe(1);
    expect(
      requests.filter((request) => request.authorization === "Bearer access-rotado"),
    ).toHaveLength(2);
    expect(sessionStorage.getItem("vicam.csrf")).toBe("csrf-rotado-ficticio-123456789012345");
  });

  it("reintenta POST y PATCH consumidos con el access y CSRF rotados", async () => {
    setSessionTokens(session("access-viejo", cookieCsrf));
    const attempts: Array<{
      authorization: string | null;
      body: string;
      csrf: string | null;
      idempotencyKey: string | null;
      method: string;
    }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/auth/refresh"))
        return json(session("access-rotado", "csrf-rotado-ficticio-123456789012345"));
      attempts.push({
        authorization: request.headers.get("authorization"),
        body: await request.text(),
        csrf: request.headers.get("x-csrf-token"),
        idempotencyKey: request.headers.get("idempotency-key"),
        method: request.method,
      });
      return request.headers.get("authorization") === "Bearer access-viejo"
        ? json({}, 401)
        : json({});
    });

    const [post, patch] = await Promise.all([
      api.POST("/auth/change-password", {
        body: { currentPassword: "Anterior-1!", newPassword: "Nueva-Vicam-2!" },
      }),
      api.PATCH("/tasks/{id}", {
        params: {
          path: { id: "019b3e83-7a28-7000-8000-000000000099" },
          header: { "idempotency-key": "019b3e83-7a28-7000-8000-000000000901" },
        },
        body: { priority: "MEDIUM", title: "Seguimiento actualizado", version: 1 },
      }),
    ]);

    expect(post.response.status).toBe(200);
    expect(patch.response.status).toBe(200);
    expect(attempts).toHaveLength(4);
    const retried = attempts.filter((attempt) => attempt.authorization === "Bearer access-rotado");
    expect(retried).toHaveLength(2);
    expect(retried.map((attempt) => attempt.method).sort()).toEqual(["PATCH", "POST"]);
    expect(
      retried.every((attempt) => attempt.csrf === "csrf-rotado-ficticio-123456789012345"),
    ).toBe(true);
    expect(retried.some((attempt) => attempt.body.includes("Seguimiento actualizado"))).toBe(true);
    expect(retried.some((attempt) => attempt.body.includes("Nueva-Vicam-2!"))).toBe(true);
    expect(
      attempts
        .filter((attempt) => attempt.method === "PATCH")
        .map((attempt) => attempt.idempotencyKey),
    ).toEqual(["019b3e83-7a28-7000-8000-000000000901", "019b3e83-7a28-7000-8000-000000000901"]);
  });

  it("no crea un ciclo cuando el reintento de mutación recibe 403", async () => {
    setSessionTokens(session("access-viejo", cookieCsrf));
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json(session("access-rotado", "csrf-rotado-ficticio-123456789012345")))
      .mockResolvedValueOnce(json({}, 403));

    const result = await api.PATCH("/tasks/{id}", {
      params: { path: { id: "019b3e83-7a28-7000-8000-000000000099" } },
      body: { priority: "MEDIUM", title: "No duplicar", version: 1 },
    });

    expect(result.response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("purga y notifica sesión vencida cuando falla el refresh", async () => {
    setSessionTokens(session("access-vencido", cookieCsrf));
    localStorage.setItem("vicam.cache", "dato");
    localStorage.setItem("vicam.offline-channel", "canal-tecnico-estable");
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      void (input instanceof Request ? input : new Request(input, init));
      return Promise.resolve(json({}, 401));
    });

    const result = await api.GET("/auth/me");

    expect(result.response.status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(Object.keys(localStorage)).toEqual(["vicam.offline-channel"]);
    expect(sessionStorage.length).toBe(0);
    unsubscribe();
  });
});
