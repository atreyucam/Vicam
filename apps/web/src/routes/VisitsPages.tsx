import type { Task, Visit, VisitDetail, VisitHistoryEvent } from "@vicam/contracts";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  ErrorSummary,
  FormSection,
  Input,
  PriorityBadge,
  SegmentedControl,
  Select,
  StatePanel,
  StatusBadge,
  StickyActionBar,
  Textarea,
  Timeline,
} from "@vicam/ui";
import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api, ApiError, unwrap } from "../api/api";
import { idempotencyParams, useIdempotencyKey } from "../api/idempotency";
import { useAsync } from "../api/useAsync";
import { useSession } from "../app/session";
import {
  isPendingOfflineValue,
  putOfflineEntity,
  readOfflineEntities,
  readOfflineEntity,
  removeOfflineEntity,
} from "../offline/entities";
import { withOfflineFallback } from "../offline/loaders";
import { runStructuredMutation } from "../offline/mutations";
import type { CommercialAccount } from "@vicam/contracts";
import {
  addCivilDays,
  formatInstantInZone,
  todayInZone,
  toDateTimeLocalValue,
  zonedDateTimeToIso,
} from "../lib/timezone";
import { formValue, formatDate, formatDateTime, go, LoadBoundary } from "./shared";

const statusLabel = {
  PENDING: "Pendiente",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;

const taskStatusLabel = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;

const resultLabel = {
  INTERESTED: "Interesado",
  FOLLOW_UP_REQUIRED: "Requiere seguimiento",
  PROPOSAL_REQUESTED: "Propuesta solicitada",
  NEGOTIATION: "Negociación",
  NOT_INTERESTED: "Sin interés",
  NO_RESULT: "Sin resultado",
} as const;

const appTimezone = "America/Guayaquil";

function startOfCivilWeek(date: string) {
  const instant = new Date(`${date}T12:00:00Z`);
  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  return addCivilDays(date, -daysSinceMonday);
}

function startOfCivilMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function addCivilMonths(date: string, months: number) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

function offlineVisitDetail(visit: Visit): VisitDetail {
  return {
    ...visit,
    createdAt: visit.scheduledAt,
    createdByFullName: null,
    completedAt: visit.actualEndedAt,
    completedByFullName: null,
    cancelledAt: null,
    cancelledByFullName: null,
    history: [
      {
        id: `offline-created:${visit.id}`,
        type: "CREATED",
        occurredAt: visit.scheduledAt,
        actorUserId: null,
        actorFullName: null,
        scheduledAt: visit.scheduledAt,
        oldScheduledAt: null,
        newScheduledAt: null,
        reason: null,
        result: null,
      },
    ],
  };
}

function historyTitle(event: VisitHistoryEvent) {
  return {
    CREATED: "Visita agendada",
    RESCHEDULED: "Reprogramada",
    COMPLETED: "Completada",
    CANCELLED: "Cancelada",
  }[event.type];
}

function historyDetail(event: VisitHistoryEvent) {
  const details = [formatDateTime(event.occurredAt, appTimezone)];
  if (event.type === "CREATED" && event.scheduledAt)
    details.push(`Programada para ${formatDateTime(event.scheduledAt, appTimezone)}`);
  if (event.type === "RESCHEDULED" && event.oldScheduledAt && event.newScheduledAt)
    details.push(
      `${formatDateTime(event.oldScheduledAt, appTimezone)} → ${formatDateTime(event.newScheduledAt, appTimezone)}`,
    );
  if (event.result) details.push(`Resultado: ${resultLabel[event.result]}`);
  if (event.reason) details.push(`Motivo: ${event.reason}`);
  if (event.actorFullName) details.push(`Por: ${event.actorFullName}`);
  return details.join(" · ");
}

export function AgendaPage() {
  const desktop = window.innerWidth >= 1024;
  const [view, setView] = useState(desktop ? "week" : "day");
  const timezone = appTimezone;
  const today = todayInZone(timezone);
  const [selectedDate, setSelectedDate] = useState(today);
  const monthStart = startOfCivilMonth(selectedDate);
  const weekStart = startOfCivilWeek(selectedDate);
  const periodDays = view === "week" || (view === "list" && desktop) ? 7 : 1;
  const rangeStart = view === "month" ? monthStart : periodDays === 7 ? weekStart : selectedDate;
  const rangeEnd =
    view === "month" ? addCivilMonths(monthStart, 1) : addCivilDays(rangeStart, periodDays);
  const from = zonedDateTimeToIso(`${rangeStart}T00:00`, timezone);
  const to = zonedDateTimeToIso(`${rangeEnd}T00:00`, timezone);
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () => {
          const page = unwrap(
            await api.GET("/visits", {
              params: {
                query: { page: 1, pageSize: 100, from, to },
              },
            }),
          );
          await Promise.all(
            page.items.map((visit) =>
              visit.status === "PENDING"
                ? putOfflineEntity({
                    accountId: visit.accountId,
                    entityId: visit.id,
                    entityType: "VISIT",
                    value: visit,
                    version: visit.version,
                  })
                : removeOfflineEntity("VISIT", visit.id),
            ),
          );
          return page;
        },
        async () => {
          const stored = await readOfflineEntities<Visit>(
            "VISIT",
            (visit) =>
              visit.status === "PENDING" && visit.scheduledAt >= from && visit.scheduledAt < to,
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
    [from, to],
  );
  const visits = state.data?.items ?? [];
  const visibleVisits =
    view === "month"
      ? visits.filter(
          (visit) =>
            toDateTimeLocalValue(visit.scheduledAt, timezone).slice(0, 10) === selectedDate,
        )
      : visits;
  const monthGridStart = startOfCivilWeek(monthStart);
  const monthGridEnd = startOfCivilWeek(addCivilDays(rangeEnd, 6));
  const monthGridDays = Math.round(
    (new Date(`${monthGridEnd}T12:00:00Z`).getTime() -
      new Date(`${monthGridStart}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  return (
    <>
      <div className="agenda-toolbar">
        <SegmentedControl
          label="Vista de agenda"
          onChange={setView}
          options={
            desktop
              ? [
                  { label: "Semana", value: "week" },
                  { label: "Mes", value: "month" },
                  { label: "Lista", value: "list" },
                ]
              : [
                  { label: "Día", value: "day" },
                  { label: "Mes", value: "month" },
                  { label: "Lista", value: "list" },
                ]
          }
          value={view}
        />
        <ButtonLink href="/app/visits/new">
          <Plus aria-hidden="true" size={18} />
          Agendar cita
        </ButtonLink>
      </div>
      <div className="agenda-period-navigation" aria-label="Navegar por la agenda">
        <Button
          aria-label={
            view === "month"
              ? "Mes anterior"
              : periodDays === 7
                ? "Semana anterior"
                : "Día anterior"
          }
          onClick={() =>
            setSelectedDate((date) =>
              view === "month" ? addCivilMonths(date, -1) : addCivilDays(date, -periodDays),
            )
          }
          variant="secondary"
        >
          <ChevronLeft aria-hidden="true" size={18} />
        </Button>
        <Button onClick={() => setSelectedDate(today)} variant="ghost">
          Hoy
        </Button>
        <strong aria-live="polite">
          {formatInstantInZone(zonedDateTimeToIso(`${selectedDate}T12:00`, timezone), timezone, {
            ...(view === "month" ? { month: "long", year: "numeric" } : { dateStyle: "long" }),
          })}
        </strong>
        <Button
          aria-label={
            view === "month"
              ? "Mes siguiente"
              : periodDays === 7
                ? "Semana siguiente"
                : "Día siguiente"
          }
          onClick={() =>
            setSelectedDate((date) =>
              view === "month" ? addCivilMonths(date, 1) : addCivilDays(date, periodDays),
            )
          }
          variant="secondary"
        >
          <ChevronRight aria-hidden="true" size={18} />
        </Button>
      </div>
      {view === "month" ? (
        <div className="month-calendar" aria-label="Calendario mensual">
          {Array.from({ length: 7 }, (_, index) => (
            <span className="month-weekday" key={index}>
              {new Intl.DateTimeFormat("es-EC", { weekday: "short", timeZone: "UTC" }).format(
                new Date(Date.UTC(2026, 7, 3 + index)),
              )}
            </span>
          ))}
          {Array.from({ length: monthGridDays }, (_, index) => {
            const date = addCivilDays(monthGridStart, index);
            const count = visits.filter(
              (visit) => toDateTimeLocalValue(visit.scheduledAt, timezone).slice(0, 10) === date,
            ).length;
            return (
              <button
                aria-label={`${date}${count ? `, ${count} visitas` : ", sin visitas"}`}
                aria-pressed={date === selectedDate}
                className={date.slice(0, 7) === monthStart.slice(0, 7) ? "" : "outside-month"}
                key={date}
                onClick={() => setSelectedDate(date)}
                type="button"
              >
                <strong>{Number(date.slice(-2))}</strong>
                <small>{count ? `${count} ${count === 1 ? "cita" : "citas"}` : ""}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="date-strip" aria-label="Fechas de agenda">
          {Array.from({ length: 7 }, (_, index) => {
            const date = addCivilDays(weekStart, index);
            const dateInstant = new Date(`${date}T12:00:00Z`);
            return (
              <button
                aria-label={formatInstantInZone(
                  zonedDateTimeToIso(`${date}T12:00`, timezone),
                  timezone,
                  { dateStyle: "full" },
                )}
                aria-pressed={date === selectedDate}
                key={date}
                onClick={() => setSelectedDate(date)}
                type="button"
              >
                <span>
                  {new Intl.DateTimeFormat("es-EC", { weekday: "short", timeZone: "UTC" }).format(
                    dateInstant,
                  )}
                </span>
                <strong>{Number(date.slice(-2))}</strong>
              </button>
            );
          })}
        </div>
      )}
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        {visibleVisits.length ? (
          <div className="agenda-layout">
            <ol className="agenda-list">
              {visibleVisits.map((visit) => (
                <li key={visit.id}>
                  <a
                    aria-label={`Abrir visita de ${visit.accountDisplayName}`}
                    className="agenda-row-link"
                    href={`/app/visits/${visit.id}`}
                  >
                    <time dateTime={visit.scheduledAt}>
                      {formatInstantInZone(visit.scheduledAt, timezone, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <Card>
                      <div className="visit-card">
                        <div>
                          <strong>{visit.accountDisplayName}</strong>
                          <span>{visit.reason}</span>
                          <small>{visit.responsibleFullName}</small>
                        </div>
                        <PriorityBadge priority={visit.priority} />
                        <StatusBadge
                          tone={
                            visit.status === "PENDING"
                              ? "warning"
                              : visit.status === "COMPLETED"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {statusLabel[visit.status]}
                        </StatusBadge>
                        {isPendingOfflineValue(visit) ? (
                          <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
                        ) : null}
                      </div>
                    </Card>
                  </a>
                </li>
              ))}
            </ol>
            <aside className="agenda-aside">
              <strong>
                {view === "month" ? "Día seleccionado" : view === "week" ? "Esta semana" : "Hoy"}
              </strong>
              <p>{visibleVisits.length} visitas visibles según tu alcance.</p>
            </aside>
          </div>
        ) : (
          <StatePanel
            kind="empty"
            title={
              view === "month"
                ? "No hay visitas en el día seleccionado"
                : "No hay visitas en este periodo"
            }
          >
            <p>
              {view === "month"
                ? "Selecciona otro día del mes o agenda una visita."
                : "Agenda una visita o cambia el rango."}
            </p>
            <ButtonLink href="/app/visits/new">
              <Plus aria-hidden="true" size={18} />
              Agendar cita
            </ButtonLink>
          </StatePanel>
        )}
      </LoadBoundary>
    </>
  );
}

export function VisitFormPage() {
  const { user } = useSession();
  const timezone = appTimezone;
  const queryAccount = new URLSearchParams(window.location.search).get("accountId") ?? "";
  const [accountId, setAccountId] = useState(queryAccount);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useIdempotencyKey();
  const [localVisitId] = useState(() => crypto.randomUUID());
  const state = useAsync(async () => {
    const [accounts, users] = await Promise.all([
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
    return { accounts: accounts.items, users: users ? unwrap(users).items : user ? [user] : [] };
  }, [user?.role]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const required = ["accountId", "responsibleUserId", "scheduledAt", "reason"];
    const missing = required.filter((key) => !data.get(key));
    if (missing.length) {
      setErrors(["Completa cliente, responsable, fecha y motivo."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const payload = {
        accountId: formValue(data, "accountId"),
        responsibleUserId: formValue(data, "responsibleUserId"),
        scheduledAt: zonedDateTimeToIso(
          formValue(data, "scheduledAt"),
          formValue(data, "timezone"),
        ),
        timezone: formValue(data, "timezone"),
        reason: formValue(data, "reason"),
        priority: formValue(data, "priority") as "LOW" | "MEDIUM" | "HIGH",
        notes: formValue(data, "notes") || null,
      };
      const account = state.data?.accounts.find((item) => item.id === payload.accountId);
      const localValue: Visit = {
        ...payload,
        id: localVisitId,
        accountDisplayName: account?.displayName ?? "Cliente",
        responsibleFullName:
          user?.role === "SUPERVISOR"
            ? user.fullName
            : (state.data?.users.find((item) => item.id === payload.responsibleUserId)?.fullName ??
              "Responsable"),
        status: "PENDING",
        result: null,
        observation: null,
        actualStartedAt: null,
        actualEndedAt: null,
        cancellationReason: null,
        version: 1,
      };
      const saved = (
        await runStructuredMutation<Visit>({
          accountId: payload.accountId,
          action: "CREATE",
          baseVersion: null,
          changedFields: Object.keys(payload),
          clientOperationId: idempotencyKey,
          dependencyEntities: [{ entityId: payload.accountId, entityType: "ACCOUNT" }],
          entityId: localVisitId,
          entityType: "VISIT",
          localValue,
          online: async () =>
            unwrap(
              await api.POST("/visits", {
                params: idempotencyParams(idempotencyKey),
                body: payload,
              }),
            ),
          payload,
        })
      ).value;
      go(`/app/visits/${saved.id}`);
    } catch (reason) {
      setErrors([reason instanceof ApiError ? reason.message : "No pudimos agendar la visita."]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      <form className="entity-form" onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} />
        <FormSection title="Datos de la visita">
          <Select
            label="Cliente"
            name="accountId"
            onChange={(event) => setAccountId(event.currentTarget.value)}
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
          {user?.role === "MANAGER" ? (
            <Select label="Responsable" name="responsibleUserId" required>
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
          <Input label="Fecha y hora" name="scheduledAt" required type="datetime-local" />
          <input name="timezone" type="hidden" value={timezone} />
          <Select defaultValue="MEDIUM" label="Prioridad" name="priority">
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
          </Select>
          <Textarea label="Motivo" name="reason" required />
          <Textarea label="Notas" name="notes" />
        </FormSection>
        <StickyActionBar>
          <ButtonLink href="/app/agenda" variant="secondary">
            Cancelar
          </ButtonLink>
          <Button loading={busy} loadingLabel="Agendando" type="submit">
            <Plus aria-hidden="true" size={18} />
            Agendar cita
          </Button>
        </StickyActionBar>
      </form>
    </LoadBoundary>
  );
}

export function VisitDetailPage({ action, visitId }: { action?: "complete"; visitId: string }) {
  const state = useAsync(
    async () =>
      Promise.all([
        withOfflineFallback(
          async () => {
            const visit = unwrap(
              await api.GET("/visits/{id}", { params: { path: { id: visitId } } }),
            );
            if (visit.status === "PENDING")
              await putOfflineEntity({
                accountId: visit.accountId,
                entityId: visit.id,
                entityType: "VISIT",
                value: visit,
                version: visit.version,
              });
            else await removeOfflineEntity("VISIT", visit.id);
            return visit;
          },
          async () => {
            const visit = await readOfflineEntity<Visit>("VISIT", visitId);
            return visit ? offlineVisitDetail(visit) : null;
          },
        ),
        withOfflineFallback(
          async () =>
            unwrap(
              await api.GET("/tasks", {
                params: { query: { page: 1, pageSize: 100, visitId } },
              }),
            ).items,
          () => readOfflineEntities<Task>("TASK", (task) => task.visitId === visitId),
        ),
      ]).then(([visit, tasks]) => ({ visit, tasks })),
    [visitId],
  );
  const [dialog, setDialog] = useState<"reschedule" | "cancel" | null>(null);
  if (action === "complete") return <CompleteVisitPage visitId={visitId} />;
  const visit = state.data?.visit;
  const tasks = state.data?.tasks ?? [];
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {visit ? (
        <>
          <div className="detail-hero visit-detail-hero">
            <div>
              <StatusBadge
                tone={
                  visit.status === "PENDING"
                    ? "warning"
                    : visit.status === "COMPLETED"
                      ? "success"
                      : "neutral"
                }
              >
                {statusLabel[visit.status]}
              </StatusBadge>
              {isPendingOfflineValue(visit) ? (
                <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
              ) : null}
              <p>
                <a href={`/app/accounts/${visit.accountId}`}>{visit.accountDisplayName}</a>
              </p>
              <span>{formatDateTime(visit.scheduledAt, appTimezone)}</span>
              <span>
                {visit.responsibleFullName} · <PriorityBadge priority={visit.priority} />
              </span>
            </div>
            {visit.status === "PENDING" ? (
              <div>
                <ButtonLink href={`/app/visits/${visitId}/complete`}>Completar</ButtonLink>
                <Button onClick={() => setDialog("reschedule")} variant="secondary">
                  Reprogramar
                </Button>
                <Button onClick={() => setDialog("cancel")} variant="danger">
                  Cancelar visita
                </Button>
              </div>
            ) : visit.status === "COMPLETED" ? (
              <ButtonLink href={`/app/tasks/new?accountId=${visit.accountId}&visitId=${visit.id}`}>
                Crear tarea relacionada
              </ButtonLink>
            ) : null}
          </div>
          <div className="visit-detail-layout">
            <div className="visit-detail-main">
              <Card title="Motivo de la visita">
                <p>{visit.reason}</p>
              </Card>
              <Card title="Notas / preparación">
                <p>{visit.notes ?? "Sin notas de preparación."}</p>
              </Card>
              {visit.status === "COMPLETED" ? (
                <Card title="Cierre comercial">
                  <dl className="detail-list">
                    <div>
                      <dt>Resultado</dt>
                      <dd>{visit.result ? resultLabel[visit.result] : "Sin resultado"}</dd>
                    </div>
                    <div>
                      <dt>Observación / resumen</dt>
                      <dd>{visit.observation ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Inicio real</dt>
                      <dd>
                        {visit.actualStartedAt
                          ? formatDateTime(visit.actualStartedAt, appTimezone)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Fin real</dt>
                      <dd>
                        {visit.actualEndedAt
                          ? formatDateTime(visit.actualEndedAt, appTimezone)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Completada por</dt>
                      <dd>{visit.completedByFullName ?? "—"}</dd>
                    </div>
                  </dl>
                </Card>
              ) : null}
              {visit.status === "CANCELLED" ? (
                <Card title="Cancelación">
                  <dl className="detail-list">
                    <div>
                      <dt>Motivo de cancelación</dt>
                      <dd>{visit.cancellationReason ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Cancelada</dt>
                      <dd>
                        {visit.cancelledAt ? formatDateTime(visit.cancelledAt, appTimezone) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Por</dt>
                      <dd>{visit.cancelledByFullName ?? "—"}</dd>
                    </div>
                  </dl>
                </Card>
              ) : null}
            </div>
            <aside className="visit-detail-history">
              <Card title="Historial">
                <Timeline
                  items={[
                    ...visit.history.map((event) => ({
                      title: historyTitle(event),
                      detail: historyDetail(event),
                      state: "done" as const,
                    })),
                    ...(visit.status === "PENDING"
                      ? [
                          {
                            title: "Pendiente",
                            detail: `Programada para ${formatDateTime(visit.scheduledAt, appTimezone)}`,
                            state: "current" as const,
                          },
                        ]
                      : []),
                  ]}
                />
              </Card>
            </aside>
          </div>
          <Card
            actions={
              <ButtonLink href={`/app/tasks/new?accountId=${visit.accountId}&visitId=${visit.id}`}>
                <Plus aria-hidden="true" size={18} />
                Crear tarea
              </ButtonLink>
            }
            title="Tareas relacionadas"
          >
            {tasks.length ? (
              <div className="task-list visit-related-tasks">
                {tasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <div>
                      <a href={`/app/tasks/${task.id}`}>
                        <strong>{task.title}</strong>
                      </a>
                      <span>
                        Vence {formatDate(task.dueDate)} · {task.responsibleFullName}
                      </span>
                    </div>
                    <PriorityBadge priority={task.priority} />
                    <StatusBadge
                      tone={
                        task.overdue
                          ? "danger"
                          : task.status === "COMPLETED"
                            ? "success"
                            : task.status === "CANCELLED"
                              ? "neutral"
                              : "warning"
                      }
                    >
                      {task.overdue ? "Vencida" : taskStatusLabel[task.status]}
                    </StatusBadge>
                    <ButtonLink href={`/app/tasks/${task.id}`} variant="secondary">
                      Ver
                    </ButtonLink>
                  </article>
                ))}
              </div>
            ) : (
              <div className="visit-related-tasks-empty">
                <p>No hay tareas de seguimiento vinculadas.</p>
              </div>
            )}
          </Card>
          {dialog ? (
            <VisitActionDialog
              action={dialog}
              onClose={() => setDialog(null)}
              onUpdated={() => {
                setDialog(null);
                state.reload();
              }}
              visit={visit}
            />
          ) : null}
        </>
      ) : null}
    </LoadBoundary>
  );
}

function VisitActionDialog({
  action,
  onClose,
  onUpdated,
  visit,
}: {
  action: "reschedule" | "cancel";
  onClose: () => void;
  onUpdated: () => void;
  visit: Visit;
}) {
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useIdempotencyKey();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = formValue(data, "reason");
    if (!reason) {
      setError(["El motivo es obligatorio."]);
      return;
    }
    setBusy(true);
    try {
      if (action === "reschedule")
        await (() => {
          const payload = {
            scheduledAt: zonedDateTimeToIso(formValue(data, "scheduledAt"), visit.timezone),
            timezone: visit.timezone,
            reason,
            version: visit.version,
          };
          return runStructuredMutation<Visit>({
            accountId: visit.accountId,
            action: "RESCHEDULE",
            baseVersion: visit.version,
            changedFields: ["scheduledAt", "timezone"],
            clientOperationId: idempotencyKey,
            entityId: visit.id,
            entityType: "VISIT",
            localValue: { ...visit, scheduledAt: payload.scheduledAt },
            online: async () =>
              unwrap(
                await api.POST("/visits/{id}/reschedule", {
                  params: { path: { id: visit.id }, ...idempotencyParams(idempotencyKey) },
                  body: payload,
                }),
              ),
            payload,
          });
        })();
      else
        await (() => {
          const payload = { reason, version: visit.version };
          return runStructuredMutation<Visit>({
            accountId: visit.accountId,
            action: "CANCEL",
            baseVersion: visit.version,
            changedFields: ["status", "cancellationReason"],
            clientOperationId: idempotencyKey,
            entityId: visit.id,
            entityType: "VISIT",
            localValue: { ...visit, status: "CANCELLED", cancellationReason: reason },
            online: async () =>
              unwrap(
                await api.POST("/visits/{id}/cancel", {
                  params: { path: { id: visit.id }, ...idempotencyParams(idempotencyKey) },
                  body: payload,
                }),
              ),
            payload,
          });
        })();
      onUpdated();
    } catch (reasonError) {
      setError([
        reasonError instanceof ApiError ? reasonError.message : "No pudimos actualizar la visita.",
      ]);
      setBusy(false);
    }
  }
  return (
    <Dialog
      description={`${visit.accountDisplayName} · ${formatDateTime(visit.scheduledAt, visit.timezone)}`}
      onClose={onClose}
      title={action === "reschedule" ? "Reprogramar visita" : "Cancelar visita"}
    >
      <form onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={error} />
        {action === "reschedule" ? (
          <Input
            data-dialog-initial-focus
            defaultValue={toDateTimeLocalValue(visit.scheduledAt, visit.timezone)}
            label="Nueva fecha y hora"
            name="scheduledAt"
            required
            type="datetime-local"
          />
        ) : null}
        <Textarea
          data-dialog-initial-focus={action === "cancel" || undefined}
          label="Motivo"
          name="reason"
          required
        />
        <p className="help-text">Los recordatorios pendientes se actualizarán con esta acción.</p>
        <div className="modal-actions">
          <Button onClick={onClose} variant="secondary">
            Volver
          </Button>
          <Button loading={busy} type="submit" variant={action === "cancel" ? "danger" : "primary"}>
            {action === "reschedule" ? "Confirmar reprogramación" : "Confirmar cancelación"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CompleteVisitPage({ visitId }: { visitId: string }) {
  const { user } = useSession();
  const state = useAsync(async () => {
    const [visit, usersResponse] = await Promise.all([
      withOfflineFallback(
        async () => unwrap(await api.GET("/visits/{id}", { params: { path: { id: visitId } } })),
        async () => {
          const offlineVisit = await readOfflineEntity<Visit>("VISIT", visitId);
          return offlineVisit ? offlineVisitDetail(offlineVisit) : null;
        },
      ),
      user?.role === "MANAGER" && navigator.onLine
        ? api.GET("/users", { params: { query: { page: 1, pageSize: 100, status: "ACTIVE" } } })
        : Promise.resolve(null),
    ]);
    return {
      visit,
      users: usersResponse ? unwrap(usersResponse).items : user ? [user] : [],
    };
  }, [visitId, user?.role]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [followUpTaskId] = useState(() => crypto.randomUUID());
  const idempotencyKey = useIdempotencyKey();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const observation = formValue(data, "observation");
    const result = formValue(data, "result") as keyof typeof resultLabel;
    const actualEndedAt = formValue(data, "actualEndedAt");
    const followUpTitle = formValue(data, "followUpTitle");
    const followUpResponsibleUserId = formValue(data, "followUpResponsibleUserId");
    const followUpDueDate = formValue(data, "followUpDueDate");
    if (!result || !observation || !actualEndedAt) {
      setErrors(["Completa resultado, observación y fecha de finalización."]);
      return;
    }
    if (createFollowUp && (!followUpTitle || !followUpResponsibleUserId || !followUpDueDate)) {
      setErrors(["Completa título, responsable y vencimiento de la tarea de seguimiento."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const visit = state.data!.visit;
      const actualStartedAt = formValue(data, "actualStartedAt");
      const payload = {
        result,
        observation,
        actualStartedAt: actualStartedAt
          ? zonedDateTimeToIso(actualStartedAt, visit.timezone)
          : null,
        actualEndedAt: zonedDateTimeToIso(actualEndedAt, visit.timezone),
        followUpTask: createFollowUp
          ? {
              id: followUpTaskId,
              title: followUpTitle,
              responsibleUserId: followUpResponsibleUserId,
              dueDate: followUpDueDate,
              priority: formValue(data, "followUpPriority") as "LOW" | "MEDIUM" | "HIGH",
            }
          : null,
        version: visit.version,
      };
      const mutation = await runStructuredMutation<Visit>({
        accountId: visit.accountId,
        action: "COMPLETE",
        baseVersion: visit.version,
        changedFields: ["status", "result", "observation", "actualStartedAt", "actualEndedAt"],
        clientOperationId: idempotencyKey,
        entityId: visitId,
        entityType: "VISIT",
        localValue: {
          ...visit,
          status: "COMPLETED",
          result,
          observation,
          actualStartedAt: payload.actualStartedAt,
          actualEndedAt: payload.actualEndedAt,
        },
        online: async () =>
          unwrap(
            await api.POST("/visits/{id}/complete", {
              params: { path: { id: visitId }, ...idempotencyParams(idempotencyKey) },
              body: payload,
            }),
          ),
        payload,
      });
      if (mutation.pending && payload.followUpTask) {
        const responsible = state.data!.users.find(
          (candidate) => candidate.id === payload.followUpTask!.responsibleUserId,
        );
        await putOfflineEntity<Task>({
          accountId: visit.accountId,
          entityId: payload.followUpTask.id,
          entityType: "TASK",
          pending: true,
          value: {
            id: payload.followUpTask.id,
            accountId: visit.accountId,
            accountDisplayName: visit.accountDisplayName,
            visitId: visit.id,
            visitScheduledAt: visit.scheduledAt,
            visitReason: visit.reason,
            responsibleUserId: payload.followUpTask.responsibleUserId,
            responsibleFullName: responsible?.fullName ?? visit.responsibleFullName,
            title: payload.followUpTask.title,
            description: null,
            dueDate: payload.followUpTask.dueDate,
            dueTime: null,
            timezone: visit.timezone,
            priority: payload.followUpTask.priority,
            status: "PENDING",
            overdue: false,
            completedAt: null,
            version: 1,
          },
          version: 1,
        });
      }
      go(`/app/visits/${visitId}`);
    } catch (reason) {
      setErrors([reason instanceof ApiError ? reason.message : "No pudimos completar la visita."]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {state.data?.visit ? (
        <form className="entity-form" onSubmit={(event) => void submit(event)}>
          <ErrorSummary errors={errors} />
          <Card title={state.data.visit.accountDisplayName}>
            <p>
              {formatDateTime(state.data.visit.scheduledAt, appTimezone)} ·{" "}
              {state.data.visit.reason}
            </p>
          </Card>
          <FormSection title="Cierre de visita">
            <Select label="Resultado de la visita" name="result" required>
              <option value="">Selecciona un resultado</option>
              {Object.entries(resultLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Textarea label="Observación / resumen" name="observation" required />
            <Input
              help="Opcional"
              label="Inicio real"
              name="actualStartedAt"
              type="datetime-local"
            />
            <Input
              defaultValue={toDateTimeLocalValue(
                new Date().toISOString(),
                state.data.visit.timezone,
              )}
              label="Fecha y hora real de finalización"
              name="actualEndedAt"
              required
              type="datetime-local"
            />
          </FormSection>
          <FormSection
            description="La tarea heredará automáticamente el cliente y esta visita."
            title="Seguimiento"
          >
            <label className="checkbox">
              <input
                checked={createFollowUp}
                name="createFollowUp"
                onChange={(event) => setCreateFollowUp(event.currentTarget.checked)}
                type="checkbox"
              />
              Crear tarea de seguimiento
            </label>
            {createFollowUp ? (
              <div className="follow-up-fields">
                <Input label="Título" name="followUpTitle" required />
                {user?.role === "MANAGER" ? (
                  <Select
                    defaultValue={state.data.visit.responsibleUserId}
                    label="Responsable"
                    name="followUpResponsibleUserId"
                    required
                  >
                    <option value="">Selecciona responsable</option>
                    {state.data.users.map((responsible) => (
                      <option key={responsible.id} value={responsible.id}>
                        {responsible.fullName}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <Input disabled label="Responsable" value={user?.fullName} />
                    <input name="followUpResponsibleUserId" type="hidden" value={user?.id} />
                  </>
                )}
                <Input
                  defaultValue={addCivilDays(todayInZone(state.data.visit.timezone), 1)}
                  label="Fecha de vencimiento"
                  name="followUpDueDate"
                  required
                  type="date"
                />
                <Select defaultValue="MEDIUM" label="Prioridad" name="followUpPriority">
                  <option value="LOW">Baja</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                </Select>
              </div>
            ) : null}
          </FormSection>
          <StickyActionBar>
            <ButtonLink href={`/app/visits/${visitId}`} variant="secondary">
              Cancelar
            </ButtonLink>
            <Button loading={busy} loadingLabel="Guardando visita" type="submit">
              Guardar visita
            </Button>
          </StickyActionBar>
        </form>
      ) : null}
    </LoadBoundary>
  );
}
