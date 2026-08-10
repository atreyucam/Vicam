import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __gpsRequests: number;
  }
}

const managerId = "019b3e83-7a28-7000-8000-000000000001";
const supervisorId = "019b3e83-7a28-7000-8000-000000000002";
const accountId = "019b3e83-7a28-7000-8000-000000000101";
const visitId = "019b3e83-7a28-7000-8000-000000000201";
const taskId = "019b3e83-7a28-7000-8000-000000000301";
const fruitId = "019b3e83-7a28-7000-8000-000000000801";
const pageMeta = { page: 1, pageSize: 100, total: 1, totalPages: 1 };

function user(role: "MANAGER" | "SUPERVISOR", mustChangePassword = false) {
  return {
    id: role === "MANAGER" ? managerId : supervisorId,
    username: role.toLowerCase(),
    fullName: role === "MANAGER" ? "María Manager" : "Sofía Supervisor",
    role,
    mustChangePassword,
  };
}
function session(role: "MANAGER" | "SUPERVISOR", mustChangePassword = false) {
  return {
    accessToken: "access-token-ficticio",
    accessTokenExpiresAt: "2026-07-22T22:00:00-05:00",
    csrfToken: "csrf-token-ficticio-de-pruebas-123456",
    user: user(role, mustChangePassword),
  };
}
const account = {
  id: accountId,
  displayName: "Frutas Andinas",
  legalName: "Frutas Andinas S.A.",
  accountType: "DISTRIBUTOR",
  ownerUserId: supervisorId,
  countryCode: "EC",
  stateProvince: "Pichincha",
  city: "Quito",
  address: "Av. de prueba",
  postalCode: null,
  phone: "+593 2 555 0101",
  email: "contacto@example.test",
  timezone: "America/Guayaquil",
  latitude: -0.180653,
  longitude: -78.467834,
  locationSource: "DEVICE",
  locationCapturedAt: "2026-07-22T14:00:00-05:00",
  fruitIds: [fruitId],
  fruits: [{ id: fruitId, name: "Pitahaya" }],
  status: "ACTIVE",
  version: 1,
  ownerFullName: "Sofía Supervisor",
  primaryContactName: "Ana Pérez",
  createdAt: "2026-07-20T14:00:00-05:00",
  updatedAt: "2026-07-21T14:00:00-05:00",
};
const visit = {
  id: visitId,
  accountId,
  accountDisplayName: account.displayName,
  responsibleUserId: supervisorId,
  responsibleFullName: "Sofía Supervisor",
  scheduledAt: "2026-07-22T15:00:00-05:00",
  timezone: "America/Guayaquil",
  reason: "Revisión de temporada",
  priority: "HIGH",
  notes: "Confirmar volúmenes",
  status: "PENDING",
  result: null,
  observation: null,
  actualStartedAt: null,
  actualEndedAt: null,
  cancellationReason: null,
  version: 1,
};
const visitDetail = {
  ...visit,
  createdAt: "2026-07-20T14:00:00-05:00",
  createdByFullName: "Sofía Supervisor",
  completedAt: null,
  completedByFullName: null,
  cancelledAt: null,
  cancelledByFullName: null,
  history: [
    {
      id: `${visitId}:created`,
      type: "CREATED",
      occurredAt: "2026-07-20T14:00:00-05:00",
      actorUserId: supervisorId,
      actorFullName: "Sofía Supervisor",
      scheduledAt: visit.scheduledAt,
      oldScheduledAt: null,
      newScheduledAt: null,
      reason: null,
      result: null,
    },
  ],
};
const task = {
  id: taskId,
  accountId,
  accountDisplayName: account.displayName,
  visitId,
  responsibleUserId: supervisorId,
  responsibleFullName: "Sofía Supervisor",
  title: "Enviar propuesta",
  description: "Preparar condiciones",
  dueDate: "2026-07-21",
  dueTime: "16:00:00",
  timezone: "America/Guayaquil",
  priority: "HIGH",
  status: "PENDING",
  overdue: true,
  completedAt: null,
  visitScheduledAt: visit.scheduledAt,
  visitReason: visit.reason,
  version: 1,
};
const taskDetail = {
  ...task,
  createdAt: "2026-07-20T14:00:00-05:00",
  createdByFullName: "Sofía Supervisor",
  completedByFullName: null,
  cancelledAt: null,
  cancelledByFullName: null,
  cancellationReason: null,
};

