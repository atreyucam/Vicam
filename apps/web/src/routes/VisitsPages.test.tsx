import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaPage, VisitDetailPage } from "./VisitsPages";

const mocks = vi.hoisted(() => ({
  mode: "agenda",
  post: vi.fn(),
  reload: vi.fn(),
}));
const visit = {
  id: "019b3e83-7a28-7000-8000-000000000201",
  accountId: "019b3e83-7a28-7000-8000-000000000101",
  accountDisplayName: "Frutas Andinas",
  responsibleUserId: "019b3e83-7a28-7000-8000-000000000002",
  responsibleFullName: "Sofía Supervisor",
  scheduledAt: "2026-07-22T20:00:00.000Z",
  timezone: "America/Guayaquil",
  reason: "Revisión de temporada",
  priority: "HIGH" as const,
  notes: null,
  status: "PENDING" as const,
  result: null,
  observation: null,
  actualStartedAt: null,
  actualEndedAt: null,
  cancellationReason: null,
  version: 1,
};
const visitDetail = {
  ...visit,
  createdAt: "2026-07-20T14:00:00.000Z",
  createdByFullName: "Sofía Supervisor",
  completedAt: null,
  completedByFullName: null,
  cancelledAt: null,
  cancelledByFullName: null,
  history: [
    {
      id: "created:visit",
      type: "CREATED" as const,
      occurredAt: "2026-07-20T14:00:00.000Z",
      actorUserId: visit.responsibleUserId,
      actorFullName: "Sofía Supervisor",
      scheduledAt: "2026-07-21T20:00:00.000Z",
      oldScheduledAt: null,
      newScheduledAt: null,
      reason: null,
      result: null,
    },
    {
      id: "rescheduled:visit",
      type: "RESCHEDULED" as const,
      occurredAt: "2026-07-21T16:00:00.000Z",
      actorUserId: visit.responsibleUserId,
      actorFullName: "Sofía Supervisor",
      scheduledAt: null,
      oldScheduledAt: "2026-07-21T20:00:00.000Z",
      newScheduledAt: visit.scheduledAt,
      reason: "Cambio solicitado",
      result: null,
    },
  ],
};
const relatedTask = {
  id: "019b3e83-7a28-7000-8000-000000000301",
  accountId: visit.accountId,
  accountDisplayName: visit.accountDisplayName,
  visitId: visit.id,
  responsibleUserId: visit.responsibleUserId,
  responsibleFullName: visit.responsibleFullName,
  title: "Enviar propuesta comercial",
  description: null,
  dueDate: "2026-07-24",
  dueTime: null,
  timezone: visit.timezone,
  priority: "HIGH" as const,
  status: "PENDING" as const,
  overdue: false,
  completedAt: null,
  version: 1,
};

vi.mock("../api/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/api")>();
  return { ...original, api: { GET: vi.fn(), POST: mocks.post } };
});
vi.mock("../api/useAsync", () => ({
  useAsync: () => {
    const selectedVisit =
      mocks.mode === "cancelled"
        ? {
            ...visitDetail,
            status: "CANCELLED" as const,
            cancellationReason: "Cliente no disponible",
            cancelledAt: "2026-07-22T14:30:00.000Z",
            cancelledByFullName: "Sofía Supervisor",
          }
        : visitDetail;
    return {
      data:
        mocks.mode === "agenda"
          ? { items: [visit], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }
          : mocks.mode === "complete"
            ? { visit: selectedVisit, users: [] }
            : { visit: selectedVisit, tasks: [relatedTask] },
      loading: false,
      reload: mocks.reload,
    };
  },
}));
vi.mock("../app/session", () => ({
  useSession: () => ({
    user: {
      id: visit.responsibleUserId,
      fullName: visit.responsibleFullName,
      role: "SUPERVISOR",
      timezone: "America/Guayaquil",
    },
  }),
}));
vi.mock("../offline/mutations", () => ({
  runStructuredMutation: async ({ online }: { online: () => Promise<unknown> }) => ({
    queued: false,
    value: await online(),
  }),
}));

