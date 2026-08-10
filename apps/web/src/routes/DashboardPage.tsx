import { ButtonLink, Card, PriorityBadge, StatCard, StatusBadge } from "@vicam/ui";
import { Plus } from "lucide-react";
import { api, unwrap } from "../api/api";
import { useAsync } from "../api/useAsync";
import { useSession } from "../app/session";
import { formatDateTime, LoadBoundary } from "./shared";

export function DashboardPage() {
  const { user } = useSession();
  const state = useAsync(async () => {
    const [visits, tasks] = await Promise.all([
      api.GET("/visits", { params: { query: { page: 1, pageSize: 8, status: "PENDING" } } }),
      api.GET("/tasks", { params: { query: { page: 1, pageSize: 8 } } }),
    ]);
    return { visits: unwrap(visits).items, tasks: unwrap(tasks).items };
  }, []);
  const visits = state.data?.visits ?? [];
  const tasks = state.data?.tasks ?? [];
  const overdue = tasks.filter((task) => task.overdue && task.status !== "COMPLETED");
  return (
    <>
      <div className="dashboard-kpis">
        <StatCard label="Visitas próximas" value={visits.length} detail="Agenda operativa" />
        <StatCard label="Tareas vencidas" value={overdue.length} detail="Requieren seguimiento" />
        <StatCard
          label={user?.role === "MANAGER" ? "Equipo activo" : "Clientes asignados"}
          value={user?.role === "MANAGER" ? "En línea" : "Mi alcance"}
        />
        <StatCard label="Conexión" value="Online" detail="Datos actuales" />
      </div>
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        <div className="dashboard-grid">
          <Card title={user?.role === "MANAGER" ? "Agenda inmediata" : "Mi próxima visita"}>
            {visits.length ? (
              <ul className="entity-list">
                {visits.slice(0, 4).map((visit) => (
                  <li key={visit.id}>
                    <div>
                      <strong>{visit.accountDisplayName}</strong>
                      <span>{formatDateTime(visit.scheduledAt, "America/Guayaquil")}</span>
                    </div>
                    <PriorityBadge priority={visit.priority} />
                    <ButtonLink href={`/app/visits/${visit.id}`} variant="secondary">
                      Ver
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No tienes visitas próximas.</p>
            )}
          </Card>
          <Card title="Tareas prioritarias">
            {overdue.length ? (
              <ul className="entity-list">
                {overdue.slice(0, 4).map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.accountDisplayName}</span>
                    </div>
                    <StatusBadge tone="danger">Vencida</StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Todo está al día.</p>
            )}
          </Card>
        </div>
      </LoadBoundary>
      <div className="quick-actions">
        <ButtonLink href="/app/accounts/new">Nuevo cliente</ButtonLink>
        <ButtonLink href="/app/visits/new" variant="secondary">
          <Plus aria-hidden="true" size={18} />
          Agendar cita
        </ButtonLink>
        <ButtonLink href="/app/tasks/new" variant="secondary">
          Nueva tarea
        </ButtonLink>
      </div>
    </>
  );
}
