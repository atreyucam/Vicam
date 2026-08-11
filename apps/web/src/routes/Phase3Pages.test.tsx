import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/api";
import { MapLibreField } from "../components/MapLibreField";
import { DocumentsPage, ImportsPage, ProfilePage, UsersPage } from "./Phase3Pages";

const ok = <T,>(data: T, status = 200) => ({
  data,
  response: new Response(JSON.stringify(data), { status }),
});
const page = <T,>(items: T[]) => ({
  items,
  pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 },
});
function requestKey(calls: unknown[][], index: number) {
  const options = (
    calls[index] as [unknown, { params?: { header?: Record<string, string> } }] | undefined
  )?.[1];
  return options?.params?.header?.["idempotency-key"];
}
function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/app");
});

describe("rutas Phase3", () => {
  it("explica la ausencia de coordenadas sin solicitar ubicación", () => {
    render(<MapLibreField latitude={null} longitude={null} />);
    expect(screen.getByRole("heading", { name: "Sin ubicación registrada" })).toBeInTheDocument();
    expect(screen.getByText(/acción explícita/i)).toBeInTheDocument();
  });

  it("mantiene coordenadas accesibles cuando el proveedor de mapa no está configurado", async () => {
    const { container } = render(<MapLibreField latitude={-0.180653} longitude={-78.467834} />);
    expect(screen.getByRole("region", { name: "Ubicación del cliente" })).toBeInTheDocument();
    expect(screen.getByText(/mapa no está configurado/i)).toBeInTheDocument();
    expect(screen.getByText(/-0.180653/)).toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("mantiene el perfil accesible sin exponer sesiones no contratadas", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <ProfilePage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Perfil y dispositivo" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Cargando contenido")).toHaveLength(2);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("crea usuarios en un modal accesible y muestra la credencial temporal", async () => {
    const createdUser = {
      id: "019b3e83-7a28-7000-8000-000000000009",
      username: "supervisor.nuevo",
      fullName: "Supervisor Nuevo",
      role: "SUPERVISOR" as const,
      timezone: "America/Guayaquil",
      status: "ACTIVE" as const,
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    vi.spyOn(api, "GET").mockResolvedValue(ok(page([])));
    const post = vi
      .spyOn(api, "POST")
      .mockResolvedValue(ok({ user: createdUser, temporaryPassword: "Temporal!456" }, 201));
    const { container } = renderWithClient(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Crear usuario" }));
    expect(screen.getByRole("dialog", { name: "Crear usuario" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar diálogo" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo" }), {
      target: { value: createdUser.fullName },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Usuario" }), {
      target: { value: createdUser.username },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]?.[0]).toBe("/users");
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: {
        fullName: createdUser.fullName,
        role: "SUPERVISOR",
        username: createdUser.username,
      },
    });
    expect(await screen.findByText("Temporal!456")).toBeVisible();
    expect(
      (await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it("confirma una importación con el confirmationId entregado por el lote", async () => {
    const confirmationId = "019b3e83-7a28-7000-8000-000000000777";
    const batchId = "019b3e83-7a28-7000-8000-000000000778";
    window.history.replaceState({}, "", `/app/imports?batchId=${batchId}`);
    const get = vi.spyOn(api, "GET").mockResolvedValue(
      ok({
        id: batchId,
        format: "CSV",
        status: "READY",
        totalRows: 1,
        createRows: 1,
        updateRows: 0,
        skipRows: 0,
        errorRows: 0,
        confirmationId,
        createdAt: "2026-07-24T10:00:00.000Z",
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
      }),
    );
    const post = vi.spyOn(api, "POST").mockResolvedValue(
      ok(
        {
          id: batchId,
          format: "CSV",
          status: "CONFIRMING",
          totalRows: 1,
          createRows: 1,
          updateRows: 0,
          skipRows: 0,
          errorRows: 0,
          confirmationId,
          createdAt: "2026-07-24T10:00:00.000Z",
          completedAt: null,
        },
        202,
      ),
    );

    renderWithClient(<ImportsPage />);
    expect(await screen.findByRole("button", { name: "Confirmar importación" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importación" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe("/imports/{id}/confirm");
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: { confirmationId },
      params: { path: { id: batchId } },
    });
    expect(await screen.findByText(/confirmación aceptada/i)).toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });

  it("archiva un documento mediante confirmación accesible", async () => {
    window.history.replaceState(
      {},
      "",
      "/app/documents?accountId=019b3e83-7a28-7000-8000-000000000101",
    );
    let archived = false;
    const document = () => ({
      id: "019b3e83-7a28-7000-8000-000000000601",
      accountId: "019b3e83-7a28-7000-8000-000000000101",
      visitId: null,
      taskId: null,
      categoryId: "019b3e83-7a28-7000-8000-000000000701",
      categoryName: "Contrato",
      originalName: "contrato.pdf",
      format: "PDF",
      sizeBytes: 2048,
      checksum: "a".repeat(64),
      status: archived ? "DELETED" : "AVAILABLE",
      rejectedReason: null,
      deletedAt: archived ? "2026-07-24T11:00:00.000Z" : null,
      createdAt: "2026-07-24T10:00:00.000Z",
      createdBy: "019b3e83-7a28-7000-8000-000000000001",
    });
    vi.spyOn(api, "GET").mockImplementation((path) =>
      path === "/document-categories" ? (ok([]) as never) : (ok(page([document()])) as never),
    );
    const remove = vi.spyOn(api, "DELETE").mockImplementation(() => {
      archived = true;
      return Promise.resolve(ok({}));
    });
    const restore = vi.spyOn(api, "POST").mockImplementation((path) => {
      if (path === "/documents/{id}/restore") archived = false;
      return Promise.resolve(ok({}) as never);
    });
    renderWithClient(<DocumentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Archivar" }));
    expect(screen.getByRole("dialog", { name: "Archivar documento" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archivar documento" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(remove.mock.calls[0]?.[0]).toBe("/documents/{id}");
    expect(remove.mock.calls[0]?.[1]).toMatchObject({
      params: { path: { id: "019b3e83-7a28-7000-8000-000000000601" } },
    });
    const archiveKey = requestKey(remove.mock.calls, 0);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar documento" }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith("/documents/{id}/restore", expect.anything()),
    );
    const restoreIndex = restore.mock.calls.findIndex(
      (call) => call[0] === "/documents/{id}/restore",
    );
    const restoreKey = requestKey(restore.mock.calls, restoreIndex);
    expect(archiveKey).toBeTruthy();
    expect(restoreKey).toBeTruthy();
    expect(restoreKey).not.toBe(archiveKey);
  });

});
