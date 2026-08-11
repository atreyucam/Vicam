import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const managerId = "019b3e83-7a28-7000-8000-000000000001";
const accountId = "019b3e83-7a28-7000-8000-000000000101";
const documentId = "019b3e83-7a28-7000-8000-000000000601";
const categoryId = "019b3e83-7a28-7000-8000-000000000701";
const batchId = "019b3e83-7a28-7000-8000-000000000778";
const confirmationId = "019b3e83-7a28-7000-8000-000000000777";
const now = "2026-07-24T15:00:00.000Z";
const session = {
  accessToken: "access-ficticio-phase3",
  accessTokenExpiresAt: "2026-07-24T16:00:00.000Z",
  csrfToken: "csrf-phase3-ficticio-123456789012",
  user: {
    id: managerId,
    username: "manager",
    fullName: "María Manager",
    role: "MANAGER",
    timezone: "America/Guayaquil",
    mustChangePassword: false,
  },
};
const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

async function mockPhase3(page: Page) {
  let documentStatus: "AVAILABLE" | "DELETED" = "AVAILABLE";
  const fruits = [
    {
      id: "019b3e83-7a28-7000-8000-000000000801",
      name: "Pitahaya",
      active: true,
      version: 1,
    },
  ];
  const categories = [{ id: categoryId, name: "Contrato", active: true, version: 1 }];
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-phase3-ficticio-123456789012"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    requests.push({
      method,
      path,
      body: request.postData() ? request.postDataJSON() : null,
    });
    if (path === "/auth/refresh") return route.fulfill({ json: session });
    if (path === "/reports/exports" && method === "GET")
      return route.fulfill({ json: { items: [], pagination: { ...pagination, total: 0 } } });
    if (path === "/reports/exports" && method === "POST")
      return route.fulfill({
        status: 202,
        json: {
          id: crypto.randomUUID(),
          group: "TASKS",
          template: "overdue",
          format: "XLSX",
          status: "QUEUED",
          filters: {},
          createdAt: now,
          expiresAt: "2026-07-31T15:00:00.000Z",
          error: null,
        },
      });
    if (path.startsWith("/reports/analytics/") && method === "GET") {
      const view = path.split("/").at(-1)!;
      return route.fulfill({
        json: {
          view,
          kpis: [
            { key: "total", label: "Total", value: 12, format: "NUMBER" },
            { key: "compliance", label: "Cumplimiento", value: 75, format: "PERCENT" },
          ],
          trend: [
            { key: "2026-07-01", label: "1 jul", value: 4 },
            { key: "2026-07-02", label: "2 jul", value: 8 },
          ],
          distribution: [
            { key: "PENDING", label: "Pendientes", value: 3 },
            { key: "COMPLETED", label: "Completadas", value: 9 },
          ],
          secondaryDistribution: [],
          responsibleActivity: [],
          attention: [],
          rows: [
            {
              id: crypto.randomUUID(),
              kind:
                view === "tasks"
                  ? "TASK"
                  : view === "accounts"
                    ? "ACCOUNT"
                    : view === "documents"
                      ? "DOCUMENT"
                      : "VISIT",
              title: view === "tasks" ? "Enviar propuesta" : "Visita de seguimiento",
              date: "2026-07-24",
              accountName: "Cliente Andino",
              responsibleName: "María Manager",
              status: view === "tasks" ? "PENDING" : "COMPLETED",
              priority: "HIGH",
              city: "Guayaquil",
              category: null,
              format: null,
              total: null,
              secondary: null,
              href: "/app/tasks",
            },
          ],
          pagination,
        },
      });
    }
    if (path === "/commercial-accounts" && method === "GET")
      return route.fulfill({
        json: {
          items: [
            {
              id: accountId,
              displayName: "Cliente Andino",
              legalName: null,
              accountType: "COMPANY",
              ownerUserId: managerId,
              countryCode: "EC",
              stateProvince: null,
              city: "Guayaquil",
              address: null,
              postalCode: null,
              phone: "+593400000000",
              email: null,
              timezone: "America/Guayaquil",
              latitude: null,
              longitude: null,
              locationSource: null,
              locationCapturedAt: null,
              fruitIds: [],
              status: "ACTIVE",
              version: 1,
              ownerFullName: "María Manager",
              primaryContactName: null,
              fruits: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
          pagination,
        },
      });
    if (path === "/users" && method === "GET")
      return route.fulfill({
        json: {
          items: [
            {
              id: managerId,
              username: "manager",
              fullName: "María Manager",
              role: "MANAGER",
              status: "ACTIVE",
              mustChangePassword: false,
              lastLoginAt: now,
              createdAt: now,
            },
          ],
          pagination,
        },
      });
    if (path === "/documents" && method === "GET")
      return route.fulfill({
        json: {
          items: [
            {
              id: documentId,
              accountId,
              visitId: null,
              taskId: null,
              categoryId,
              categoryName: "Contrato",
              originalName: "contrato.pdf",
              format: "PDF",
              sizeBytes: 2048,
              checksum: "a".repeat(64),
              status: documentStatus,
              rejectedReason: null,
              deletedAt: documentStatus === "DELETED" ? now : null,
              createdAt: now,
              createdBy: managerId,
            },
          ],
          pagination,
        },
      });
    if (path === `/documents/${documentId}` && method === "DELETE") {
      documentStatus = "DELETED";
      return route.fulfill({ json: { id: documentId, status: documentStatus } });
    }
    if (path === `/documents/${documentId}/restore` && method === "POST") {
      documentStatus = "AVAILABLE";
      return route.fulfill({ json: { id: documentId, status: documentStatus } });
    }
    if (path === "/fruits" && method === "GET") return route.fulfill({ json: fruits });
    if (path === "/fruits" && method === "POST") {
      fruits.push({
        id: crypto.randomUUID(),
        name: (request.postDataJSON() as { name: string }).name,
        active: true,
        version: 1,
      });
      return route.fulfill({ status: 201, json: fruits.at(-1) });
    }
    if (path.startsWith("/fruits/") && method === "PATCH") {
      Object.assign(fruits[0]!, request.postDataJSON(), { version: fruits[0]!.version + 1 });
      return route.fulfill({ json: fruits[0] });
    }
    if (path === "/document-categories" && method === "GET")
      return route.fulfill({ json: categories });
    if (path === "/document-categories" && method === "POST") {
      categories.push({
        id: crypto.randomUUID(),
        name: (request.postDataJSON() as { name: string }).name,
        active: true,
        version: 1,
      });
      return route.fulfill({ status: 201, json: categories.at(-1) });
    }
    if (path === `/imports/${batchId}`)
      return route.fulfill({
        json: {
          id: batchId,
          format: "CSV",
          status: "READY",
          totalRows: 1,
          createRows: 1,
          updateRows: 0,
          skipRows: 0,
          errorRows: 0,
          confirmationId,
          createdAt: now,
          completedAt: null,
          rows: [
            {
              rowNumber: 2,
              action: "CREATE",
              errors: [],
              duplicateOfAccountId: null,
              values: { displayName: "Cuenta ficticia" },
            },
          ],
        },
      });
    if (path === `/imports/${batchId}/confirm`)
      return route.fulfill({
        status: 202,
        json: {
          id: batchId,
          format: "CSV",
          status: "CONFIRMING",
          totalRows: 1,
          createRows: 1,
          updateRows: 0,
          skipRows: 0,
          errorRows: 0,
          confirmationId,
          createdAt: now,
          completedAt: null,
        },
      });
    if (path === "/notifications")
      return route.fulfill({ json: { items: [], pagination: { ...pagination, total: 0 } } });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "No encontrado", requestId: "req-phase3" },
    });
  });
  return requests;
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
}

