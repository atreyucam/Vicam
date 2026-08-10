import { expect, test, type Page } from "@playwright/test";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} es obligatorio para la suite full-stack.`);
  return value;
}

async function login(page: Page) {
  await page.goto("/login");
  const username = page.getByRole("textbox", { name: "Usuario" });
  await username.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (!(await username.isVisible())) {
    await expect(page).toHaveURL(/\/app$/);
    return;
  }
  await username.fill(required("VICAM_FULLSTACK_MANAGER_USERNAME"));
  await page.locator('input[name="password"]').fill(required("VICAM_FULLSTACK_MANAGER_PASSWORD"));
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
}

async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

test("Fases 2 a 4 atraviesan PWA, Caddy, API, worker, ClamAV y PostgreSQL reales", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  let authorization = "";
  page.on("request", (request) => {
    authorization = request.headers().authorization ?? authorization;
  });
  await login(page);
  expect((await page.request.get("/api/v1/health/ready")).status()).toBe(200);

  await page.goto("/app/sync");
  await expect(page.getByRole("heading", { name: "Configurar acceso offline" })).toBeVisible();
  await page.getByLabel("PIN de seis dígitos").fill("482615");
  await page.getByLabel("Confirma el PIN").fill("482615");
  await page.getByRole("button", { name: "Activar acceso offline" }).click();
  await expect(page.getByRole("heading", { name: "Operaciones locales" })).toBeVisible();
  await page.getByRole("button", { name: "Sincronizar ahora" }).click();
  await expect(page.getByText(/Última sync:/)).toBeVisible();

  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Desbloquea tus datos offline" })).toBeVisible();
  await page.getByLabel("PIN de seis dígitos").fill("482615");
  await page.getByRole("button", { name: "Desbloquear" }).click();
  await page.getByRole("link", { name: "Clientes" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver detalle" }).first()).toBeVisible();
  const accountHref = await page
    .getByRole("link", { name: "Ver detalle" })
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  expect(accountHref).toBeTruthy();
  await context.setOffline(false);

  await login(page);
  await navigate(page, accountHref!);
  const accountId = accountHref!.split("/").at(-1);
  expect(accountId).toBeTruthy();
  await navigate(page, `/app/documents?accountId=${accountId}`);
  const documentName = `fullstack-${testInfo.project.name}-${Date.now()}.pdf`;
  await page.getByLabel("Archivo").setInputFiles({
    name: documentName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nVICAM full-stack antivirus smoke\n%%EOF"),
  });
  await page.getByLabel("Categoría").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Enviar a análisis" }).click();
  await expect(page.getByText(documentName)).toBeVisible();

  await navigate(page, "/app/reports");
  await page.getByRole("button", { name: /Clientes/ }).click();
  await page.getByRole("button", { name: /Solicitar exportación/ }).click();
  await expect(page.getByText(/enviada a la cola/i)).toBeVisible();
  let reportId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/reports/exports?page=1&pageSize=20", {
          headers: { authorization },
        });
        expect(response.ok()).toBeTruthy();
        const body = (await response.json()) as {
          items: Array<{ id: string; status: string; format: string }>;
        };
        reportId = body.items[0]?.id ?? "";
        return body.items[0]?.status;
      },
      { timeout: 75_000 },
    )
    .toBe("AVAILABLE");
  const reportDownload = await page.request.get(`/api/v1/reports/exports/${reportId}/download`, {
    headers: { authorization },
  });
  expect(reportDownload.status()).toBe(200);
  expect(reportDownload.headers()["content-type"]).toContain("application/pdf");
  expect((await reportDownload.body()).subarray(0, 4).toString()).toBe("%PDF");

  const unique = `${testInfo.project.name}-${Date.now()}`;
  const csv = [
    "displayName,accountType,ownerUserId,countryCode,city,phone",
    `Cuenta Fullstack ${unique},COMPANY,00000000-0000-4000-8000-000000000002,EC,Quito,+59329990001`,
  ].join("\n");
  await navigate(page, "/app/imports");
  await page.getByLabel("Archivo de importación").setInputFiles({
    name: `fullstack-${unique}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/imports",
  );
  await page.getByRole("button", { name: "Validar archivo" }).click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok()).toBeTruthy();
  const batchId = ((await uploadResponse.json()) as { id: string }).id;
  let confirmationId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/imports/${batchId}`, {
          headers: { authorization },
        });
        expect(response.ok()).toBeTruthy();
        const body = (await response.json()) as { status: string; confirmationId?: string };
        confirmationId = body.confirmationId ?? confirmationId;
        return body.status;
      },
      { timeout: 75_000 },
    )
    .toBe("READY");
  await navigate(page, `/app/imports?batchId=${batchId}`);
  const refreshImport = page.getByRole("button", { name: "Actualizar estado" });
  if (await refreshImport.isVisible()) await refreshImport.click();
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeVisible();
  const confirmRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && /\/api\/v1\/imports\/[^/]+\/confirm$/.test(request.url()),
  );
  const confirmResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/imports\/[^/]+\/confirm$/.test(response.url()),
  );
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  const confirmRequest = await confirmRequestPromise;
  const confirmResponse = await confirmResponsePromise;
  expect(confirmResponse.ok()).toBeTruthy();
  const confirmHeaders = confirmRequest.headers();
  expect(confirmHeaders.authorization).toBeTruthy();
  expect(confirmHeaders["x-csrf-token"]).toBeTruthy();
  expect(confirmHeaders["idempotency-key"]).toBeTruthy();
  expect(confirmationId).toBeTruthy();

  const retryResponse = await page.request.post(confirmRequest.url(), {
    data: { confirmationId },
    headers: {
      authorization: confirmHeaders.authorization!,
      "x-csrf-token": confirmHeaders["x-csrf-token"]!,
      "idempotency-key": confirmHeaders["idempotency-key"]!,
      origin: new URL(confirmRequest.url()).origin,
    },
  });
  expect(retryResponse.status(), await retryResponse.text()).toBe(confirmResponse.status());

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/imports/${batchId}`, {
          headers: { authorization },
        });
        expect(response.ok()).toBeTruthy();
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 75_000 },
    )
    .toBe("COMPLETED");
  const persisted = await page.request.get(
    `/api/v1/commercial-accounts?page=1&pageSize=20&search=${encodeURIComponent(`Cuenta Fullstack ${unique}`)}`,
    { headers: { authorization } },
  );
  expect(persisted.ok()).toBeTruthy();
  expect(((await persisted.json()) as { pagination: { total: number } }).pagination.total).toBe(1);
});