async function mockApi(page: Page, role: "MANAGER" | "SUPERVISOR", refreshOk = true) {
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-token-ficticio-de-pruebas-123456"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    if (path === "/auth/refresh")
      return route.fulfill(
        refreshOk
          ? { status: 200, json: session(role) }
          : {
              status: 401,
              json: { code: "SESSION_EXPIRED", message: "Sesión vencida", requestId: "req-auth" },
            },
      );
    if (path === "/auth/login") return route.fulfill({ status: 200, json: session(role) });
    if (path === "/auth/logout") return route.fulfill({ status: 204, body: "" });
    if (path === "/users")
      return route.fulfill({
        json: {
          items: [user("MANAGER"), user("SUPERVISOR")].map((item) => ({
            ...item,
            status: "ACTIVE",
            lastLoginAt: null,
            createdAt: "2026-07-20T14:00:00-05:00",
          })),
          pagination: { ...pageMeta, total: 2 },
        },
      });
    if (path === "/fruits")
      return route.fulfill({ json: [{ id: fruitId, name: "Pitahaya", active: true }] });
    if (path === "/commercial-accounts" && method === "GET")
      return route.fulfill({ json: { items: [account], pagination: pageMeta } });
    if (path === "/commercial-accounts" && method === "POST")
      return route.fulfill({ status: 201, json: account });
    if (path === `/commercial-accounts/${accountId}`) return route.fulfill({ json: account });
    if (path === `/commercial-accounts/${accountId}/commercial-summary`)
      return route.fulfill({
        json: {
          nextVisit: {
            id: visitId,
            scheduledAt: visit.scheduledAt,
            reason: visit.reason,
            responsibleFullName: visit.responsibleFullName,
            priority: visit.priority,
          },
          openTaskCount: 1,
          dueTodayTaskCount: 0,
          recentActivity: [],
        },
      });
    if (path === `/commercial-accounts/${accountId}/contacts`)
      return route.fulfill({
        json: [
          {
            id: "019b3e83-7a28-7000-8000-000000000111",
            accountId,
            fullName: "Ana Pérez",
            title: "Compras",
            phone: "+593 2 555 0102",
            email: null,
            notes: null,
            isPrimary: true,
            version: 1,
          },
        ],
      });
    if (path === "/visits" && method === "GET")
      return route.fulfill({ json: { items: [visit], pagination: pageMeta } });
    if (path === "/visits" && method === "POST") return route.fulfill({ status: 201, json: visit });
    if (path === `/visits/${visitId}`) return route.fulfill({ json: visitDetail });
    if (path.startsWith(`/visits/${visitId}/`))
      return route.fulfill({
        json: {
          ...visit,
          status: path.endsWith("complete")
            ? "COMPLETED"
            : path.endsWith("cancel")
              ? "CANCELLED"
              : "PENDING",
          version: 2,
        },
      });
    if (path === "/tasks" && method === "GET")
      return route.fulfill({ json: { items: [task], pagination: pageMeta } });
    if (path === "/tasks" && method === "POST") return route.fulfill({ status: 201, json: task });
    if (path === `/tasks/${taskId}`) return route.fulfill({ json: taskDetail });
    if (path === `/tasks/${taskId}/complete`)
      return route.fulfill({ json: { ...task, status: "COMPLETED", overdue: false, version: 2 } });
    if (path === `/tasks/${taskId}/cancel`)
      return route.fulfill({
        json: { ...task, status: "CANCELLED", overdue: false, version: 2 },
      });
    if (path === "/audit")
      return route.fulfill({
        json: {
          items: [
            {
              id: "audit-1",
              actorUserId: managerId,
              action: "ACCOUNT_CREATED",
              entityType: "commercial_account",
              entityId: accountId,
              changedFields: ["displayName"],
              requestId: "req-audit",
              ipAddress: null,
              createdAt: "2026-07-22T14:00:00-05:00",
            },
          ],
          pagination: pageMeta,
        },
      });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "No encontrado", requestId: "req-404" },
    });
  });
}

