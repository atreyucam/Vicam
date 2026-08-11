import type { CommercialAccount, ReportExport, User } from "@vicam/contracts";
import { Button, Card, Dialog, Input, Select, StatePanel, StatCard, StatusBadge } from "@vicam/ui";
import { Download, FileDown } from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { api, ApiError, unwrap } from "../api/api";
import { idempotencyParams, useIdempotencyKeyController } from "../api/idempotency";
import { useAsync } from "../api/useAsync";
import { useSession } from "../app/session";
import { addCivilDays, todayInZone } from "../lib/timezone";
import { formatDate, formatDateTime, LoadBoundary } from "./shared";
import "./reports.css";

const REPORT_TIMEZONE = "America/Guayaquil";
const reportViews = ["summary", "visits", "tasks", "accounts", "documents"] as const;
type ReportView = (typeof reportViews)[number];
type Period = "today" | "week" | "month" | "previous-month" | "last-30" | "custom";
type Kpi = { key: string; label: string; value: number; format: "NUMBER" | "PERCENT" };
type SeriesPoint = { key: string; label: string; value: number; secondaryValue?: number };
type DistributionPoint = { key: string; label: string; value: number };
type ResponsibleActivity = {
  userId: string;
  name: string;
  total: number;
  completed: number;
  open: number;
  overdue: number;
  compliancePercent: number | null;
};
type AttentionItem = {
  kind: "VISIT" | "TASK" | "ACCOUNT" | "DOCUMENT";
  id: string;
  title: string;
  detail: string;
  date: string | null;
  href: string;
};
type AnalyticsRow = {
  id: string;
  kind: "VISIT" | "TASK" | "ACCOUNT" | "DOCUMENT";
  title: string;
  date: string | null;
  accountName: string | null;
  responsibleName: string | null;
  status: string | null;
  priority: string | null;
  city: string | null;
  category: string | null;
  format: string | null;
  total: number | null;
  secondary: string | null;
  href: string;
};
type ReportAnalytics = {
  view: ReportView;
  kpis: Kpi[];
  trend: SeriesPoint[];
  distribution: DistributionPoint[];
  secondaryDistribution: DistributionPoint[];
  responsibleActivity: ResponsibleActivity[];
  attention: AttentionItem[];
  rows: AnalyticsRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type AnalyticsQuery = {
  from?: string;
  to?: string;
  timezone: typeof REPORT_TIMEZONE;
  responsibleUserId?: string;
  accountId?: string;
  city?: string;
  visitStatus?: "PENDING" | "COMPLETED" | "CANCELLED";
  taskStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  overdue?: string;
  accountStatus?: "ACTIVE" | "ARCHIVED";
  categoryId?: string;
  documentStatus?: "QUARANTINED" | "SCANNING" | "AVAILABLE" | "REJECTED" | "DELETED";
  page: number;
  pageSize: number;
};
const viewLabels: Record<ReportView, string> = {
  summary: "Resumen",
  visits: "Visitas",
  tasks: "Tareas",
  accounts: "Clientes",
  documents: "Documentos",
};
const exportGroups = {
  summary: ["MANAGEMENT", "kpis"],
  visits: ["VISITS", "agenda"],
  tasks: ["TASKS", "all"],
  accounts: ["ACCOUNTS", "directory"],
  documents: ["DOCUMENTS", "inventory"],
} as const;

function exportFilters(view: ReportView, filters: AnalyticsQuery) {
  const common = {
    from: filters.from,
    to: filters.to,
    responsibleUserId: filters.responsibleUserId,
    accountId: filters.accountId,
    city: filters.city,
  };
  if (view === "visits")
    return clean({ ...common, status: filters.visitStatus, priority: filters.priority });
  if (view === "tasks")
    return clean({
      ...common,
      status: filters.taskStatus,
      priority: filters.priority,
      overdue: filters.overdue === undefined ? undefined : filters.overdue === "true",
    });
  if (view === "accounts") return clean({ ...common, status: filters.accountStatus });
  if (view === "documents")
    return clean({ ...common, categoryId: filters.categoryId, status: filters.documentStatus });
  return clean(common);
}

function startOfWeek(date: string) {
  const instant = new Date(`${date}T12:00:00Z`);
  const mondayOffset = (instant.getUTCDay() + 6) % 7;
  return addCivilDays(date, -mondayOffset);
}

export function periodRange(period: Period, customFrom = "", customTo = "") {
  const today = todayInZone(REPORT_TIMEZONE);
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: startOfWeek(today), to: today };
  if (period === "month") return { from: monthStart, to: today };
  if (period === "last-30") return { from: addCivilDays(today, -29), to: today };
  if (period === "previous-month") {
    const previousLast = addCivilDays(monthStart, -1);
    return { from: `${previousLast.slice(0, 7)}-01`, to: previousLast };
  }
  return { from: customFrom || undefined, to: customTo || undefined };
}

