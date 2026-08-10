import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccountDetailPage, AccountFormPage, accountChangedFields } from "./AccountsPages";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
const fruitId = "019b3e83-7a28-7000-8000-000000000801";
const userId = "019b3e83-7a28-7000-8000-000000000002";

vi.mock("../api/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/api")>();
  return { ...original, api: { GET: mocks.get, PATCH: mocks.patch, POST: mocks.post } };
});
vi.mock("../offline/catalogs", () => ({
  loadActiveFruits: () => Promise.resolve([{ id: fruitId, name: "Pitahaya" }]),
}));
vi.mock("../app/session", () => ({
  useSession: () => ({
    user: {
      id: userId,
      fullName: "Sofía Supervisor",
      role: "SUPERVISOR",
      timezone: "America/Guayaquil",
    },
  }),
}));
vi.mock("../components/MapLibreField", () => ({
  MapLibreField: () => <div>Mapa del cliente</div>,
}));

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("cuenta: GPS explícito y frutas activas", () => {
  let success: PositionCallback;
  let failure: PositionErrorCallback;
  const getCurrentPosition = vi.fn(
    (nextSuccess: PositionCallback, nextFailure: PositionErrorCallback) => {
      success = nextSuccess;
      failure = nextFailure;
    },
  );

  beforeEach(() => {
    mocks.post.mockReset();
    getCurrentPosition.mockClear();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    mocks.post.mockResolvedValue({
      data: { id: "019b3e83-7a28-7000-8000-000000000101" },
      response: new Response(null, { status: 201 }),
    });
  });

  function renderAccount() {
    return renderWithQuery(<AccountFormPage />);
  }

  it("explica antes del prompt, captura/limpia coordenadas y envía frutas con clave estable", async () => {
    const { container } = renderAccount();
    await screen.findByRole("textbox", { name: /Nombre visible/ });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByText(/Solo pediremos permiso al navegador/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    success({ coords: { latitude: -0.180653, longitude: -78.467834 } } as GeolocationPosition);
    expect(await screen.findByText("Ubicación obtenida correctamente.")).toBeVisible();
    expect(screen.getByText(/Latitud -0.180653/)).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: /Nombre visible/ }), {
      target: { value: "Frutas Andinas" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Ciudad/ }), {
      target: { value: "Quito" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Teléfono$/ }), {
      target: { value: "+593 2 555 0101" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Pitahaya" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    const options = mocks.post.mock.calls[0]![1] as {
      body: Record<string, unknown>;
      params: { header: { "idempotency-key": string } };
    };
    expect(options.params.header["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(options.body).toMatchObject({
      fruitIds: [fruitId],
      latitude: -0.180653,
      longitude: -78.467834,
      locationSource: "DEVICE",
    });

    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  }, 15_000);

  it("distingue permiso denegado y permite continuar o volver a intentar", async () => {
    renderAccount();
    await screen.findByRole("textbox", { name: /Nombre visible/ });
    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    failure({
      code: 1,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);
    expect(await screen.findByText(/Permiso denegado/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Usar mi ubicación/ })).toBeEnabled();
  });

  it("oculta la zona y crea el contacto principal dentro del mismo flujo", async () => {
    const accountId = "019b3e83-7a28-7000-8000-000000000101";
    mocks.post.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/commercial-accounts"
            ? { id: accountId }
            : {
                id: "019b3e83-7a28-7000-8000-000000000111",
                accountId,
                fullName: "Ana Pérez",
                isPrimary: true,
                version: 1,
              },
        response: new Response(null, { status: 201 }),
      }),
    );
    renderAccount();
    await screen.findByRole("textbox", { name: /Nombre visible/ });
    expect(screen.queryByLabelText("Zona horaria")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Nombre visible/ }), {
      target: { value: "Frutas Andinas" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Ciudad/ }), {
      target: { value: "Quito" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Teléfono$/ }), {
      target: { value: "+593 2 555 0101" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del contacto" }), {
      target: { value: "Ana Pérez" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Correo del contacto" }), {
      target: { value: "ana@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/commercial-accounts");
    expect(mocks.post.mock.calls[1]?.[0]).toBe("/commercial-accounts/{id}/contacts");
    expect(mocks.post.mock.calls[1]?.[1]).toMatchObject({
      body: { fullName: "Ana Pérez", email: "ana@example.test", isPrimary: true },
      params: { path: { id: accountId } },
    });
  });

  it("quita una ubicación obtenida sin volver a solicitar permiso", async () => {
    renderAccount();
    await screen.findByRole("textbox", { name: /Nombre visible/ });
    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    success({ coords: { latitude: -0.1, longitude: -78.5 } } as GeolocationPosition);
    fireEvent.click(await screen.findByRole("button", { name: "Quitar ubicación" }));
    expect(screen.queryByText(/Latitud -0.100000/)).not.toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("asocia errores Zod al campo y vuelve al paso móvil inválido", async () => {
    renderAccount();
    await screen.findByRole("textbox", { name: /Nombre visible/ });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));

    const displayName = await screen.findByRole("textbox", { name: /Nombre visible/ });
    expect(screen.getByText("Paso 1 de 3")).toBeVisible();
    expect(displayName).toHaveAttribute("aria-invalid", "true");
    expect(displayName).toHaveAttribute("aria-describedby", "displayName-error");
    expect(screen.getByText("Revisa la información")).toBeVisible();
  });
});

