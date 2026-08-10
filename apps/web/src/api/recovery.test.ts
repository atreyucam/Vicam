import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  document.cookie = "vicam_csrf=bootstrap-csrf-token-with-32-characters; Path=/";
});

it("mantiene un único refresh de bootstrap aunque la primera llamada ya haya resuelto", async () => {
  const session = {
    accessToken: "access-ficticio",
    accessTokenExpiresAt: "2026-07-22T22:00:00.000Z",
    csrfToken: "csrf-rotado-ficticio-de-32-caracteres",
    user: {
      id: "019b3e83-7a28-7000-8000-000000000001",
      username: "manager.demo",
      fullName: "María Manager",
      role: "MANAGER" as const,
      timezone: "America/Guayaquil",
      mustChangePassword: false,
    },
  };
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
  const { recoverSession } = await import("./api");

  await expect(recoverSession()).resolves.toMatchObject({ accessToken: "access-ficticio" });
  await expect(recoverSession()).resolves.toMatchObject({ accessToken: "access-ficticio" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