function clean<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== "" && value !== undefined),
  );
}

function humanStatus(value: string | null) {
  if (!value) return "—";
  return (
    {
      PENDING: "Pendiente",
      IN_PROGRESS: "En progreso",
      COMPLETED: "Completado",
      CANCELLED: "Cancelado",
      ACTIVE: "Activo",
      ARCHIVED: "Archivado",
      AVAILABLE: "Disponible",
      QUARANTINED: "En cuarentena",
      SCANNING: "Analizando",
      REJECTED: "Rechazado",
      DELETED: "Eliminado",
      LOW: "Baja",
      MEDIUM: "Media",
      HIGH: "Alta",
    }[value] ?? value
  );
}

function statusTone(value: string | null): "neutral" | "success" | "warning" | "danger" {
  if (value === "COMPLETED" || value === "AVAILABLE" || value === "ACTIVE") return "success";
  if (value === "CANCELLED" || value === "REJECTED" || value === "DELETED") return "danger";
  if (value === "PENDING" || value === "IN_PROGRESS" || value === "SCANNING") return "warning";
  return "neutral";
}

export function ReportsPage({ exportsOnly = false }: { exportsOnly?: boolean }) {
  const { user } = useSession();
  const [view, setView] = useState<ReportView>("summary");
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [city, setCity] = useState("");
  const [visitStatus, setVisitStatus] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [overdue, setOverdue] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [documentStatus, setDocumentStatus] = useState("");
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const range = periodRange(period, customFrom, customTo);

  const catalogs = useAsync(async () => {
    const [accountsResponse, usersResponse, categoriesResponse] = await Promise.all([
      api.GET("/commercial-accounts", {
        params: {
          query: {
            page: 1,
            pageSize: 100,
            status: "ACTIVE",
            ...(accountSearch ? { search: accountSearch } : {}),
          },
        },
      }),
      user?.role === "MANAGER"
        ? api.GET("/users", { params: { query: { page: 1, pageSize: 100, status: "ACTIVE" } } })
        : Promise.resolve(null),
      api.GET("/document-categories"),
    ]);
    return {
      accounts: unwrap(accountsResponse).items,
      users: usersResponse ? unwrap(usersResponse).items : [],
      categories: unwrap(categoriesResponse),
    };
  }, [user?.role, accountSearch]);

  const query = useMemo(
    () =>
      clean({
        ...range,
        timezone: REPORT_TIMEZONE,
        responsibleUserId,
        accountId,
        city,
        visitStatus: view === "visits" ? visitStatus : undefined,
        taskStatus: view === "tasks" ? taskStatus : undefined,
        priority: view === "visits" || view === "tasks" ? priority : undefined,
        overdue: view === "tasks" && overdue ? overdue : undefined,
        accountStatus: view === "accounts" ? accountStatus : undefined,
        categoryId: view === "documents" ? categoryId : undefined,
        documentStatus: view === "documents" ? documentStatus : undefined,
        page,
        pageSize: 20,
      }) as AnalyticsQuery,
    [
      range.from,
      range.to,
      responsibleUserId,
      accountId,
      city,
      view,
      visitStatus,
      taskStatus,
      priority,
      overdue,
      accountStatus,
      categoryId,
      documentStatus,
      page,
    ],
  );
  const analytics = useAsync(async () => {
    const data = unwrap(
      await api.GET("/reports/analytics/{view}", {
        params: { path: { view }, query },
      }),
    );
    return data satisfies ReportAnalytics;
  }, [view, query]);
  const history = useAsync(
    async () =>
      unwrap(
        await api.GET("/reports/exports", {
          params: { query: { page: 1, pageSize: exportsOnly ? 100 : 5 } },
        }),
      ),
    [exportsOnly],
  );

  function resetContext(nextView: ReportView) {
    setView(nextView);
    setVisitStatus("");
    setTaskStatus("");
    setPriority("");
    setOverdue("");
    setAccountStatus("");
    setCategoryId("");
    setDocumentStatus("");
    setPage(1);
  }

  if (exportsOnly)
    return (
      <LoadBoundary {...history}>
        <ExportHistory items={history.data?.items ?? []} full />
      </LoadBoundary>
    );

  const summaryPermissionDenied =
    view === "summary" &&
    user?.role === "SUPERVISOR" &&
    analytics.error instanceof ApiError &&
    analytics.error.status === 403;
  return (
    <div className="reports-dashboard">
      <div className="reports-heading">
        {view !== "summary" || user?.role === "MANAGER" ? (
          <Button onClick={() => setExportOpen(true)} variant="secondary">
            <FileDown aria-hidden="true" size={18} />
            Exportar
          </Button>
        ) : null}
      </div>

      <ReportFilters
        accounts={catalogs.data?.accounts ?? []}
        accountId={accountId}
        accountSearch={accountSearch}
        city={city}
        customFrom={customFrom}
        customTo={customTo}
        onAccount={(value) => {
          setAccountId(value);
          setPage(1);
        }}
        onAccountSearch={setAccountSearch}
        onCity={(value) => {
          setCity(value);
          setPage(1);
        }}
        onCustomFrom={(value) => {
          setCustomFrom(value);
          setPage(1);
        }}
        onCustomTo={(value) => {
          setCustomTo(value);
          setPage(1);
        }}
        onPeriod={(value) => {
          setPeriod(value);
          setPage(1);
        }}
        onResponsible={(value) => {
          setResponsibleUserId(value);
          setPage(1);
        }}
        period={period}
        responsibleUserId={responsibleUserId}
        user={user}
        users={catalogs.data?.users ?? []}
      />

      <nav aria-label="Reportes disponibles" className="reports-tabs" role="tablist">
        {reportViews.map((item, index) => (
          <button
            aria-controls={`report-panel-${item}`}
            aria-selected={view === item}
            id={`report-tab-${item}`}
            key={item}
            onClick={() => resetContext(item)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const offset = event.key === "ArrowRight" ? 1 : -1;
              const next = reportViews[(index + offset + reportViews.length) % reportViews.length]!;
              resetContext(next);
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>(`#report-tab-${next}`)?.focus(),
              );
            }}
            role="tab"
            tabIndex={view === item ? 0 : -1}
            type="button"
          >
            {viewLabels[item]}
          </button>
        ))}
      </nav>

      <ContextFilters
        accountStatus={accountStatus}
        categories={catalogs.data?.categories ?? []}
        categoryId={categoryId}
        documentStatus={documentStatus}
        onChange={(field, value) => {
          setPage(1);
          if (field === "visitStatus") setVisitStatus(value);
          if (field === "taskStatus") setTaskStatus(value);
          if (field === "priority") setPriority(value);
          if (field === "overdue") setOverdue(value);
          if (field === "accountStatus") setAccountStatus(value);
          if (field === "categoryId") setCategoryId(value);
          if (field === "documentStatus") setDocumentStatus(value);
        }}
        overdue={overdue}
        priority={priority}
        taskStatus={taskStatus}
        view={view}
        visitStatus={visitStatus}
      />

      <div
        aria-labelledby={`report-tab-${view}`}
        id={`report-panel-${view}`}
        role="tabpanel"
        tabIndex={0}
      >
        {summaryPermissionDenied ? (
          <StatePanel kind="permission" title="Resumen disponible para Manager">
            <p>Selecciona Visitas, Tareas, Clientes o Documentos para consultar tu alcance.</p>
          </StatePanel>
        ) : (
          <LoadBoundary {...analytics}>
            {analytics.data ? <AnalyticsContent data={analytics.data} onPage={setPage} /> : null}
          </LoadBoundary>
        )}
      </div>

      <LoadBoundary {...history}>
        <ExportHistory items={history.data?.items ?? []} />
      </LoadBoundary>

      {exportOpen ? (
        <ExportDialog
          filters={query}
          onClose={() => setExportOpen(false)}
          onCreated={() => {
            setExportOpen(false);
            history.reload();
          }}
          view={view}
        />
      ) : null}
    </div>
  );
}

