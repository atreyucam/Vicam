import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/api";
import { ReportsPage } from "./ReportsPage";

vi.mock("../app/session", () => ({
  useSession: () => ({
    user: {
      id: "019b3e83-7a28-7000-8000-000000000001",
      username: "manager",
      fullName: "María Manager",
      role: "MANAGER",
      mustChangePassword: false,
    },
  }),
}));

const accountId = "019b3e83-7a28-7000-8000-000000000101";
const userId = "019b3e83-7a28-7000-8000-000000000102";
const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };
const account = {
  id: accountId,
  displayName: "Frutas del Pacífico",
  legalName: null,
  accountType: "COMPANY",
  ownerUserId: userId,
  ownerFullName: "Juan Supervisor",
  countryCode: "EC",
  stateProvince: "Guayas",
  city: "Guayaquil",
  address: null,
  postalCode: null,
  phone: "+593999999999",
  email: null,
  timezone: "America/Guayaquil",
  latitude: null,
  longitude: null,
  locationSource: null,
  locationCapturedAt: null,
  status: "ACTIVE",
  version: 1,
  primaryContactName: null,
  fruitIds: [],
  fruits: [],
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};
const responsible = {
  id: userId,
  username: "juan",
  fullName: "Juan Supervisor",
  role: "SUPERVISOR",
  status: "ACTIVE",
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

function analytics(view: string) {
  return {
    view,
    kpis: [
      {
        key: "total",
        label: view === "summary" ? "Visitas del periodo" : "Total",
        value: 12,
        format: "NUMBER",
      },
      { key: "compliance", label: "Cumplimiento", value: 75, format: "PERCENT" },
    ],
    trend: [{ key: "2026-08-01", label: "1 ago", value: 4 }],
    distribution: [{ key: "COMPLETED", label: "Completadas", value: 9 }],
    secondaryDistribution: [],
    responsibleActivity: [],
    attention: [],
    rows: [
      {
        id: "019b3e83-7a28-7000-8000-000000000201",
        kind: view === "tasks" ? "TASK" : "VISIT",
        title: view === "tasks" ? "Enviar propuesta" : "Visita comercial",
        date: "2026-08-05",
        accountName: account.displayName,
        responsibleName: responsible.fullName,
        status: "COMPLETED",
        priority: "HIGH",
        city: account.city,
        category: null,
        format: null,
        total: null,
        secondary: null,
        href: "/app/visits/019b3e83-7a28-7000-8000-000000000201",
      },
    ],
    pagination,
  };
}

function ok<T>(data: T, status = 200) {
  return { data, response: new Response(JSON.stringify(data), { status }) };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

function mockGet() {
  const analyticsQueries: Array<Record<string, unknown>> = [];
  vi.spyOn(api, "GET").mockImplementation((path, options) => {
    if (path === "/reports/analytics/{view}") {
      const request = options as {
        params: { path: { view: string }; query: Record<string, unknown> };
      };
      analyticsQueries.push(request.params.query);
      return Promise.resolve(ok(analytics(request.params.path.view)) as never);
    }
    if (path === "/commercial-accounts")
      return Promise.resolve(ok({ items: [account], pagination }) as never);
    if (path === "/users")
      return Promise.resolve(ok({ items: [responsible], pagination }) as never);
    if (path === "/document-categories")
      return Promise.resolve(
        ok([
          {
            id: "019b3e83-7a28-7000-8000-000000000301",
            name: "Contrato",
            active: true,
            version: 1,
          },
        ]) as never,
      );
    if (path === "/reports/exports")
      return Promise.resolve(
        ok({ items: [], pagination: { ...pagination, total: 0, totalPages: 0 } }) as never,
      );
    throw new Error(`GET inesperado: ${String(path)}`);
  });
  return analyticsQueries;
}

afterEach(() => vi.restoreAllMocks());

describe("dashboard de reportes", () => {
  it("abre en Resumen y cambia entre los cinco reportes analíticos", async () => {
    mockGet();
    renderPage();

    expect(await screen.findByRole("tab", { name: "Resumen", selected: true })).toBeVisible();
    expect(await screen.findByText("Visitas del periodo")).toBeVisible();
    for (const tab of ["Visitas", "Tareas", "Clientes", "Documentos"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(await screen.findByRole("tab", { name: tab, selected: true })).toBeVisible();
    }
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  it("usa nombres visibles en selectores y envía los filtros al endpoint analítico", async () => {
    const analyticsQueries = mockGet();
    renderPage();

    expect(await screen.findByRole("option", { name: account.displayName })).toBeVisible();
    expect(screen.queryByText(accountId)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: accountId } });
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: userId } });
    fireEvent.change(screen.getByLabelText("Ciudad"), { target: { value: account.city } });
    fireEvent.click(screen.getByRole("tab", { name: "Visitas" }));
    fireEvent.change(screen.getByLabelText("Estado de visita"), { target: { value: "COMPLETED" } });

    await waitFor(() =>
      expect(
        analyticsQueries.some(
          (query) => query.accountId === accountId && query.visitStatus === "COMPLETED",
        ),
      ).toBe(true),
    );
  });

  it("mantiene PDF y Excel como exportación secundaria con los filtros visibles", async () => {
    mockGet();
    let posted: unknown;
    const post = vi.spyOn(api, "POST").mockImplementation((_path, options) => {
      posted = options;
      return Promise.resolve(ok({ id: crypto.randomUUID() }, 202) as never);
    });
    renderPage();

    await screen.findByText("Visitas del periodo");
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: accountId } });
    fireEvent.click(screen.getByRole("tab", { name: "Tareas" }));
    fireEvent.change(screen.getByLabelText("Estado de tarea"), { target: { value: "PENDING" } });
    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
    expect(screen.getByRole("dialog", { name: "Exportar reporte" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "XLSX" } });
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const request = posted as {
      body: { group: string; format: string; timezone: string; filters: Record<string, unknown> };
    };
    expect(request.body.group).toBe("TASKS");
    expect(request.body.format).toBe("XLSX");
    expect(request.body.timezone).toBe("America/Guayaquil");
    expect(request.body.filters.accountId).toBe(accountId);
    expect(request.body.filters.status).toBe("PENDING");
    expect(request.body.filters).not.toHaveProperty("taskStatus");
  });
});