test("reportes cubren cinco grupos, filtros, cola y responsive", async ({ page }, testInfo) => {
  const requests = await mockPhase3(page);
  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reportes" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Resumen", selected: true })).toBeVisible();
  for (const name of ["Resumen", "Visitas", "Tareas", "Clientes", "Documentos"])
    await expect(page.getByRole("tab", { name })).toBeVisible();
  await expect(page.getByText("Actividad en el tiempo")).toBeVisible();
  await page.getByRole("tab", { name: "Tareas" }).click();
  await expect(page.getByRole("tab", { name: "Tareas", selected: true })).toBeVisible();
  await page.getByLabel("Buscar cliente").fill("Andino");
  await page.getByLabel("Cliente", { exact: true }).selectOption(accountId);
  await page.getByLabel("Estado de tarea").selectOption("PENDING");
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  await page.getByLabel("Formato").selectOption("XLSX");
  await page.getByRole("button", { name: "Exportar Excel" }).click();
  await expect(page.getByText("Historial de exportaciones")).toBeVisible();
  expect(
    requests.some(
      (request) =>
        request.path === "/reports/exports" &&
        request.method === "POST" &&
        JSON.stringify(request.body).includes('"group":"TASKS"') &&
        JSON.stringify(request.body).includes(`"accountId":"${accountId}"`) &&
        JSON.stringify(request.body).includes('"status":"PENDING"'),
    ),
  ).toBe(true);
  await expectAccessible(page);
  const screenshot = testInfo.outputPath(`reportes-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("reportes-phase3-responsive", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("documentos por cuenta archivan/restauran e import usa confirmationId", async ({
  page,
}, testInfo) => {
  const requests = await mockPhase3(page);
  await page.goto(`/app/documents?accountId=${accountId}`);
  await expect(page.getByText("Documentos de este cliente")).toBeVisible();
  await page.getByRole("button", { name: "Archivar" }).click();
  await page.getByRole("button", { name: "Archivar documento" }).click();
  await expect(page.getByRole("button", { name: "Restaurar" })).toBeVisible();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await page.getByRole("button", { name: "Restaurar documento" }).click();
  await expect(page.getByRole("button", { name: "Archivar" })).toBeVisible();

  await page.goto(`/app/imports?batchId=${batchId}`);
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByText(/confirmación aceptada/i)).toBeVisible();
  expect(
    requests.some(
      (request) =>
        request.path === `/imports/${batchId}/confirm` &&
        JSON.stringify(request.body) === JSON.stringify({ confirmationId }),
    ),
  ).toBe(true);
  await expectAccessible(page);
  const screenshot = testInfo.outputPath(`documentos-import-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("documentos-import-phase3", { path: screenshot, contentType: "image/png" });
});

test("catálogos crean y desactivan sin eliminar historial", async ({ page }, testInfo) => {
  const requests = await mockPhase3(page);
  await page.goto("/app/catalogs/fruits");
  await expect(page.getByRole("heading", { name: "Frutas" })).toBeVisible();
  await page.getByLabel("Nueva fruta").fill("Mango");
  await page.getByRole("button", { name: "Crear" }).first().click();
  await expect(page.getByText("Mango")).toBeVisible();
  const pitahayaRow = page.locator(".catalog-row").filter({ hasText: "Pitahaya" });
  await pitahayaRow.getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("button", { name: "Desactivar", exact: true }).last().click();
  await expect(pitahayaRow.getByText("Inactivo")).toBeVisible();
  expect(
    requests.some(
      (request) =>
        request.path.includes("/fruits/") &&
        request.method === "PATCH" &&
        JSON.stringify(request.body).includes('"active":false'),
    ),
  ).toBe(true);
  await expectAccessible(page);
  const screenshot = testInfo.outputPath(`catalogos-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("catalogos-phase3-responsive", {
    path: screenshot,
    contentType: "image/png",
  });
});