describe("agenda y acciones de visita", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.reload.mockReset();
    mocks.mode = "agenda";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    mocks.post.mockResolvedValue({
      data: { ...visitDetail, version: 2 },
      response: new Response(null, { status: 200 }),
    });
  });

  it("navega por semanas y convierte toda la fila en un enlace de teclado", async () => {
    const { container } = render(<AgendaPage />);
    const row = screen.getByRole("link", { name: "Abrir visita de Frutas Andinas" });
    expect(row).toHaveAttribute("href", `/app/visits/${visit.id}`);
    row.focus();
    expect(row).toHaveFocus();
    expect(screen.getByRole("link", { name: "Agendar cita" }).querySelector("svg")).not.toBeNull();

    const strip = screen.getByLabelText("Fechas de agenda");
    const selectedBefore = within(strip)
      .getByRole("button", { pressed: true })
      .getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));
    const selectedAfter = within(strip)
      .getByRole("button", { pressed: true })
      .getAttribute("aria-label");
    expect(selectedAfter).not.toBe(selectedBefore);
    expect(
      (await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it("reprograma desde la fecha actual, cierra el modal y recarga el detalle", async () => {
    mocks.mode = "detail";
    render(<VisitDetailPage visitId={visit.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Reprogramar" }));
    const dialog = screen.getByRole("dialog", { name: "Reprogramar visita" });
    expect(screen.getByRole("button", { name: "Cerrar diálogo" })).toBeVisible();
    const scheduledAt = screen.getByLabelText(/Nueva fecha y hora/);
    expect(scheduledAt).toHaveValue("2026-07-22T15:00");
    expect(scheduledAt).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo" }), {
      target: { value: "Cambio solicitado por el cliente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reprogramación" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/visits/{id}/reschedule");
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({
      body: {
        scheduledAt: visit.scheduledAt,
        reason: "Cambio solicitado por el cliente",
        timezone: visit.timezone,
        version: 1,
      },
      params: { path: { id: visit.id } },
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it("prioriza el contexto comercial, historial real y tareas relacionadas", () => {
    mocks.mode = "detail";
    render(<VisitDetailPage visitId={visit.id} />);

    expect(screen.getByRole("link", { name: visit.accountDisplayName })).toHaveAttribute(
      "href",
      `/app/accounts/${visit.accountId}`,
    );
    expect(screen.getByRole("heading", { name: "Motivo de la visita" })).toBeVisible();
    expect(screen.getByText(visit.reason)).toBeVisible();
    expect(screen.getByText("Reprogramada")).toBeVisible();
    expect(screen.getByText(/Cambio solicitado/)).toBeVisible();
    expect(screen.getByRole("link", { name: relatedTask.title })).toHaveAttribute(
      "href",
      `/app/tasks/${relatedTask.id}`,
    );
    expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      `/app/tasks/${relatedTask.id}`,
    );
  });

  it("muestra los datos propios de una cancelación sin observación pendiente", () => {
    mocks.mode = "cancelled";
    render(<VisitDetailPage visitId={visit.id} />);

    expect(screen.getByRole("heading", { name: "Cancelación" })).toBeVisible();
    expect(screen.getByText("Cliente no disponible")).toBeVisible();
    expect(screen.getAllByText("Sofía Supervisor").length).toBeGreaterThan(0);
    expect(screen.queryByText("Observación de cierre")).not.toBeInTheDocument();
  });

  it("cancela con el endpoint dedicado y mantiene el cierre accesible", async () => {
    mocks.mode = "detail";
    render(<VisitDetailPage visitId={visit.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar visita" }));
    expect(screen.getByRole("textbox", { name: "Motivo" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo" }), {
      target: { value: "El cliente canceló" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/visits/{id}/cancel");
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({
      body: { reason: "El cliente canceló", version: 1 },
      params: { path: { id: visit.id } },
    });
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it("completa con resultado, tiempos y una tarea de seguimiento en una sola operación", async () => {
    mocks.mode = "complete";
    render(<VisitDetailPage action="complete" visitId={visit.id} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Resultado de la visita" }), {
      target: { value: "PROPOSAL_REQUESTED" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Observación / resumen" }), {
      target: { value: "Solicitó una propuesta actualizada" },
    });
    fireEvent.change(screen.getByLabelText("Inicio real"), {
      target: { value: "2026-07-22T14:00" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Crear tarea de seguimiento" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Título" }), {
      target: { value: "Enviar propuesta" },
    });
    fireEvent.change(screen.getByLabelText(/Fecha de vencimiento/), {
      target: { value: "2026-07-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar visita" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/visits/{id}/complete");
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({
      body: {
        result: "PROPOSAL_REQUESTED",
        observation: "Solicitó una propuesta actualizada",
        actualStartedAt: "2026-07-22T19:00:00.000Z",
        followUpTask: {
          title: "Enviar propuesta",
          responsibleUserId: visit.responsibleUserId,
          dueDate: "2026-07-24",
          priority: "MEDIUM",
        },
        version: 1,
      },
      params: { path: { id: visit.id } },
    });
  });
});