test("Contraseña temporal bloquea URLs de negocio y libera la sesión después del cambio", async ({
  page,
}) => {
  let mustChangePassword = true;
  let changeBody: unknown;
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-token-ficticio-de-pruebas-123456"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh")
      return route.fulfill({ status: 200, json: session("SUPERVISOR", mustChangePassword) });
    if (path === "/auth/change-password") {
      changeBody = request.postDataJSON();
      mustChangePassword = false;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/visits")
      return route.fulfill({ json: { items: [], pagination: { ...pageMeta, total: 0 } } });
    if (path === "/tasks")
      return route.fulfill({ json: { items: [], pagination: { ...pageMeta, total: 0 } } });
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto("/app/accounts");
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole("heading", { name: "Cambia tu contraseña" })).toBeVisible();
  await page.getByLabel("Contraseña actual").fill("Temporal!123");
  await page.locator('input[name="newPassword"]').fill("Personal!456");
  await page.getByLabel("Confirma la nueva contraseña").fill("Personal!456");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(changeBody).toEqual({ currentPassword: "Temporal!123", newPassword: "Personal!456" });

  await page.goto("/change-password");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
});

test("401 concurrentes comparten refresh rotatorio y reintentan una vez", async ({ page }) => {
  let refreshes = 0;
  let oldProtectedRequests = 0;
  let rotatedProtectedRequests = 0;
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-token-ficticio-de-pruebas-123456"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") {
      refreshes += 1;
      return route.fulfill({
        status: 200,
        json: {
          ...session("MANAGER"),
          accessToken: refreshes === 1 ? "access-inicial" : "access-rotado",
          csrfToken:
            refreshes === 1
              ? "csrf-inicial-ficticio-123456789012"
              : "csrf-rotado-ficticio-123456789012",
        },
      });
    }
    if (path === "/visits" || path === "/tasks") {
      const authorization = request.headers()["authorization"];
      if (authorization === "Bearer access-inicial") {
        oldProtectedRequests += 1;
        return route.fulfill({ status: 401, json: { code: "TOKEN_EXPIRED", message: "Venció" } });
      }
      if (authorization === "Bearer access-rotado") rotatedProtectedRequests += 1;
      return route.fulfill({ json: { items: [], pagination: { ...pageMeta, total: 0 } } });
    }
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect.poll(() => refreshes).toBe(2);
  await expect.poll(() => oldProtectedRequests).toBe(2);
  await expect.poll(() => rotatedProtectedRequests).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem("vicam.csrf"))).toBe(
    "csrf-rotado-ficticio-123456789012",
  );
});

test("fallo de refresh purga y devuelve al login con sesión vencida", async ({ page }) => {
  let refreshes = 0;
  await page.addInitScript(() => {
    sessionStorage.setItem("vicam.csrf", "csrf-token-ficticio-de-pruebas-123456");
    localStorage.setItem("vicam.cache", "dato");
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") {
      refreshes += 1;
      return refreshes === 1
        ? route.fulfill({ status: 200, json: { ...session("MANAGER"), accessToken: "vencido" } })
        : route.fulfill({ status: 401, json: { code: "SESSION_EXPIRED", message: "Venció" } });
    }
    if (path === "/visits" || path === "/tasks")
      return route.fulfill({ status: 401, json: { code: "TOKEN_EXPIRED", message: "Venció" } });
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?expired=1$/);
  await expect(page.getByRole("heading", { name: "Tu sesión venció" })).toBeVisible();
  expect(await page.evaluate(() => [Object.keys(localStorage), sessionStorage.length])).toEqual([
    ["vicam.offline-channel"],
    0,
  ]);
});

