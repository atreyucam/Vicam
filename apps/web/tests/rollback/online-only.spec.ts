import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const session = {
  accessToken: "access-token-rollback-ficticio",
  accessTokenExpiresAt: "2026-07-24T23:00:00-05:00",
  csrfToken: "csrf-token-rollback-ficticio-123456",
  user: {
    id: "019b3e83-7a28-7000-8000-000000000001",
    username: "manager",
    fullName: "María Manager",
    role: "MANAGER",
    timezone: "America/Guayaquil",
    mustChangePassword: false,
  },
};

async function mockSession(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-token-rollback-ficticio-123456"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") return route.fulfill({ status: 200, json: session });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "No encontrado", requestId: "req-rollback" },
    });
  });
}

test("rollback online-only no crea bóveda y comunica el límite offline", async ({
  page,
}, testInfo) => {
  await mockSession(page);
  await page.goto("/app/sync");
  await expect(page.getByRole("heading", { name: "Modo online activo" })).toBeVisible();
  await expect(
    page.getByText(/almacenamiento y la sincronización offline están desactivados/i),
  ).toBeVisible();

  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((database) => database.name === "vicam-offline-v1"),
    ),
  ).toBe(false);

  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Sin conexión. El modo offline está desactivado.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const screenshot = testInfo.outputPath(`online-only-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("rollback-online-only", { path: screenshot, contentType: "image/png" });
});
