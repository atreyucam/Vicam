import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Task, TaskDetail } from "@vicam/contracts";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuredMutation } from "../offline/mutations";
import { TaskDetailPage, TaskFormPage, TasksPage } from "./TasksPages";

type TestMode = "detail" | "form" | "list";
type TaskMutation = StructuredMutation<Task>;

const mocks = vi.hoisted(() => {
  let mode: TestMode = "list";
  let detail: TaskDetail | undefined;
  return {
    get mode() {
      return mode;
    },
    set mode(value: TestMode) {
      mode = value;
    },
    get detail() {
      return detail;
    },
    set detail(value: TaskDetail | undefined) {
      detail = value;
    },
    mutation: vi.fn<(input: TaskMutation) => Promise<{ pending: boolean; value: Task }>>(),
    post: vi.fn(),
    reload: vi.fn(),
  };
});

const accountId = "019b3e83-7a28-7000-8000-000000000101";
const secondAccountId = "019b3e83-7a28-7000-8000-000000000102";
const visitId = "019b3e83-7a28-7000-8000-000000000201";
const task = {
  id: "019b3e83-7a28-7000-8000-000000000301",
  accountId,
  accountDisplayName: "Frutas Andinas",
  visitId,
  visitScheduledAt: "2026-07-22T20:00:00.000Z",
  visitReason: "Revisar proyección",
  responsibleUserId: "019b3e83-7a28-7000-8000-000000000002",
  responsibleFullName: "Sofía Supervisor",
  title: "Enviar propuesta",
  description: "Preparar propuesta comercial actualizada.",
  dueDate: "2026-07-23",
  dueTime: "10:30:00",
  timezone: "America/Guayaquil",
  priority: "HIGH" as const,
  status: "PENDING" as const,
  overdue: false,
  completedAt: null,
  createdAt: "2026-07-20T15:00:00.000Z",
  createdByFullName: "Manager Demostración",
  completedByFullName: null,
  cancelledAt: null,
  cancelledByFullName: null,
  cancellationReason: null,
  version: 3,
};

vi.mock("../api/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/api")>();
  return { ...original, api: { GET: vi.fn(), PATCH: vi.fn(), POST: mocks.post } };
});

vi.mock("../api/useAsync", () => ({
  useAsync: (_load: unknown, dependencies: unknown[]) => {
    if (mocks.mode === "list")
      return {
        data: { items: [task], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } },
        loading: false,
        reload: mocks.reload,
      };
    if (mocks.mode === "detail")
      return { data: mocks.detail ?? task, loading: false, reload: mocks.reload };
    if (dependencies.length === 1)
      return {
        data: [
          {
            id: visitId,
            accountId,
            reason: task.visitReason,
            scheduledAt: task.visitScheduledAt,
          },
        ],
        loading: false,
        reload: mocks.reload,
      };
    return {
      data: {
        task: undefined,
        accounts: [
          { id: accountId, displayName: task.accountDisplayName },
          { id: secondAccountId, displayName: "Costa Verde" },
        ],
        users: [],
      },
      loading: false,
      reload: mocks.reload,
    };
  },
}));

vi.mock("../offline/mutations", () => ({
  runStructuredMutation: mocks.mutation,
}));

vi.mock("../app/session", () => ({
  useSession: () => ({
    user: {
      id: task.responsibleUserId,
      fullName: task.responsibleFullName,
      role: "SUPERVISOR",
    },
  }),
}));

