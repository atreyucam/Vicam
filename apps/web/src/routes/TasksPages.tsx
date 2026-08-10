import type { CommercialAccount, Task, TaskDetail, Visit } from "@vicam/contracts";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  ErrorSummary,
  FormSection,
  Input,
  PriorityBadge,
  Select,
  StatePanel,
  StatusBadge,
  StickyActionBar,
  Textarea,
  Timeline,
} from "@vicam/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, unwrap } from "../api/api";
import { createIdempotencyKey, idempotencyParams, useIdempotencyKey } from "../api/idempotency";
import { useAsync } from "../api/useAsync";
import { useSession } from "../app/session";
import { formValue, formatDate, formatDateTime, go, LoadBoundary } from "./shared";
import { todayInZone } from "../lib/timezone";
import {
  isPendingOfflineValue,
  putOfflineEntity,
  readOfflineEntities,
  readOfflineEntity,
  removeOfflineEntity,
} from "../offline/entities";
import { withOfflineFallback } from "../offline/loaders";
import { runStructuredMutation } from "../offline/mutations";

const taskStatus = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;

function taskStatusTone(task: Task) {
  if (task.overdue && task.status !== "COMPLETED" && task.status !== "CANCELLED") return "danger";
  if (task.status === "COMPLETED") return "success";
  if (task.status === "CANCELLED") return "neutral";
  return "warning";
}

function taskStatusLabel(task: Task) {
  return task.overdue && task.status !== "COMPLETED" && task.status !== "CANCELLED"
    ? "Vencida"
    : taskStatus[task.status];
}