function ReportFilters({
  accounts,
  accountId,
  accountSearch,
  city,
  customFrom,
  customTo,
  onAccount,
  onAccountSearch,
  onCity,
  onCustomFrom,
  onCustomTo,
  onPeriod,
  onResponsible,
  period,
  responsibleUserId,
  user,
  users,
}: {
  accounts: CommercialAccount[];
  accountId: string;
  accountSearch: string;
  city: string;
  customFrom: string;
  customTo: string;
  onAccount: (value: string) => void;
  onAccountSearch: (value: string) => void;
  onCity: (value: string) => void;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  onPeriod: (value: Period) => void;
  onResponsible: (value: string) => void;
  period: Period;
  responsibleUserId: string;
  user: ReturnType<typeof useSession>["user"];
  users: User[];
}) {
  return (
    <section aria-label="Filtros del reporte" className="reports-filters">
      <Select
        label="Periodo"
        onChange={(event) => onPeriod(event.target.value as Period)}
        value={period}
      >
        <option value="today">Hoy</option>
        <option value="week">Esta semana</option>
        <option value="month">Este mes</option>
        <option value="previous-month">Mes anterior</option>
        <option value="last-30">Últimos 30 días</option>
        <option value="custom">Personalizado</option>
      </Select>
      {period === "custom" ? (
        <>
          <Input
            label="Desde"
            onChange={(event) => onCustomFrom(event.target.value)}
            type="date"
            value={customFrom}
          />
          <Input
            label="Hasta"
            onChange={(event) => onCustomTo(event.target.value)}
            type="date"
            value={customTo}
          />
        </>
      ) : null}
      {user?.role === "MANAGER" ? (
        <Select
          label="Responsable"
          onChange={(event) => onResponsible(event.target.value)}
          value={responsibleUserId}
        >
          <option value="">Todos los responsables</option>
          {users.map((responsible) => (
            <option key={responsible.id} value={responsible.id}>
              {responsible.fullName}
            </option>
          ))}
        </Select>
      ) : (
        <Input disabled label="Responsable" value={user?.fullName ?? "Mi alcance"} />
      )}
      <Input
        label="Buscar cliente"
        onChange={(event) => onAccountSearch(event.target.value)}
        placeholder="Buscar cliente..."
        type="search"
        value={accountSearch}
      />
      <Select label="Cliente" onChange={(event) => onAccount(event.target.value)} value={accountId}>
        <option value="">Todos los clientes</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName}
          </option>
        ))}
      </Select>
      <Input
        label="Ciudad"
        onChange={(event) => onCity(event.target.value)}
        placeholder="Todas las ciudades"
        value={city}
      />
    </section>
  );
}