describe("tareas conectadas", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/app/tasks");
    mocks.mode = "list";
    mocks.detail = undefined;
    mocks.mutation.mockReset();
    mocks.post.mockReset();
    mocks.reload.mockReset();
    mocks.post.mockResolvedValue({
      data: { ...task, version: 4 },
      response: new Response(null, { status: 200 }),
    });
    mocks.mutation.mockImplementation(async (input) => {
      const value = await input.online();
      return { pending: false, value };
    });
  });

  it("navega desde título y Ver al detalle y conserva relaciones compactas", () => {
    render(<TasksPage />);

    expect(screen.getByRole("link", { name: task.title })).toHaveAttribute(
      "href",
      `/app/tasks/${task.id}`,
    );
    expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      `/app/tasks/${task.id}`,
    );
    expect(screen.getByRole("link", { name: task.accountDisplayName })).toHaveAttribute(
      "href",
      `/app/accounts/${accountId}`,
    );
    expect(screen.getByText(`Responsable: ${task.responsibleFullName}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Revisar proyección/ })).toHaveAttribute(
      "href",
      `/app/visits/${visitId}`,
    );
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Completar" })).not.toBeInTheDocument();
  });

  it("muestra detalle propio, relaciones, historial real y acciones abiertas", () => {
    mocks.mode = "detail";
    render(<TaskDetailPage taskId={task.id} />);

    expect(screen.getByRole("heading", { name: task.title })).toBeInTheDocument();
    expect(screen.getByText(task.description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: task.accountDisplayName })).toHaveAttribute(
      "href",
      `/app/accounts/${accountId}`,
    );
    expect(screen.getByRole("link", { name: /Revisar proyección/ })).toHaveAttribute(
      "href",
      `/app/visits/${visitId}`,
    );
    expect(screen.getByText("Tarea creada")).toBeInTheDocument();
    expect(screen.getByText(/Manager Demostración/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/app/tasks/${task.id}/edit`,
    );
  });

  it("separa version del payload offline al completar", async () => {
    mocks.mode = "detail";
    render(<TaskDetailPage taskId={task.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Completar" }));

    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    const mutation = mocks.mutation.mock.calls[0]![0];
    expect(mutation.baseVersion).toBe(3);
    expect(mutation.payload).toEqual({});
    expect(mocks.post).toHaveBeenCalledWith(
      "/tasks/{id}/complete",
      expect.objectContaining({ body: { version: 3 } }),
    );
  });

  it("exige motivo y separa version del payload offline al cancelar", async () => {
    mocks.mode = "detail";
    render(<TaskDetailPage taskId={task.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar tarea" }));
    const dialog = screen.getByRole("dialog", { name: "Cancelar tarea" });
    const reason = within(dialog).getByRole("textbox", { name: "Motivo de cancelación" });
    expect(reason).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelación" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El motivo es obligatorio.");
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "La prioridad comercial cambió." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    const mutation = mocks.mutation.mock.calls[0]![0];
    expect(mutation.baseVersion).toBe(3);
    expect(mutation.payload).toEqual({ reason: "La prioridad comercial cambió." });
    expect(mocks.post).toHaveBeenCalledWith(
      "/tasks/{id}/cancel",
      expect.objectContaining({
        body: { reason: "La prioridad comercial cambió.", version: 3 },
      }),
    );
  });

  it("mantiene el detalle y diálogo sin infracciones axe automáticas", async () => {
    mocks.mode = "detail";
    const { container } = render(<TaskDetailPage taskId={task.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar tarea" }));
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("muestra una tarea sin visita sin inventar una relación", () => {
    mocks.mode = "detail";
    mocks.detail = { ...task, visitId: null, visitReason: null, visitScheduledAt: null };
    render(<TaskDetailPage taskId={task.id} />);

    expect(screen.getByText("Sin visita vinculada")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Revisar proyección/ })).not.toBeInTheDocument();
  });

  it("muestra cierre cancelado real y oculta mutaciones posteriores", () => {
    mocks.mode = "detail";
    mocks.detail = {
      ...task,
      status: "CANCELLED",
      cancelledAt: "2026-07-21T16:30:00.000Z",
      cancelledByFullName: "Manager Demostración",
      cancellationReason: "El cliente cambió su prioridad.",
    };
    render(<TaskDetailPage taskId={task.id} />);

    expect(screen.getByText("Tarea cancelada")).toBeInTheDocument();
    expect(screen.getByText(/El cliente cambió su prioridad/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Completar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar tarea" })).not.toBeInTheDocument();
  });

  it("limpia la visita cuando cambia el cliente y conserva la opción sin visita", () => {
    mocks.mode = "form";
    window.history.replaceState({}, "", `/app/tasks/new?accountId=${accountId}&visitId=${visitId}`);
    render(<TaskFormPage />);
    const account = screen.getByRole("combobox", { name: "Cliente" });
    const visit = screen.getByRole("combobox", { name: "Visita vinculada (opcional)" });
    expect(visit).toHaveValue(visitId);

    fireEvent.change(account, { target: { value: secondAccountId } });
    expect(visit).toHaveValue("");
    expect(within(visit).getByRole("option", { name: "Sin visita" })).toBeInTheDocument();
  });
});