describe("delta de edición offline", () => {
  it("declara solo el campo local y permite merge disjunto con el cambio servidor", () => {
    const base = {
      displayName: "Cuenta original",
      legalName: null,
      accountType: "DISTRIBUTOR",
      ownerUserId: userId,
      countryCode: "EC",
      stateProvince: null,
      city: "Quito",
      address: null,
      postalCode: null,
      phone: "+593 2 555 0101",
      email: null,
      timezone: "America/Guayaquil",
      latitude: null,
      longitude: null,
      locationSource: null,
      locationCapturedAt: null,
      fruitIds: [fruitId],
    };
    const local = { ...base, displayName: "Cuenta local" };

    expect(accountChangedFields(local, base)).toEqual(["displayName"]);
    expect(accountChangedFields(local)).toHaveLength(Object.keys(local).length);
  });
});

describe("perfil comercial del cliente", () => {
  const accountId = "019b3e83-7a28-7000-8000-000000000101";
  const visitId = "019b3e83-7a28-7000-8000-000000000201";
  const taskId = "019b3e83-7a28-7000-8000-000000000301";
  const account = {
    id: accountId,
    displayName: "Frutícola Andina",
    legalName: null,
    accountType: "Distribuidor",
    ownerUserId: userId,
    ownerFullName: "Sofía Supervisor",
    countryCode: "EC",
    stateProvince: "Tungurahua",
    city: "Ambato",
    address: "Av. Principal",
    postalCode: null,
    phone: "+593 99 612 6404",
    email: "compras@fruticola.test",
    timezone: "America/Guayaquil",
    latitude: -1.24908,
    longitude: -78.61675,
    locationSource: "MANUAL",
    locationCapturedAt: "2026-08-01T12:00:00.000Z",
    primaryContactName: "Ana Pérez",
    fruits: [{ id: fruitId, name: "Banano" }],
    status: "ACTIVE",
    version: 1,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
  const contacts = [
    {
      id: "019b3e83-7a28-7000-8000-000000000111",
      accountId,
      fullName: "Ana Pérez",
      title: "Compras",
      phone: "+593 99 111 1111",
      email: "ana@fruticola.test",
      notes: null,
      isPrimary: true,
      version: 1,
    },
  ];

  beforeEach(() => {
    mocks.get.mockReset();
    window.history.replaceState({}, "", `/app/accounts/${accountId}`);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  function response(data: unknown) {
    return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
  }

  function mockBase(extra: (path: string) => Promise<unknown>) {
    mocks.get.mockImplementation((path: string) => {
      if (path === "/commercial-accounts/{id}") return response(account);
      if (path === "/commercial-accounts/{id}/contacts") return response(contacts);
      return extra(path);
    });
  }

  it("mantiene encabezado y tabs, y convierte el resumen en contexto comercial", async () => {
    mockBase((path) => {
      if (path === "/commercial-accounts/{id}/commercial-summary")
        return response({
          nextVisit: {
            id: visitId,
            scheduledAt: "2026-08-12T18:51:00.000Z",
            reason: "Revisar proyección de compra",
            responsibleFullName: "Sofía Supervisor",
            priority: "HIGH",
          },
          openTaskCount: 3,
          dueTodayTaskCount: 1,
          recentActivity: [
            {
              id: `visit-created:${visitId}`,
              type: "VISIT_CREATED",
              occurredAt: "2026-08-10T14:48:00.000Z",
              title: "Visita programada",
              description: "Revisar proyección de compra",
              resourceType: "VISIT",
              resourceId: visitId,
            },
          ],
        });
      throw new Error(`GET inesperado: ${path}`);
    });

    const { container } = renderWithQuery(<AccountDetailPage accountId={accountId} />);

    expect(await screen.findByText("Frutícola Andina")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Secciones del cliente" })).toHaveTextContent(
      "ResumenVisitasTareasContactosDocumentos",
    );
    expect(screen.getByRole("link", { name: "Agendar visita" })).toHaveAttribute(
      "href",
      `/app/visits/new?accountId=${accountId}`,
    );
    expect(screen.getByRole("link", { name: "Nueva tarea" })).toHaveAttribute(
      "href",
      `/app/tasks/new?accountId=${accountId}`,
    );
    expect(await screen.findAllByText("Revisar proyección de compra")).toHaveLength(2);
    expect(screen.getByText("Visita programada")).toBeVisible();
    expect(screen.getByText("Ana Pérez")).toBeVisible();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("lista visitas y tareas filtradas por cliente sin consultas por fila", async () => {
    mockBase((path) => {
      if (path === "/visits")
        return response({
          items: [
            {
              id: visitId,
              accountId,
              accountDisplayName: account.displayName,
              responsibleUserId: userId,
              responsibleFullName: "Sofía Supervisor",
              scheduledAt: "2026-08-12T18:51:00.000Z",
              timezone: "America/Guayaquil",
              reason: "Revisar proyección de compra",
              priority: "HIGH",
              notes: null,
              status: "PENDING",
              observation: null,
              actualStartedAt: null,
              actualEndedAt: null,
              cancellationReason: null,
              result: null,
              cancelledAt: null,
              cancelledByFullName: null,
              createdAt: "2026-08-10T14:48:00.000Z",
              version: 1,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      if (path === "/tasks")
        return response({
          items: [
            {
              id: taskId,
              accountId,
              accountDisplayName: account.displayName,
              visitId,
              visitScheduledAt: "2026-08-12T18:51:00.000Z",
              visitReason: "Revisar proyección de compra",
              responsibleUserId: userId,
              responsibleFullName: "Sofía Supervisor",
              title: "Enviar propuesta comercial",
              description: null,
              dueDate: "2026-08-14",
              dueTime: null,
              timezone: "America/Guayaquil",
              priority: "HIGH",
              status: "PENDING",
              overdue: false,
              completedAt: null,
              createdAt: "2026-08-10T15:00:00.000Z",
              version: 1,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      throw new Error(`GET inesperado: ${path}`);
    });

    const view = renderWithQuery(<AccountDetailPage accountId={accountId} tab="visits" />);
    expect(
      await screen.findByRole("link", { name: "Revisar proyección de compra" }),
    ).toHaveAttribute("href", `/app/visits/${visitId}`);
    const visitsCall = mocks.get.mock.calls.find(([path]) => path === "/visits");
    expect(visitsCall?.[1]).toMatchObject({ params: { query: { accountId, pageSize: 20 } } });

    view.unmount();
    renderWithQuery(<AccountDetailPage accountId={accountId} tab="tasks" />);
    expect(await screen.findByRole("link", { name: "Enviar propuesta comercial" })).toHaveAttribute(
      "href",
      `/app/tasks/${taskId}`,
    );
    expect(screen.getByText(/Vinculada a:/)).toBeVisible();
    const tasksCall = mocks.get.mock.calls.find(([path]) => path === "/tasks");
    expect(tasksCall?.[1]).toMatchObject({ params: { query: { accountId, pageSize: 20 } } });
    expect(mocks.get).not.toHaveBeenCalledWith("/visits/{id}", expect.anything());
  });
});
