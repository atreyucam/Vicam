import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const managerId = "019b3e83-7a28-7000-8000-000000000001";
const deviceId = "019b3e83-7a28-7000-8000-000000000901";
const testStartedAt = Date.now();
const now = new Date(testStartedAt).toISOString();
const expires = new Date(testStartedAt + 72 * 60 * 60 * 1000).toISOString();
const accountId = "019b3e83-7a28-7000-8000-000000000101";
const fruitId = "019b3e83-7a28-7000-8000-000000000801";

const session = {
  accessToken: "access-offline-ficticio",
  accessTokenExpiresAt: new Date(testStartedAt + 60 * 60 * 1000).toISOString(),
  csrfToken: "csrf-offline-ficticio-123456789012",
  user: {
    id: managerId,
    username: "manager",
    fullName: "María Manager",
    role: "MANAGER",
    timezone: "America/Guayaquil",
    mustChangePassword: false,
  },
};

async function mockPhase2(page: Page, delayPull = 0) {
  await page.addInitScript(() =>
    sessionStorage.setItem("vicam.csrf", "csrf-offline-ficticio-123456789012"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh") return route.fulfill({ json: session });
    if (path === "/devices" && route.request().method() === "POST")
      return route.fulfill({
        status: 201,
        json: {
          id: deviceId,
          name: "PWA VICAM",
          platform: "Playwright",
          status: "ACTIVE",
          lastSeenAt: now,
        },
      });
    if (path === "/auth/offline-grants")
      return route.fulfill({
        status: 201,
        json: {
          id: crypto.randomUUID(),
          deviceId,
          issuedAt: now,
          expiresAt: expires,
          grantToken: "grant-token-ficticio-de-al-menos-32-caracteres",
        },
      });
    if (path === "/sync/pull") {
      if (delayPull) await new Promise((resolve) => setTimeout(resolve, delayPull));
      return route.fulfill({
        json: {
          changes: [],
          nextCursor: "1",
          hasMore: false,
          purgeAccountIds: [],
          serverTime: now,
          grantExpiresAt: expires,
          deviceRevoked: false,
        },
      });
    }
    if (path === "/sync/conflicts") return route.fulfill({ json: [] });
    if (path === "/fruits")
      return route.fulfill({ json: [{ id: fruitId, name: "Pitahaya", active: true }] });
    if (path === "/visits" || path === "/tasks")
      return route.fulfill({
        json: { items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
      });
    return route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "No encontrado", requestId: "req-phase2" },
    });
  });
}

async function activateOffline(page: Page) {
  await page.goto("/app/sync");
  await expect(page.getByRole("heading", { name: "Configurar acceso offline" })).toBeVisible();
  await page.getByLabel("PIN de seis dígitos").fill("123456");
  await page.getByLabel("Confirma el PIN").fill("123456");
  await page.getByRole("button", { name: "Activar acceso offline" }).click();
  await expect(page.getByRole("heading", { name: "Operaciones locales" })).toBeVisible();
}

async function offlineDatabaseExists(page: Page) {
  return page.evaluate(async () =>
    (await indexedDB.databases()).some((database) => database.name === "vicam-offline-v1"),
  );
}

async function offlineSensitiveRecordCount(page: Page) {
  if (!(await offlineDatabaseExists(page))) return 0;
  return page.evaluate(async () => {
    const request = indexedDB.open("vicam-offline-v1");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    });
    const names = ["auth", "entities", "operations", "conflicts"].filter((name) =>
      database.objectStoreNames.contains(name),
    );
    const counts = await Promise.all(
      names.map(
        (name) =>
          new Promise<number>((resolve, reject) => {
            const count = database.transaction(name).objectStore(name).count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error ?? new Error("No se pudo contar IndexedDB"));
          }),
      ),
    );
    database.close();
    return counts.reduce((total, count) => total + count, 0);
  });
}

async function offlineCatalogCount(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("vicam-offline-v1");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    });
    const count = await new Promise<number>((resolve, reject) => {
      const result = database.transaction("catalogs").objectStore("catalogs").count();
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error ?? new Error("No se pudo contar el catálogo"));
    });
    database.close();
    return count;
  });
}

