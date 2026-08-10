import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Role = "MANAGER" | "SUPERVISOR";

function session(role: Role) {
  return {
    accessToken: `access-${role.toLowerCase()}-ficticio`,
    accessTokenExpiresAt: "2026-07-24T23:00:00-05:00",
    csrfToken: "csrf-phase4-ficticio-123456789012",
    user: {
      id:
        role === "MANAGER"
          ? "019b3e83-7a28-7000-8000-000000000001"
          : "019b3e83-7a28-7000-8000-000000000002",
      username: role.toLowerCase(),
      fullName: role === "MANAGER" ? "María Manager" : "Sofía Supervisor",
      role,
      timezone: "America/Guayaquil",
      mustChangePassword: false,
    },
  };
}

async function mockRole(page: Page, role: Role) {
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-phase4-ficticio-123456789012"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") return route.fulfill({ status: 200, json: session(role) });
    if (path === "/audit")
      return route.fulfill({
        json: { items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
      });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "No encontrado", requestId: "req-phase4" },
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectAccessible(page: Page) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
}

test("Manager y Supervisor respetan navegación, permiso, teclado y responsive", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.use.viewport ?? null;
  const managerContext = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport });
  const manager = await managerContext.newPage();
  await mockRole(manager, "MANAGER");
  await manager.goto("/app/audit");
  await expect(manager.getByRole("heading", { name: "Sin actividad registrada" })).toBeVisible();
  await manager.keyboard.press("Tab");
  await expect(manager.getByRole("link", { name: "Saltar al contenido principal" })).toBeFocused();
  await expectNoHorizontalOverflow(manager);
  await expectAccessible(manager);

  const supervisorContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport,
  });
  const supervisor = await supervisorContext.newPage();
  await mockRole(supervisor, "SUPERVISOR");
  await supervisor.goto("/app/audit");
  await expect(supervisor.getByRole("heading", { name: "No tienes permiso" })).toBeVisible();
  await expect(supervisor.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
  await expectNoHorizontalOverflow(supervisor);
  await expectAccessible(supervisor);

  const screenshot = testInfo.outputPath(`roles-${testInfo.project.name}.png`);
  await supervisor.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("roles-responsive", { path: screenshot, contentType: "image/png" });
  await managerContext.close();
  await supervisorContext.close();
});

test("PWA registra SW, manifest instalable y aviso de actualización accesible", async ({
  page,
}, testInfo) => {
  await mockRole(page, "MANAGER");
  await page.goto("/app/more");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const registration = await page.evaluate(async () => {
    const value = await navigator.serviceWorker.ready;
    const manifestUrl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return { manifestUrl, scope: value.scope };
  });
  expect(registration.scope).toBe("http://127.0.0.1:4173/");
  expect(registration.manifestUrl).toBeTruthy();
  const manifest = await page.evaluate(async (url) => {
    const response = await fetch(url!);
    return response.json() as Promise<Record<string, unknown>>;
  }, registration.manifestUrl);
  expect(manifest).toMatchObject({
    display: "standalone",
    lang: "es-EC",
    scope: "/",
    start_url: "/app",
    theme_color: "#0075DE",
  });

  await page.evaluate(() => window.dispatchEvent(new Event("vicam:pwa-update-ready")));
  const banner = page.getByRole("status").filter({ hasText: "Nueva versión lista." });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Actualizar" }).focus();
  await expect(banner.getByRole("button", { name: "Actualizar" })).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);

  const screenshot = testInfo.outputPath(`pwa-update-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("pwa-update-responsive", { path: screenshot, contentType: "image/png" });
});