export function TasksPage() {
  const { user } = useSession();
  const query = new URLSearchParams(window.location.search);
  const status = query.get("status") ?? "";
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () => {
          const page = unwrap(
            await api.GET("/tasks", {
              params: {
                query: {
                  page: 1,
                  pageSize: 100,
                  ...(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(status)
                    ? { status: status as keyof typeof taskStatus }
                    : {}),
                },
              },
            }),
          );
          await Promise.all(
            page.items.map((task) =>
              task.status === "PENDING" || task.status === "IN_PROGRESS"
                ? putOfflineEntity({
                    accountId: task.accountId,
                    entityId: task.id,
                    entityType: "TASK",
                    value: task,
                    version: task.version,
                  })
                : removeOfflineEntity("TASK", task.id),
            ),
          );
          return page;
        },
        async () => {
          const stored = await readOfflineEntities<Task>(
            "TASK",
            (task) =>
              (task.status === "PENDING" || task.status === "IN_PROGRESS") &&
              (!status || task.status === status),
          );
          return {
            items: stored,
            pagination: {
              page: 1,
              pageSize: 100,
              total: stored.length,
              totalPages: stored.length ? 1 : 0,
            },
          };
        },
      ),
    [status],
  );
  const tasks = state.data?.items ?? [];
  const today = todayInZone("America/Guayaquil");
  const groups = [
    {
      label: "Vencidas",
      items: tasks.filter((task) => task.overdue && task.status !== "COMPLETED"),
    },
    {
      label: "Hoy",
      items: tasks.filter((task) => !task.overdue && task.dueDate === today),
    },
    {
      label: "Próximas",
      items: tasks.filter((task) => !task.overdue && task.dueDate !== today),
    },
  ];
  return (
    <>
      <div className="tasks-toolbar">
        <nav aria-label="Vistas de tareas" className="tabs">
          <a aria-current={!status ? "page" : undefined} href="/app/tasks">
            {user?.role === "MANAGER" ? "Todas" : "Mis tareas"}
          </a>
          <a
            aria-current={status === "COMPLETED" ? "page" : undefined}
            href="/app/tasks?status=COMPLETED"
          >
            Completadas
          </a>
        </nav>
        <ButtonLink href="/app/tasks/new">Nueva tarea</ButtonLink>
      </div>
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        {tasks.length ? (
          <div className="task-groups">
            {groups
              .filter((group) => group.items.length)
              .map((group) => (
                <section key={group.label}>
                  <h2>
                    {group.label} <span>{group.items.length}</span>
                  </h2>
                  <div className="task-list">
                    {group.items.map((task) => (
                      <Card key={task.id}>
                        <div className="task-card">
                          <div>
                            <a href={`/app/tasks/${task.id}`}>
                              <strong>{task.title}</strong>
                            </a>
                            <a href={`/app/accounts/${task.accountId}`}>
                              {task.accountDisplayName}
                            </a>
                            <span>
                              Vence {formatDate(task.dueDate)}
                              {task.dueTime ? ` a las ${task.dueTime.slice(0, 5)}` : " · sin hora"}
                            </span>
                            <span>Responsable: {task.responsibleFullName}</span>
                            {task.visitId ? (
                              <a href={`/app/visits/${task.visitId}`}>
                                {task.visitScheduledAt
                                  ? `Visita ${formatDateTime(task.visitScheduledAt, "America/Guayaquil")}`
                                  : "Visita vinculada"}
                                {task.visitReason ? ` · ${task.visitReason}` : ""}
                              </a>
                            ) : null}
                          </div>
                          <PriorityBadge priority={task.priority} />
                          <StatusBadge tone={taskStatusTone(task)}>
                            {taskStatusLabel(task)}
                          </StatusBadge>
                          {isPendingOfflineValue(task) ? (
                            <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
                          ) : null}
                          <div>
                            <ButtonLink href={`/app/tasks/${task.id}`} variant="secondary">
                              Ver
                            </ButtonLink>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        ) : (
          <StatePanel
            kind={status ? "no-results" : "empty"}
            title={status ? "Sin resultados" : "No hay tareas"}
          >
            <p>
              {status
                ? "No hay tareas con este filtro."
                : "Crea una tarea para iniciar el seguimiento."}
            </p>
            <ButtonLink href="/app/tasks/new">Nueva tarea</ButtonLink>
          </StatePanel>
        )}
      </LoadBoundary>
    </>
  );
}

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [cancelling, setCancelling] = useState(false);
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const completionIntent = useRef<string | undefined>(undefined);
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () => {
          const task = unwrap(await api.GET("/tasks/{id}", { params: { path: { id: taskId } } }));
          if (task.status === "PENDING" || task.status === "IN_PROGRESS")
            await putOfflineEntity({
              accountId: task.accountId,
              entityId: task.id,
              entityType: "TASK",
              value: task,
              version: task.version,
            });
          else await removeOfflineEntity("TASK", task.id);
          return task;
        },
        () => readOfflineEntity<TaskDetail>("TASK", taskId),
      ),
    [taskId],
  );

  async function complete(task: TaskDetail) {
    const intentKey = completionIntent.current ?? createIdempotencyKey();
    completionIntent.current = intentKey;
    setActionErrors([]);
    try {
      const onlineBody = { version: task.version };
      await runStructuredMutation<Task>({
        accountId: task.accountId,
        action: "COMPLETE",
        baseVersion: task.version,
        changedFields: ["status", "completedAt"],
        clientOperationId: intentKey,
        entityId: task.id,
        entityType: "TASK",
        localValue: {
          ...task,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          overdue: false,
        },
        online: async () =>
          unwrap(
            await api.POST("/tasks/{id}/complete", {
              params: { path: { id: task.id }, ...idempotencyParams(intentKey) },
              body: onlineBody,
            }),
          ),
        payload: {},
      });
      completionIntent.current = undefined;
      state.reload();
    } catch (reason) {
      setActionErrors([
        reason instanceof ApiError
          ? reason.message
          : "No pudimos completar la tarea. Intenta nuevamente.",
      ]);
    }
  }

  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {state.data ? (
        <>
          <ErrorSummary errors={actionErrors} />
          <div className="detail-hero">
            <div>
              <StatusBadge tone={taskStatusTone(state.data)}>
                {taskStatusLabel(state.data)}
              </StatusBadge>
              {isPendingOfflineValue(state.data) ? (
                <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
              ) : null}
              <h2>{state.data.title}</h2>
              <p>
                Vence {formatDate(state.data.dueDate)}
                {state.data.dueTime ? ` a las ${state.data.dueTime.slice(0, 5)}` : " · sin hora"}
              </p>
              <span>Responsable: {state.data.responsibleFullName}</span>
              <PriorityBadge priority={state.data.priority} />
            </div>
            {state.data.status === "PENDING" || state.data.status === "IN_PROGRESS" ? (
              <div>
                <Button onClick={() => void complete(state.data!)}>Completar</Button>
                <ButtonLink href={`/app/tasks/${taskId}/edit`} variant="secondary">
                  Editar
                </ButtonLink>
                <Button onClick={() => setCancelling(true)} variant="danger">
                  Cancelar tarea
                </Button>
              </div>
            ) : null}
          </div>
          <Card title="Descripción">
            <p>{state.data.description ?? "Sin descripción"}</p>
          </Card>
          <div className="detail-grid">
            <Card title="Relaciones">
              <dl className="detail-list">
                <div>
                  <dt>Cliente</dt>
                  <dd>
                    <a href={`/app/accounts/${state.data.accountId}`}>
                      {state.data.accountDisplayName}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Visita</dt>
                  <dd>
                    {state.data.visitId ? (
                      <a href={`/app/visits/${state.data.visitId}`}>
                        {state.data.visitScheduledAt
                          ? formatDateTime(state.data.visitScheduledAt, "America/Guayaquil")
                          : "Visita vinculada"}
                        {state.data.visitReason ? ` · ${state.data.visitReason}` : ""}
                      </a>
                    ) : (
                      "Sin visita vinculada"
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card title="Historial">
              <Timeline items={taskTimeline(state.data)} />
              {state.data.status === "CANCELLED" ? (
                <p>
                  <strong>Motivo de cancelación:</strong> {state.data.cancellationReason ?? "—"}
                </p>
              ) : null}
            </Card>
          </div>
          {cancelling ? (
            <CancelTaskDialog
              onCancelled={() => {
                setCancelling(false);
                state.reload();
              }}
              onClose={() => setCancelling(false)}
              task={state.data}
            />
          ) : null}
        </>
      ) : null}
    </LoadBoundary>
  );
}

function taskTimeline(task: TaskDetail) {
  const items: Array<{ detail: string; state: "done" | "current"; title: string }> = [
    {
      title: "Tarea creada",
      detail: `${formatDateTime(task.createdAt, "America/Guayaquil")} · ${task.createdByFullName ?? "Usuario"}`,
      state: "done" as const,
    },
  ];
  if (task.completedAt)
    items.push({
      title: "Tarea completada",
      detail: `${formatDateTime(task.completedAt, "America/Guayaquil")} · ${task.completedByFullName ?? "Usuario"}`,
      state: "done",
    });
  else if (task.cancelledAt)
    items.push({
      title: "Tarea cancelada",
      detail: `${formatDateTime(task.cancelledAt, "America/Guayaquil")} · ${task.cancelledByFullName ?? "Usuario"}`,
      state: "done",
    });
  else
    items.push({
      title: taskStatus[task.status],
      detail: `Vence ${formatDate(task.dueDate)}${task.dueTime ? ` a las ${task.dueTime.slice(0, 5)}` : ""}`,
      state: "current",
    });
  return items;
}

function CancelTaskDialog({
  onCancelled,
  onClose,
  task,
}: {
  onCancelled: () => void;
  onClose: () => void;
  task: Task;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const idempotencyKey = useIdempotencyKey();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = formValue(new FormData(event.currentTarget), "reason").trim();
    if (!reason) {
      setErrors(["El motivo es obligatorio."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const onlineBody = { reason, version: task.version };
      const localValue: Task = { ...task, status: "CANCELLED", overdue: false };
      if ("cancellationReason" in task)
        Object.assign(localValue, {
          cancellationReason: reason,
          cancelledAt: new Date().toISOString(),
          cancelledByFullName: null,
        });
      await runStructuredMutation<Task>({
        accountId: task.accountId,
        action: "CANCEL",
        baseVersion: task.version,
        changedFields: ["status", "cancellationReason", "cancelledAt"],
        clientOperationId: idempotencyKey,
        entityId: task.id,
        entityType: "TASK",
        localValue,
        online: async () =>
          unwrap(
            await api.POST("/tasks/{id}/cancel", {
              params: { path: { id: task.id }, ...idempotencyParams(idempotencyKey) },
              body: onlineBody,
            }),
          ),
        payload: { reason },
      });
      onCancelled();
    } catch (reasonError) {
      setErrors([
        reasonError instanceof ApiError ? reasonError.message : "No pudimos cancelar la tarea.",
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      description={
        <>
          <strong>{task.title}</strong> · {task.accountDisplayName}
          <br />
          La tarea quedará cancelada y esta acción se registrará en auditoría.
        </>
      }
      onClose={onClose}
      title="Cancelar tarea"
    >
      <form noValidate onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} />
        <Textarea data-dialog-initial-focus label="Motivo de cancelación" name="reason" required />
        <div className="modal-actions">
          <Button onClick={onClose} variant="secondary">
            Volver
          </Button>
          <Button loading={busy} type="submit" variant="danger">
            Confirmar cancelación
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskFormPage({ taskId }: { taskId?: string }) {
  const { user } = useSession();
  const detectedZone = "America/Guayaquil";
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams(window.location.search);
  const queryAccountId = query.get("accountId") ?? "";
  const queryVisitId = query.get("visitId") ?? "";
  const [accountId, setAccountId] = useState(queryAccountId);
  const [visitId, setVisitId] = useState(queryVisitId);
  const idempotencyKey = useIdempotencyKey();
  const [localTaskId] = useState(() => crypto.randomUUID());
  const state = useAsync(async () => {
    const [task, accounts, users] = await Promise.all([
      taskId
        ? withOfflineFallback(
            async () => {
              const task = unwrap(
                await api.GET("/tasks/{id}", { params: { path: { id: taskId } } }),
              );
              if (task.status === "COMPLETED" || task.status === "CANCELLED")
                await removeOfflineEntity("TASK", task.id);
              return task;
            },
            () => readOfflineEntity<Task>("TASK", taskId),
          )
        : Promise.resolve(null),
      withOfflineFallback(
        async () =>
          unwrap(
            await api.GET("/commercial-accounts", {
              params: { query: { page: 1, pageSize: 100, status: "ACTIVE" } },
            }),
          ),
        async () => {
          const items = await readOfflineEntities<CommercialAccount>(
            "ACCOUNT",
            (account) => account.status === "ACTIVE",
          );
          return {
            items,
            pagination: {
              page: 1,
              pageSize: 100,
              total: items.length,
              totalPages: items.length ? 1 : 0,
            },
          };
        },
      ),
      user?.role === "MANAGER" && navigator.onLine
        ? api.GET("/users", { params: { query: { page: 1, pageSize: 100, status: "ACTIVE" } } })
        : Promise.resolve(null),
    ]);
    const current = task ?? undefined;
    return {
      task: current,
      accounts: accounts.items,
      users: users ? unwrap(users).items : user ? [user] : [],
    };
  }, [taskId, user?.role]);
  useEffect(() => {
    if (!state.data?.task) return;
    setAccountId(state.data.task.accountId);
    setVisitId(state.data.task.visitId ?? "");
  }, [state.data?.task]);
  const visitsState = useAsync(async () => {
    if (!accountId) return [];
    const page = await withOfflineFallback(
      async () =>
        unwrap(
          await api.GET("/visits", {
            params: { query: { page: 1, pageSize: 100, accountId } },
          }),
        ),
      async () => {
        const items = await readOfflineEntities<Visit>(
          "VISIT",
          (visit) =>
            visit.accountId === accountId &&
            (visit.status === "PENDING" || isPendingOfflineValue(visit)),
        );
        return {
          items,
          pagination: {
            page: 1,
            pageSize: 100,
            total: items.length,
            totalPages: items.length ? 1 : 0,
          },
        };
      },
    );
    return page.items;
  }, [accountId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!["accountId", "responsibleUserId", "title", "dueDate"].every((key) => data.get(key))) {
      setErrors(["Completa cliente, título, responsable y vencimiento."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    const body = {
      accountId: formValue(data, "accountId"),
      visitId: formValue(data, "visitId") || null,
      responsibleUserId: formValue(data, "responsibleUserId"),
      title: formValue(data, "title"),
      description: formValue(data, "description") || null,
      dueDate: formValue(data, "dueDate"),
      dueTime: taskId ? formValue(data, "dueTime") || null : null,
      timezone: formValue(data, "timezone"),
      priority: formValue(data, "priority") as "LOW" | "MEDIUM" | "HIGH",
    };
    try {
      const existing = state.data?.task;
      const account = state.data?.accounts.find((item) => item.id === body.accountId);
      const selectedVisit = visitsState.data?.find((item) => item.id === body.visitId);
      const localValue: Task = {
        ...body,
        id: localTaskId,
        accountDisplayName: account?.displayName ?? existing?.accountDisplayName ?? "Cliente",
        responsibleFullName:
          user?.role === "SUPERVISOR"
            ? user.fullName
            : (state.data?.users.find((item) => item.id === body.responsibleUserId)?.fullName ??
              existing?.responsibleFullName ??
              "Responsable"),
        status: existing?.status ?? "PENDING",
        overdue: false,
        completedAt: existing?.completedAt ?? null,
        visitReason: selectedVisit?.reason ?? existing?.visitReason ?? null,
        visitScheduledAt: selectedVisit?.scheduledAt ?? existing?.visitScheduledAt ?? null,
        version: existing?.version ?? 1,
      };
      await runStructuredMutation<Task>({
        accountId: body.accountId,
        action: taskId ? "UPDATE" : "CREATE",
        baseVersion: existing?.version ?? null,
        changedFields: Object.keys(body),
        clientOperationId: idempotencyKey,
        dependencyEntities: [
          { entityId: body.accountId, entityType: "ACCOUNT" },
          ...(body.visitId ? [{ entityId: body.visitId, entityType: "VISIT" } as const] : []),
        ],
        entityId: taskId ?? localTaskId,
        entityType: "TASK",
        localValue,
        online: async () =>
          unwrap(
            taskId
              ? await api.PATCH("/tasks/{id}", {
                  params: { path: { id: taskId }, ...idempotencyParams(idempotencyKey) },
                  body: { ...body, version: existing!.version },
                })
              : await api.POST("/tasks", { params: idempotencyParams(idempotencyKey), body }),
          ),
        payload: body,
      });
      go(taskId ? `/app/tasks/${taskId}` : "/app/tasks");
    } catch (reason) {
      setErrors([reason instanceof ApiError ? reason.message : "No pudimos guardar la tarea."]);
    } finally {
      setBusy(false);
    }
  }
  const task = state.data?.task;
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      <form className="entity-form" onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} />
        <FormSection title="Datos de la tarea">
          <Select
            label="Cliente"
            name="accountId"
            onChange={(event) => {
              setAccountId(event.currentTarget.value);
              setVisitId("");
            }}
            required
            value={accountId}
          >
            <option value="">Selecciona un cliente</option>
            {state.data?.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}
              </option>
            ))}
          </Select>
          <Select
            label="Visita vinculada (opcional)"
            name="visitId"
            onChange={(event) => setVisitId(event.currentTarget.value)}
            value={visitId}
          >
            <option value="">Sin visita</option>
            {visitsState.data?.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.reason}
              </option>
            ))}
          </Select>
          <Input defaultValue={task?.title} label="Título" name="title" required />
          <Textarea defaultValue={task?.description ?? ""} label="Descripción" name="description" />
          {user?.role === "MANAGER" ? (
            <Select
              defaultValue={task?.responsibleUserId}
              label="Responsable"
              name="responsibleUserId"
              required
            >
              <option value="">Selecciona responsable</option>
              {state.data?.users.map((responsible) => (
                <option key={responsible.id} value={responsible.id}>
                  {responsible.fullName}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Input disabled label="Responsable" value={user?.fullName} />
              <input name="responsibleUserId" type="hidden" value={user?.id} />
            </>
          )}
          <Input
            defaultValue={task?.dueDate}
            label="Fecha de vencimiento"
            name="dueDate"
            required
            type="date"
          />
          {taskId ? (
            <Input
              defaultValue={task?.dueTime?.slice(0, 5) ?? ""}
              help="Opcional"
              label="Hora"
              name="dueTime"
              type="time"
            />
          ) : null}
          <input name="timezone" type="hidden" value={task?.timezone ?? detectedZone} />
          <Select defaultValue={task?.priority ?? "MEDIUM"} label="Prioridad" name="priority">
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
          </Select>
        </FormSection>
        <StickyActionBar>
          <ButtonLink href={taskId ? `/app/tasks/${taskId}` : "/app/tasks"} variant="secondary">
            Cancelar
          </ButtonLink>
          <Button loading={busy} loadingLabel="Guardando tarea" type="submit">
            Guardar tarea
          </Button>
        </StickyActionBar>
      </form>
    </LoadBoundary>
  );
}
