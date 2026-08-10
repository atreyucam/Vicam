import { expect, test, type Page } from "@playwright/test";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} es obligatorio para la suite full-stack.`);
  return value;
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Usuario" }).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
}

async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function selectFirstRealOption(page: Page, name: string) {
  const select = page.locator(`select[name="${name}"]`);
  const selected = await select.selectOption({ index: 1 });
  if (!selected[0]) throw new Error(`No hay una opción disponible para ${name}.`);
}

async function continueCompactAccountForm(page: Page) {
  const continueButton = page.getByRole("button", { name: "Continuar" });
  if (await continueButton.isVisible()) await continueButton.click();
}

async function createTask(page: Page, accountName: string, title: string, dueDate: string) {
  await navigate(page, "/app/tasks/new");
  await page.locator('select[name="accountId"]').selectOption({ label: accountName });
  await page.locator('input[name="title"]').fill(title);
  await selectFirstRealOption(page, "responsibleUserId");
  await page.locator('input[name="dueDate"]').fill(dueDate);
  await page.getByRole("button", { name: "Guardar tarea" }).click();
  await page.waitForURL(/\/app\/tasks$/);
}

test("Fase 1 atraviesa Caddy, API y Postgres con permisos reales", async ({
  browser,
}, testInfo) => {
  const managerUsername = required("VICAM_FULLSTACK_MANAGER_USERNAME");
  const managerPassword = required("VICAM_FULLSTACK_MANAGER_PASSWORD");
  const supervisorUsername = required("VICAM_FULLSTACK_SUPERVISOR_USERNAME");
  const supervisorPassword = required("VICAM_FULLSTACK_SUPERVISOR_PASSWORD");
  const baseURL = required("VICAM_FULLSTACK_BASE_URL");
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const accountName = `Cuenta E2E ${suffix}`;
  const contactName = `Contacto E2E ${suffix}`;
  const visitReason = `Visita E2E ${suffix}`;
  const completedTask = `Tarea completar ${suffix}`;
  const cancelledTask = `Tarea cancelar ${suffix}`;
  const viewport = testInfo.project.use.viewport ?? null;
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();

  await login(page, managerUsername, managerPassword);
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await page.getByRole("link", { name: "Nuevo cliente", exact: true }).click();
  await page.getByLabel("Nombre visible").fill(accountName);
  await continueCompactAccountForm(page);
  await page.getByLabel("Ciudad").fill("Quito");
  await page.getByLabel("Correo electrónico").fill(`e2e-${Date.now()}@example.test`);
  await continueCompactAccountForm(page);
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await page.waitForURL(
    (url) => /^\/app\/accounts\/[^/]+$/.test(url.pathname) && url.pathname !== "/app/accounts/new",
  );
  const accountId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.getByRole("button", { name: "Agregar contacto" }).click();
  await page.getByLabel("Nombre completo").fill(contactName);
  await page.getByLabel("Correo", { exact: true }).fill(`contacto-${Date.now()}@example.test`);
  await page.getByLabel("Contacto principal").check();
  await page.getByRole("button", { name: "Guardar contacto" }).click();
  await expect(page.getByText(contactName)).toBeVisible();

  await navigate(page, `/app/visits/new?accountId=${accountId}`);
  await expect(page.locator('select[name="accountId"]')).toHaveValue(accountId);
  await selectFirstRealOption(page, "responsibleUserId");
  const scheduled = new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Fecha y hora").fill(scheduled);
  await page.getByLabel("Motivo").fill(visitReason);
  await page.getByRole("button", { name: "Agendar cita" }).click();
  await page.waitForURL(
    (url) => /^\/app\/visits\/[^/]+$/.test(url.pathname) && url.pathname !== "/app/visits/new",
  );
  await page.getByRole("button", { name: "Reprogramar" }).click();
  const rescheduleDialog = page.getByRole("dialog", { name: "Reprogramar visita" });
  const rescheduled = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 16);
  await rescheduleDialog.getByLabel("Nueva fecha y hora").fill(rescheduled);
  await rescheduleDialog.getByLabel("Motivo").fill(`Reprogramación E2E ${suffix}`);
  await rescheduleDialog.getByRole("button", { name: "Confirmar reprogramación" }).click();
  await expect(rescheduleDialog).toBeHidden();
  await page.getByRole("link", { name: "Completar" }).click();
  await page.getByLabel("Observación").fill(`Cierre real ${suffix}`);
  await page.getByRole("button", { name: "Guardar visita" }).click();
  await expect(page.getByText("Completada", { exact: true }).first()).toBeVisible();

  await navigate(page, `/app/visits/new?accountId=${accountId}`);
  await selectFirstRealOption(page, "responsibleUserId");
  const cancellableScheduled = new Date(Date.now() + 3 * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Fecha y hora").fill(cancellableScheduled);
  await page.getByLabel("Motivo").fill(`Visita cancelable ${suffix}`);
  await page.getByRole("button", { name: "Agendar cita" }).click();
  await page.waitForURL(
    (url) => /^\/app\/visits\/[^/]+$/.test(url.pathname) && url.pathname !== "/app/visits/new",
  );
  await page.getByRole("button", { name: "Cancelar visita" }).click();
  const cancelVisitDialog = page.getByRole("dialog", { name: "Cancelar visita" });
  await cancelVisitDialog.getByLabel("Motivo").fill(`Cancelación de visita E2E ${suffix}`);
  await cancelVisitDialog.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(cancelVisitDialog).toBeHidden();
  await expect(page.getByText("Cancelada", { exact: true }).first()).toBeVisible();

  const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  await createTask(page, accountName, completedTask, dueDate);
  let taskCard = page.locator(".task-card").filter({ hasText: completedTask });
  await taskCard.getByRole("button", { name: "Completar" }).click();
  await expect(taskCard.getByText("Completada", { exact: true })).toBeVisible();

  await createTask(page, accountName, cancelledTask, dueDate);
  taskCard = page.locator(".task-card").filter({ hasText: cancelledTask });
  await taskCard.getByRole("button", { name: "Cancelar tarea" }).click();
  await page.getByLabel("Motivo de cancelación").fill(`Cancelación E2E ${suffix}`);
  await page.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(taskCard.getByText("Cancelada", { exact: true })).toBeVisible();

  await navigate(page, "/app/audit");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("VISIT_RESCHEDULED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("VISIT_CANCELLED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("VISIT_COMPLETED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("TASK_COMPLETED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("TASK_CANCELLED", { exact: true }).first()).toBeVisible();
  await context.close();

  const supervisorContext = await browser.newContext({ baseURL, viewport });
  const supervisorPage = await supervisorContext.newPage();
  await login(supervisorPage, supervisorUsername, supervisorPassword);
  await navigate(supervisorPage, `/app/accounts/${accountId}`);
  await expect(
    supervisorPage.getByRole("heading", { name: "Recurso no disponible" }),
  ).toBeVisible();
  await supervisorContext.close();
});