type ContextField =
  | "visitStatus"
  | "taskStatus"
  | "priority"
  | "overdue"
  | "accountStatus"
  | "categoryId"
  | "documentStatus";
function ContextFilters(props: {
  view: ReportView;
  visitStatus: string;
  taskStatus: string;
  priority: string;
  overdue: string;
  accountStatus: string;
  categoryId: string;
  documentStatus: string;
  categories: Array<{ id: string; name: string; active: boolean }>;
  onChange: (field: ContextField, value: string) => void;
}) {
  if (props.view === "summary") return null;
  return (
    <section
      aria-label={`Filtros de ${viewLabels[props.view]}`}
      className="reports-context-filters"
    >
      {props.view === "visits" ? (
        <>
          <Select
            label="Estado de visita"
            onChange={(e) => props.onChange("visitStatus", e.target.value)}
            value={props.visitStatus}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendiente</option>
            <option value="COMPLETED">Completada</option>
            <option value="CANCELLED">Cancelada</option>
          </Select>
          <PriorityFilter onChange={props.onChange} value={props.priority} />
        </>
      ) : null}
      {props.view === "tasks" ? (
        <>
          <Select
            label="Estado de tarea"
            onChange={(e) => props.onChange("taskStatus", e.target.value)}
            value={props.taskStatus}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendiente</option>
            <option value="IN_PROGRESS">En progreso</option>
            <option value="COMPLETED">Completada</option>
            <option value="CANCELLED">Cancelada</option>
          </Select>
          <Select
            label="Vencimiento"
            onChange={(e) => props.onChange("overdue", e.target.value)}
            value={props.overdue}
          >
            <option value="">Todos</option>
            <option value="true">Vencidas</option>
            <option value="false">No vencidas</option>
          </Select>
          <PriorityFilter onChange={props.onChange} value={props.priority} />
        </>
      ) : null}
      {props.view === "accounts" ? (
        <Select
          label="Estado del cliente"
          onChange={(e) => props.onChange("accountStatus", e.target.value)}
          value={props.accountStatus}
        >
          <option value="">Todos</option>
          <option value="ACTIVE">Activo</option>
          <option value="ARCHIVED">Archivado</option>
        </Select>
      ) : null}
      {props.view === "documents" ? (
        <>
          <Select
            label="Categoría"
            onChange={(e) => props.onChange("categoryId", e.target.value)}
            value={props.categoryId}
          >
            <option value="">Todas</option>
            {props.categories
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </Select>
          <Select
            label="Estado del documento"
            onChange={(e) => props.onChange("documentStatus", e.target.value)}
            value={props.documentStatus}
          >
            <option value="">Todos</option>
            <option value="AVAILABLE">Disponible</option>
            <option value="SCANNING">Analizando</option>
            <option value="QUARANTINED">En cuarentena</option>
            <option value="REJECTED">Rechazado</option>
            <option value="DELETED">Eliminado</option>
          </Select>
        </>
      ) : null}
    </section>
  );
}

function PriorityFilter({
  onChange,
  value,
}: {
  onChange: (field: ContextField, value: string) => void;
  value: string;
}) {
  return (
    <Select label="Prioridad" onChange={(e) => onChange("priority", e.target.value)} value={value}>
      <option value="">Todas</option>
      <option value="LOW">Baja</option>
      <option value="MEDIUM">Media</option>
      <option value="HIGH">Alta</option>
    </Select>
  );
}

function AnalyticsContent({
  data,
  onPage,
}: {
  data: ReportAnalytics;
  onPage: (page: number) => void;
}) {
  const hasData =
    data.rows.length > 0 ||
    data.trend.length > 0 ||
    data.distribution.length > 0 ||
    data.kpis.some((item) => item.value > 0);
  if (!hasData)
    return (
      <StatePanel
        kind="no-results"
        title={`No hay ${viewLabels[data.view].toLocaleLowerCase("es")} para los filtros seleccionados.`}
      >
        <p>Prueba ampliando el periodo o quitando filtros.</p>
      </StatePanel>
    );
  return (
    <div className="reports-content">
      <section aria-label="Indicadores" className="reports-kpis">
        {data.kpis.map((item) => (
          <StatCard
            key={item.key}
            label={item.label}
            value={
              item.format === "PERCENT"
                ? `${item.value.toLocaleString("es-EC")}%`
                : item.value.toLocaleString("es-EC")
            }
          />
        ))}
      </section>
      <div className="reports-charts">
        <TrendChart points={data.trend} title="Actividad en el tiempo" />
        <DistributionChart points={data.distribution} title="Distribución principal" />
        {data.secondaryDistribution.length ? (
          <DistributionChart points={data.secondaryDistribution} title="Distribución secundaria" />
        ) : null}
      </div>
      {data.responsibleActivity.length ? (
        <ResponsibleTable items={data.responsibleActivity} />
      ) : null}
      {data.attention.length ? <Attention items={data.attention} /> : null}
      <AnalyticsTable data={data} onPage={onPage} />
    </div>
  );
}

function TrendChart({ points, title }: { points: SeriesPoint[]; title: string }) {
  if (!points.length) return <ChartEmpty title={title} />;
  const maximum = Math.max(...points.map((point) => point.value), 1);
  const coordinates = points
    .map(
      (point, index) =>
        `${points.length === 1 ? 50 : (index / (points.length - 1)) * 100},${96 - (point.value / maximum) * 86}`,
    )
    .join(" ");
  return (
    <Card title={title}>
      <figure className="reports-chart">
        <svg
          aria-label={`${title}: ${points.map((point) => `${point.label}, ${point.value}`).join("; ")}`}
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 100"
        >
          <polyline fill="none" points={coordinates} vectorEffect="non-scaling-stroke" />
        </svg>
        <figcaption>
          {points.map((point) => (
            <span key={point.key}>
              <strong>{point.value.toLocaleString("es-EC")}</strong>
              {point.label}
            </span>
          ))}
        </figcaption>
      </figure>
    </Card>
  );
}

function DistributionChart({ points, title }: { points: DistributionPoint[]; title: string }) {
  if (!points.length) return <ChartEmpty title={title} />;
  const maximum = Math.max(...points.map((point) => point.value), 1);
  return (
    <Card title={title}>
      <div
        className="reports-bars"
        role="img"
        aria-label={`${title}: ${points.map((point) => `${humanStatus(point.label)}, ${point.value}`).join("; ")}`}
      >
        {points.map((point) => (
          <div key={point.key}>
            <span>{humanStatus(point.label)}</span>
            <div>
              <i style={{ "--report-bar": `${(point.value / maximum) * 100}%` } as CSSProperties} />
            </div>
            <strong>{point.value.toLocaleString("es-EC")}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChartEmpty({ title }: { title: string }) {
  return (
    <Card title={title}>
      <StatePanel kind="no-results" title="Sin datos para graficar">
        <p>Ajusta los filtros para consultar actividad.</p>
      </StatePanel>
    </Card>
  );
}

function ResponsibleTable({ items }: { items: ResponsibleActivity[] }) {
  return (
    <Card title="Actividad por responsable">
      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Responsable</th>
              <th>Total</th>
              <th>Completadas</th>
              <th>Abiertas</th>
              <th>Vencidas</th>
              <th>Cumplimiento</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.userId}>
                <th scope="row">{item.name}</th>
                <td>{item.total}</td>
                <td>{item.completed}</td>
                <td>{item.open}</td>
                <td>{item.overdue}</td>
                <td>{item.compliancePercent === null ? "—" : `${item.compliancePercent}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <Card title="Requieren atención">
      <ul className="reports-attention">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <div>
              <a href={item.href}>{item.title}</a>
              <span>{item.detail}</span>
              {item.date ? <small>{formatDate(item.date.slice(0, 10))}</small> : null}
            </div>
            <StatusBadge tone="warning">Revisar</StatusBadge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AnalyticsTable({
  data,
  onPage,
}: {
  data: ReportAnalytics;
  onPage: (page: number) => void;
}) {
  if (!data.rows.length) return null;
  return (
    <Card title={`Detalle de ${viewLabels[data.view].toLocaleLowerCase("es")}`}>
      <div className="reports-table-wrap reports-table-desktop">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Registro</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Responsable</th>
              <th>Estado</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`}>
                <th scope="row">
                  <a href={row.href}>{row.title}</a>
                </th>
                <td>{row.date ? formatDate(row.date.slice(0, 10)) : "—"}</td>
                <td>{row.accountName ?? "—"}</td>
                <td>{row.responsibleName ?? "—"}</td>
                <td>
                  <StatusBadge tone={statusTone(row.status)}>{humanStatus(row.status)}</StatusBadge>
                </td>
                <td>
                  {[
                    row.city,
                    row.category,
                    row.format,
                    row.priority ? humanStatus(row.priority) : null,
                    row.total === null ? null : `${row.total} visitas`,
                    row.secondary,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="reports-row-cards">
        {data.rows.map((row) => (
          <article key={`${row.kind}-${row.id}`}>
            <a href={row.href}>
              <strong>{row.title}</strong>
            </a>
            <span>
              {[
                row.accountName,
                row.city,
                row.category,
                row.format,
                row.total === null ? null : `${row.total} visitas`,
                row.secondary,
              ]
                .filter(Boolean)
                .join(" · ") || "Sin detalle"}
            </span>
            <small>
              {row.date ? formatDate(row.date.slice(0, 10)) : "Sin fecha"}
              {row.responsibleName ? ` · ${row.responsibleName}` : ""}
            </small>
            <StatusBadge tone={statusTone(row.status)}>{humanStatus(row.status)}</StatusBadge>
          </article>
        ))}
      </div>
      {data.pagination.totalPages > 1 ? (
        <nav aria-label="Paginación del reporte" className="reports-pagination">
          <Button
            disabled={data.pagination.page <= 1}
            onClick={() => onPage(data.pagination.page - 1)}
            variant="secondary"
          >
            Anterior
          </Button>
          <span>
            Página {data.pagination.page} de {data.pagination.totalPages}
          </span>
          <Button
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => onPage(data.pagination.page + 1)}
            variant="secondary"
          >
            Siguiente
          </Button>
        </nav>
      ) : null}
    </Card>
  );
}

function ExportDialog({
  filters,
  onClose,
  onCreated,
  view,
}: {
  filters: AnalyticsQuery;
  onClose: () => void;
  onCreated: () => void;
  view: ReportView;
}) {
  const [format, setFormat] = useState<"PDF" | "XLSX">("PDF");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useIdempotencyKeyController();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [group, template] = exportGroups[view];
      unwrap(
        await api.POST("/reports/exports", {
          params: idempotencyParams(intent.current()),
          body: {
            group,
            template,
            format,
            filters: exportFilters(view, filters),
            timezone: REPORT_TIMEZONE,
          },
        }),
      );
      intent.rotate();
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos solicitar la exportación.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      description={`Se exportará ${viewLabels[view]} con el periodo y filtros visibles.`}
      onClose={onClose}
      title="Exportar reporte"
    >
      <form className="reports-export-form" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p className="reports-inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <Select
          data-dialog-initial-focus
          label="Formato"
          onChange={(event) => setFormat(event.target.value as typeof format)}
          value={format}
        >
          <option value="PDF">PDF</option>
          <option value="XLSX">Excel</option>
        </Select>
        <div>
          <Button onClick={onClose} variant="secondary">
            Cancelar
          </Button>
          <Button loading={busy} loadingLabel="Solicitando" type="submit">
            Exportar {format === "XLSX" ? "Excel" : "PDF"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ExportHistory({ items, full = false }: { items: ReportExport[]; full?: boolean }) {
  return (
    <Card
      actions={!full ? <a href="/app/reports/exports">Ver todas</a> : undefined}
      title="Historial de exportaciones"
    >
      {items.length ? (
        <div className="reports-history">
          {items.map((item) => (
            <ExportItem item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <StatePanel kind="empty" title="No hay exportaciones">
          <p>Las exportaciones solicitadas aparecerán aquí.</p>
        </StatePanel>
      )}
    </Card>
  );
}

function ExportItem({ item }: { item: ReportExport }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const result = await api.GET("/reports/exports/{id}/download", {
        params: { path: { id: item.id } },
        parseAs: "blob",
      });
      if (!result.response.ok) throw new ApiError(result.response.status, result.error);
      const blob = result.data instanceof Blob ? result.data : await result.response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vicam-${item.group.toLocaleLowerCase()}-${item.id}.${item.format.toLocaleLowerCase()}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos descargar el archivo.");
    } finally {
      setDownloading(false);
    }
  }
  return (
    <article>
      <div>
        <strong>
          {viewLabels[
            item.group === "MANAGEMENT" ? "summary" : (item.group.toLocaleLowerCase() as ReportView)
          ] ?? item.group}{" "}
          · {item.format === "XLSX" ? "Excel" : "PDF"}
        </strong>
        <span>{formatDateTime(item.createdAt, REPORT_TIMEZONE)}</span>
        <small>Vence {formatDateTime(item.expiresAt, REPORT_TIMEZONE)}</small>
        {error ? (
          <small className="reports-inline-error" role="alert">
            {error}
          </small>
        ) : null}
      </div>
      <StatusBadge
        tone={
          item.status === "AVAILABLE"
            ? "success"
            : item.status === "FAILED"
              ? "danger"
              : item.status === "EXPIRED"
                ? "neutral"
                : "warning"
        }
      >
        {humanStatus(item.status)}
      </StatusBadge>
      {item.status === "AVAILABLE" ? (
        <Button
          aria-label={`Descargar ${item.format}`}
          loading={downloading}
          onClick={() => void download()}
          variant="secondary"
        >
          <Download aria-hidden="true" size={18} />
          Descargar
        </Button>
      ) : null}
    </article>
  );
}