async function ensureServiceWorkerControl(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))) return;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
    });
  }
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
}

test("PIN cifra autorización, persiste al reiniciar y desbloquea offline", async ({
  context,
  page,
}) => {
  await mockPhase2(page);
  await activateOffline(page);
  const persisted = await page.evaluate(async () => {
    const request = indexedDB.open("vicam-offline-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    });
    const record = await new Promise<unknown>((resolve, reject) => {
      const get = db.transaction("auth").objectStore("auth").get("authorization");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error ?? new Error("No se pudo leer IndexedDB"));
    });
    db.close();
    return JSON.stringify(record);
  });
  expect(persisted).not.toContain("123456");
  expect(persisted).not.toContain("grant-token-ficticio");
  expect(persisted).toContain("PBKDF2-SHA-256");

  await ensureServiceWorkerControl(page);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Desbloquea tus datos offline" })).toBeVisible();
  await page.getByLabel("PIN de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Desbloquear" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
});

test("dos pestañas serializan la sincronización y la vista pasa axe", async ({
  context,
  page,
}, testInfo) => {
  let activePulls = 0;
  let maximumPulls = 0;
  await mockPhase2(page, 150);
  await page.route("**/api/v1/sync/pull**", async (route) => {
    activePulls += 1;
    maximumPulls = Math.max(maximumPulls, activePulls);
    await new Promise((resolve) => setTimeout(resolve, 150));
    activePulls -= 1;
    await route.fulfill({
      json: {
        changes: [],
        nextCursor: "2",
        hasMore: false,
        purgeAccountIds: [],
        serverTime: now,
        grantExpiresAt: expires,
        deviceRevoked: false,
      },
    });
  });
  await activateOffline(page);
  const second = await context.newPage();
  await mockPhase2(second, 150);
  await second.goto("/app/sync");
  await second.getByLabel("PIN de seis dígitos").fill("123456");
  await second.getByRole("button", { name: "Desbloquear y sincronizar" }).click();
  await expect(second.getByRole("heading", { name: "Operaciones locales" })).toBeVisible();
  maximumPulls = 0;
  await Promise.all([
    page.getByRole("button", { name: "Sincronizar ahora" }).click(),
    second.getByRole("button", { name: "Sincronizar ahora" }).click(),
  ]);
  await expect.poll(() => activePulls).toBe(0);
  expect(maximumPulls).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const screenshot = testInfo.outputPath(`sync-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("centro-sync-responsive", { path: screenshot, contentType: "image/png" });
});

test("service worker no guarda API, auth, descargas ni documentos", async ({ page }) => {
  await mockPhase2(page);
  await page.goto("/app");
  await page.evaluate(async () => {
    await fetch("/api/v1/auth/refresh", { method: "POST" }).catch(() => undefined);
    await fetch("/api/v1/documents/ficticio/download").catch(() => undefined);
  });
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    return urls;
  });
  const forbiddenCachedUrls = cachedUrls.filter((url) => {
    const { pathname } = new URL(url);
    return (
      /\/api(?:\/|$)/.test(pathname) ||
      /(?:^|\/)(?:auth|documents?|downloads?)(?:\/|$)/i.test(pathname)
    );
  });
  expect(forbiddenCachedUrls).toEqual([]);
});

test("cinco PIN incorrectos purgan la bóveda local", async ({ context, page }) => {
  await mockPhase2(page);
  await activateOffline(page);
  await ensureServiceWorkerControl(page);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.getByLabel("PIN de seis dígitos").fill("000000");
    await page.getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByRole("heading", { name: "No se pudo desbloquear" })).toBeVisible();
  }
  await expect(page.getByText(/se alcanzaron cinco intentos/i)).toBeVisible();
  await expect.poll(() => offlineDatabaseExists(page)).toBe(false);
});

test("expirar 72 horas purga la bóveda local", async ({ page }) => {
  await mockPhase2(page);
  await activateOffline(page);
  await page.evaluate(async () => {
    const request = indexedDB.open("vicam-offline-v1");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("auth", "readwrite");
      const store = transaction.objectStore("auth");
      const get = store.get("authorization");
      get.onsuccess = () =>
        store.put({ ...get.result, grantExpiresAt: "2020-01-01T00:00:00.000Z" });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("No se pudo actualizar IndexedDB"));
    });
    database.close();
  });
  const synchronize = page.getByRole("button", { name: "Sincronizar ahora" });
  if (await synchronize.isVisible().catch(() => false)) await synchronize.click();
  await expect.poll(() => offlineSensitiveRecordCount(page), { timeout: 15_000 }).toBe(0);
});

test("logout purga IndexedDB, caches y claves locales", async ({ page }) => {
  await mockPhase2(page);
  await activateOffline(page);
  await page.goto("/app/more");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => offlineSensitiveRecordCount(page)).toBe(0);
  expect(
    await page.evaluate(() => ({
      keys: Object.keys(localStorage),
      channel: localStorage.getItem("vicam.offline-channel"),
    })),
  ).toEqual({ keys: ["vicam.offline-channel"], channel: expect.any(String) });
});

test("logout purga y bloquea también una segunda pestaña", async ({ context, page }) => {
  test.setTimeout(60_000);
  await mockPhase2(page);
  await activateOffline(page);
  const second = await context.newPage();
  await mockPhase2(second);
  await second.goto("/app/sync");
  await second.getByLabel("PIN de seis dígitos").fill("123456");
  await second.getByRole("button", { name: "Desbloquear y sincronizar" }).click();
  await expect(second.getByRole("heading", { name: "Operaciones locales" })).toBeVisible();
  await page.goto("/app/more");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(second).toHaveURL(/\/login$/);
  await expect.poll(() => offlineSensitiveRecordCount(second)).toBe(0);
  expect(await second.evaluate(() => Object.keys(localStorage))).toEqual(["vicam.offline-channel"]);

  await second.reload();
  await activateOffline(page);
  const third = await context.newPage();
  await mockPhase2(third);
  await third.goto("/app/sync");
  await third.getByLabel("PIN de seis dígitos").fill("123456");
  await third.getByRole("button", { name: "Desbloquear y sincronizar" }).click();
  await expect(third.getByRole("heading", { name: "Operaciones locales" })).toBeVisible();
  await third.goto("/app/more");
  await third.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => offlineSensitiveRecordCount(page)).toBe(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["vicam.offline-channel"]);
});

test("revocación del dispositivo purga al siguiente contacto", async ({ page }) => {
  await mockPhase2(page);
  await activateOffline(page);
  await page.route("**/api/v1/sync/pull**", (route) =>
    route.fulfill({
      json: {
        changes: [],
        nextCursor: "2",
        hasMore: false,
        purgeAccountIds: [],
        serverTime: now,
        grantExpiresAt: expires,
        deviceRevoked: true,
      },
    }),
  );
  const synchronize = page.getByRole("button", { name: "Sincronizar ahora" });
  await expect
    .poll(
      async () =>
        (await offlineSensitiveRecordCount(page)) === 0 ||
        (await synchronize.isVisible().catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);
  if ((await offlineSensitiveRecordCount(page)) > 0) await synchronize.click();
  await expect.poll(() => offlineSensitiveRecordCount(page), { timeout: 15_000 }).toBe(0);
});

test("flujo obligatorio offline cuenta, cierre de visita y tarea relacionada conserva dependencias", async ({
  context,
  page,
}, testInfo) => {
  await mockPhase2(page);
  let grantHeader = "";
  await page.route("**/api/v1/sync/pull**", async (route) => {
    grantHeader = route.request().headers()["x-offline-grant"] ?? "";
    await route.fulfill({
      json: {
        changes: [
          {
            cursor: "1",
            entityType: "ACCOUNT",
            entityId: accountId,
            operation: "UPSERT",
            version: 2,
            data: {
              id: accountId,
              displayName: "Distribuidora Sierra",
              legalName: null,
              accountType: "DISTRIBUTOR",
              ownerUserId: managerId,
              countryCode: "EC",
              stateProvince: "Pichincha",
              city: "Quito",
              address: null,
              postalCode: null,
              phone: "0999999999",
              email: null,
              timezone: "America/Guayaquil",
              latitude: null,
              longitude: null,
              locationSource: null,
              locationCapturedAt: null,
              status: "ACTIVE",
              version: 2,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
        nextCursor: "1",
        hasMore: false,
        purgeAccountIds: [],
        serverTime: now,
        grantExpiresAt: expires,
        deviceRevoked: false,
      },
    });
  });
  await activateOffline(page);
  await page.getByRole("button", { name: "Sincronizar ahora" }).click();
  await expect.poll(() => grantHeader).toBe("grant-token-ficticio-de-al-menos-32-caracteres");
  await expect.poll(() => offlineCatalogCount(page)).toBe(1);

  await context.setOffline(true);
  await page.getByRole("link", { name: "Clientes" }).first().click();
  await expect(page.getByText("Distribuidora Sierra").filter({ visible: true })).toBeVisible();
  await page.getByRole("link", { name: "Ver detalle" }).filter({ visible: true }).click();
  await expect(page.getByText(/Responsable asignado/).filter({ visible: true })).toBeVisible();
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/accounts/${accountId}/edit$`));
  await expect(page.getByLabel("Nombre visible")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continuar" }).filter({ visible: true });
  const city = page.getByLabel("Ciudad");
  if (!(await city.isVisible())) await continueButton.click();
  await city.fill("Loja");
  const pitahaya = page.getByRole("checkbox", { name: "Pitahaya" });
  if (!(await pitahaya.isVisible())) await continueButton.click();
  await expect(pitahaya).toBeVisible();
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/accounts/${accountId}$`), { timeout: 15_000 });
  await expect(page.getByText(/Loja, EC/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Agendar visita" }).click();
  await page.getByLabel("Responsable").selectOption(managerId);
  await page.getByLabel("Fecha y hora").fill("2026-07-23T10:00");
  await page.getByLabel("Motivo").fill("Revisión de temporada");
  await page.getByRole("button", { name: "Agendar cita" }).click();
  await expect(page.getByText("Pendiente de sincronizar")).toBeVisible();

  await page.getByRole("link", { name: "Completar" }).click();
  await page.getByLabel("Resultado de la visita").selectOption("PROPOSAL_REQUESTED");
  await page.getByLabel("Observación / resumen").fill("Visita completada sin conexión");
  await page.getByRole("checkbox", { name: "Crear tarea de seguimiento" }).check();
  await page.getByLabel("Título").fill("Enviar propuesta comercial");
  await page.getByLabel("Fecha de vencimiento").fill("2026-07-25");
  await page.getByRole("button", { name: "Guardar visita" }).click();
  await expect(page.getByText("Enviar propuesta comercial")).toBeVisible();
  await expect(page.getByText("Pendiente de sincronizar")).toBeVisible();

  const operations = await page.evaluate(async () => {
    const request = indexedDB.open("vicam-offline-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    });
    const rows = await new Promise<
      Array<{
        action: string;
        changedFields: string[];
        clientOperationId: string;
        dependsOn: string[];
        entityType: string;
      }>
    >((resolve, reject) => {
      const get = db.transaction("operations").objectStore("operations").getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error ?? new Error("No se pudieron leer las operaciones"));
    });
    db.close();
    return rows.sort((left, right) => left.action.localeCompare(right.action));
  });
  expect(operations).toHaveLength(3);
  const accountUpdate = operations.find(
    (operation) => operation.entityType === "ACCOUNT" && operation.action === "UPDATE",
  )!;
  const visitCreate = operations.find(
    (operation) => operation.entityType === "VISIT" && operation.action === "CREATE",
  )!;
  const visitComplete = operations.find((operation) => operation.action === "COMPLETE")!;
  expect(visitComplete.dependsOn).toContain(visitCreate.clientOperationId);
  expect(accountUpdate.changedFields).toEqual(["city"]);
  expect(visitComplete.changedFields).toEqual(
    expect.arrayContaining(["status", "result", "observation"]),
  );

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const screenshot = testInfo.outputPath(`mandatory-offline-${testInfo.project.name}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach("flujo-offline-obligatorio", {
    path: screenshot,
    contentType: "image/png",
  });
});