test("Manager: inicio responsive, teclado, axe y evidencia", async ({ page }, testInfo) => {
  await mockApi(page, "MANAGER");
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido principal" })).toBeFocused();
  const desktop = page.viewportSize()!.width >= 1024;
  if (desktop) {
    await expect(page.locator(".vicam-sidebar")).toBeVisible();
    await expect(page.locator(".vicam-mobile-nav")).toBeHidden();
  } else {
    await expect(page.locator(".vicam-sidebar")).toBeHidden();
    await expect(page.locator(".vicam-mobile-nav")).toBeVisible();
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const path = testInfo.outputPath(`manager-inicio-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path });
  await testInfo.attach("captura-responsive", { path, contentType: "image/png" });
});

test("Manager: cuenta, visita y tarea usan rutas reales", async ({ page }) => {
  await mockApi(page, "MANAGER");
  await page.goto("/app/accounts");
  const accountName = page.getByText("Frutas Andinas");
  await expect(
    page.viewportSize()!.width >= 1024 ? accountName.first() : accountName.last(),
  ).toBeVisible();
  await page.goto(`/app/accounts/${accountId}`);
  await expect(page.getByRole("heading", { name: "Datos de contacto" })).toBeVisible();
  await expect(page.getByText("-0.180653, -78.467834")).toBeVisible();
  await expect(page.getByText("Pitahaya")).toBeVisible();
  await page.goto(`/app/visits/${visitId}`);
  await expect(page.getByRole("link", { name: "Completar" })).toBeVisible();
  await page.goto("/app/tasks");
  await expect(page.getByText("Enviar propuesta")).toBeVisible();
  await expect(page.getByText("Vencida").first()).toBeVisible();
  await page.goto("/app/audit");
  await expect(page.getByText("ACCOUNT_CREATED")).toBeVisible();
});

test("Agenda: navegación, filas de teclado y modales de visita accesibles", async ({
  page,
}, testInfo) => {
  await mockApi(page, "MANAGER");
  let rescheduleBody: unknown;
  let cancelBody: unknown;
  await page.route(`**/api/v1/visits/${visitId}/reschedule`, async (route) => {
    rescheduleBody = route.request().postDataJSON();
    await route.fulfill({ json: { ...visit, version: 2 } });
  });
  await page.route(`**/api/v1/visits/${visitId}/cancel`, async (route) => {
    cancelBody = route.request().postDataJSON();
    await route.fulfill({ json: { ...visit, status: "CANCELLED", version: 2 } });
  });

  await page.goto("/app/agenda");
  const row = page.getByRole("link", { name: "Abrir visita de Frutas Andinas" });
  await expect(row).toBeVisible();
  await row.focus();
  await expect(row).toBeFocused();
  await expect(page.getByRole("link", { name: "Agendar cita" })).toBeVisible();
  const selectedBefore = await page
    .locator(".date-strip button[aria-pressed=true]")
    .getAttribute("aria-label");
  await page.getByRole("button", { name: /siguiente/i }).click();
  await expect
    .poll(() => page.locator(".date-strip button[aria-pressed=true]").getAttribute("aria-label"))
    .not.toBe(selectedBefore);

  await page.goto(`/app/visits/${visitId}`);
  await expect(page.getByRole("link", { name: "Regresar" })).toHaveAttribute("href", "/app/agenda");
  await page.getByRole("button", { name: "Reprogramar" }).click();
  const reschedule = page.getByRole("dialog", { name: "Reprogramar visita" });
  await expect(reschedule.getByRole("button", { name: "Cerrar diálogo" })).toBeVisible();
  await expect(reschedule.getByLabel("Nueva fecha y hora")).toHaveValue("2026-07-22T15:00");
  await reschedule.getByLabel("Motivo").fill("Cambio solicitado por el cliente");
  await reschedule.getByRole("button", { name: "Confirmar reprogramación" }).click();
  await expect
    .poll(() => rescheduleBody)
    .toMatchObject({
      reason: "Cambio solicitado por el cliente",
      scheduledAt: new Date(visit.scheduledAt).toISOString(),
      timezone: "America/Guayaquil",
      version: 1,
    });

  await page.getByRole("button", { name: "Cancelar visita" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar visita" });
  await expect(cancel.getByLabel("Motivo")).toBeFocused();
  await cancel.getByLabel("Motivo").fill("El cliente canceló");
  const screenshot = testInfo.outputPath(`agenda-visita-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("agenda-y-modal", { path: screenshot, contentType: "image/png" });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await cancel.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect.poll(() => cancelBody).toEqual({ reason: "El cliente canceló", version: 1 });

  await page.goto("/app/visits/new");
  await expect(page.getByLabel("Zona horaria")).toHaveCount(0);
  await page.goto("/app/tasks/new");
  await expect(page.getByLabel("Hora")).toHaveCount(0);
  await expect(page.getByLabel("Zona horaria")).toHaveCount(0);
});

test("Usuarios: creación y edición usan modales accesibles", async ({ page }, testInfo) => {
  await mockApi(page, "MANAGER");
  const manager = {
    ...user("MANAGER"),
    status: "ACTIVE" as const,
    lastLoginAt: null,
    createdAt: "2026-07-20T14:00:00-05:00",
  };
  let createBody: unknown;
  let editBody: unknown;
  await page.route("**/api/v1/users", async (route) => {
    if (route.request().method() === "POST") {
      createBody = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { user: manager, temporaryPassword: "Temporal!456" },
      });
    }
    return route.fulfill({ json: { items: [manager], pagination: { ...pageMeta, total: 1 } } });
  });
  await page.route(`**/api/v1/users/${manager.id}`, async (route) => {
    editBody = route.request().postDataJSON();
    await route.fulfill({ json: { ...manager, fullName: "Manager Actualizado" } });
  });
  await page.goto("/app/users");
  await page.getByRole("button", { name: "Crear usuario" }).click();
  const create = page.getByRole("dialog", { name: "Crear usuario" });
  await expect(create.getByRole("button", { name: "Cerrar diálogo" })).toBeVisible();
  await create.getByLabel("Nombre completo").fill("Supervisor Nuevo");
  await create.getByLabel("Usuario").fill("supervisor.nuevo");
  await create.getByRole("button", { name: "Crear usuario" }).click();
  await expect
    .poll(() => createBody)
    .toMatchObject({
      fullName: "Supervisor Nuevo",
      role: "SUPERVISOR",
      username: "supervisor.nuevo",
    });
  await expect(page.getByText("Temporal!456")).toBeVisible();

  const editAction =
    page.viewportSize()!.width >= 1024
      ? page.getByRole("button", { name: "Editar" }).first()
      : page.getByRole("button", { name: "Editar usuario" }).first();
  await editAction.click();
  const edit = page.getByRole("dialog", { name: "Editar usuario" });
  await edit.getByLabel("Nombre completo").fill("Manager Actualizado");
  const screenshot = testInfo.outputPath(`usuarios-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("usuarios-modal", { path: screenshot, contentType: "image/png" });
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => editBody).toMatchObject({ fullName: "Manager Actualizado" });
});

test("Supervisor: navegación y permiso directo por URL", async ({ page }) => {
  await mockApi(page, "SUPERVISOR");
  await page.goto("/app");
  await expect(page.getByText("Mi próxima visita")).toBeVisible();
  await expect(page.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
  await page.goto("/app/audit");
  await expect(page.getByRole("heading", { level: 2, name: "No tienes permiso" })).toBeVisible();
  await page.goto("/app/visits/new");
  await expect(page.getByRole("textbox", { name: "Responsable" })).toBeDisabled();
});

test("Tareas: cancelar exige motivo y usa endpoint dedicado", async ({ page }, testInfo) => {
  await mockApi(page, "SUPERVISOR");
  let cancelRequest: unknown;
  let idempotencyKey: string | undefined;
  await page.route(`**/api/v1/tasks/${taskId}/cancel`, async (route) => {
    cancelRequest = route.request().postDataJSON();
    idempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      json: { ...task, status: "CANCELLED", overdue: false, version: 2 },
    });
  });
  await page.goto("/app/tasks");
  await page.getByRole("link", { name: "Enviar propuesta", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar tarea" }).click();
  await expect(page.getByRole("dialog", { name: "Cancelar tarea" })).toBeVisible();
  const reason = page.getByRole("textbox", { name: "Motivo de cancelación" });
  await expect(reason).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cerrar diálogo" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reason).toBeFocused();
  await reason.fill("La cuenta cambió su prioridad.");
  const path = testInfo.outputPath(`cancelar-tarea-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path });
  await testInfo.attach("cancelacion-tarea", { path, contentType: "image/png" });
  await page.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect
    .poll(() => cancelRequest)
    .toEqual({
      reason: "La cuenta cambió su prioridad.",
      version: 1,
    });
  expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
});

test("Cuenta: GPS solo tras acción explícita, frutas activas e idempotencia", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__gpsRequests", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          window.__gpsRequests += 1;
          success({
            coords: { latitude: -0.180653, longitude: -78.467834 },
          } as GeolocationPosition);
        },
      },
    });
  });
  await mockApi(page, "SUPERVISOR");
  let savedBody: Record<string, unknown> | undefined;
  let savedKey: string | undefined;
  await page.route("**/api/v1/commercial-accounts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    savedBody = route.request().postDataJSON() as Record<string, unknown>;
    savedKey = route.request().headers()["idempotency-key"];
    await route.fulfill({ status: 201, json: account });
  });

  await page.goto("/app/accounts/new");
  await page.getByLabel(/Nombre visible/).fill("Nueva cuenta GPS");
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/Solo pediremos permiso al navegador/)).toBeVisible();
  expect(await page.evaluate(() => window.__gpsRequests)).toBe(0);
  await page.getByRole("button", { name: /Usar mi ubicación/ }).click();
  await expect(page.getByText("Ubicación obtenida correctamente.")).toBeVisible();
  await page.getByLabel(/Ciudad/).fill("Quito");
  await page.getByLabel("Teléfono", { exact: true }).fill("+593 2 555 0101");
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("checkbox", { name: "Pitahaya" }).check();
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect.poll(() => savedBody).toBeTruthy();
  expect(savedBody).toMatchObject({
    latitude: -0.180653,
    longitude: -78.467834,
    fruitIds: [fruitId],
    locationSource: "DEVICE",
  });
  expect(savedKey).toMatch(/^[0-9a-f-]{36}$/i);
});

test("Cuenta: Zod enlaza errores y vuelve al paso móvil inválido", async ({ page }) => {
  await mockApi(page, "SUPERVISOR");
  await page.goto("/app/accounts/new");
  await page.getByLabel(/Nombre visible/).fill("Cuenta incompleta");
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
  }
  await page.getByRole("button", { name: "Guardar cliente" }).click();

  const city = page.getByLabel("Ciudad");
  await expect(city).toBeVisible();
  await expect(city).toHaveAttribute("aria-invalid", "true");
  await expect(city).toHaveAttribute("aria-describedby", "city-error");
  await expect(page.locator("#phone-error")).toHaveText(
    "El cliente requiere teléfono o correo electrónico.",
  );
  if (page.viewportSize()!.width < 1024) await expect(page.getByText("Paso 2 de 3")).toBeVisible();
});

test("Sesión: recupera CSRF desde vicam_csrf en una pestaña nueva", async ({ context, page }) => {
  const cookieCsrf = "csrf-cookie-ficticio-de-pruebas-123456";
  await context.addCookies([
    { name: "vicam_csrf", value: cookieCsrf, url: "http://127.0.0.1:4173" },
  ]);
  await page.addInitScript(() => sessionStorage.clear());
  let refreshCsrf: string | undefined;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/refresh")) {
      refreshCsrf = route.request().headers()["x-csrf-token"];
      return route.fulfill({ status: 200, json: session("SUPERVISOR") });
    }
    if (path.endsWith("/visits"))
      return route.fulfill({ json: { items: [visit], pagination: pageMeta } });
    if (path.endsWith("/tasks"))
      return route.fulfill({ json: { items: [task], pagination: pageMeta } });
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  expect(refreshCsrf).toBe(cookieCsrf);
  expect(await page.evaluate(() => sessionStorage.getItem("vicam.csrf"))).toBe(
    "csrf-token-ficticio-de-pruebas-123456",
  );
});

test("Login: foco, credenciales y estado 429", async ({ page }) => {
  let loginAttempts = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/refresh"))
      return route.fulfill({
        status: 401,
        json: { code: "SESSION_EXPIRED", message: "Sesión vencida", requestId: "req" },
      });
    if (path.endsWith("/auth/login")) {
      loginAttempts += 1;
      return route.fulfill({
        status: 429,
        json: { code: "RATE_LIMITED", message: "Espera", requestId: "req-429" },
      });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Usuario" }).fill("supervisor");
  await page.locator('input[name="password"]').fill("Prueba!123");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Espera requerida" })).toBeVisible();
  expect(loginAttempts).toBe(1);
});
