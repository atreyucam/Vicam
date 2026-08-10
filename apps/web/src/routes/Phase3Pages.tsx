import type {
  AppSettings,
  Document,
  ImportBatch,
  Notification,
  ReportExport,
  User,
} from "@vicam/contracts";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  DocumentRow,
  ErrorSummary,
  FormSection,
  Input,
  Select,
  StatePanel,
  StatusBadge,
} from "@vicam/ui";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Upload,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError, unwrap } from "../api/api";
import { idempotencyParams, useIdempotencyKeyController } from "../api/idempotency";
import { useAsync } from "../api/useAsync";
import { registerWebPush, type WebPushResult } from "../app/webPush";
import { useOnlineStatus } from "../app/useOnlineStatus";
import { formValue, formatDateTime, LoadBoundary } from "./shared";

const size = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString("es-EC", { maximumFractionDigits: 1 })} MB`;
const documentTone = (status: Document["status"]) =>
  status === "AVAILABLE"
    ? "success"
    : status === "REJECTED" || status === "DELETED"
      ? "danger"
      : "warning";
const documentLabel = (status: Document["status"]) =>
  ({
    QUARANTINED: "En cuarentena",
    SCANNING: "Analizando",
    AVAILABLE: "Disponible",
    REJECTED: "Rechazado",
    DELETED: "En papelera",
  })[status];
type DocumentCategory = { active: boolean; id: string; name: string; version: number };

export function DocumentsPage({ accountId: providedAccountId }: { accountId?: string } = {}) {
  const online = useOnlineStatus();
  const accountId =
    providedAccountId ?? new URLSearchParams(window.location.search).get("accountId") ?? undefined;
  const [status, setStatus] = useState<Document["status"] | "">("");
  const state = useAsync(
    async () =>
      unwrap(
        await api.GET("/documents", {
          params: {
            query: {
              page: 1,
              pageSize: 20,
              ...(accountId ? { accountId } : {}),
              ...(status ? { status } : {}),
            },
          },
        }),
      ),
    [accountId, status],
  );
  const items = state.data?.items ?? [];
  return (
    <LoadBoundary {...state}>
      {!online ? (
        <StatePanel kind="offline" title="Los documentos requieren conexión">
          <p>Por seguridad, los archivos no se guardan ni se ponen en cola offline.</p>
        </StatePanel>
      ) : (
        <>
          {accountId ? (
            <div className="account-context" role="status">
              <div>
                <strong>Documentos de este cliente</strong>
                <span>La carga y el listado están limitados al cliente seleccionado.</span>
              </div>
              <ButtonLink href={`/app/accounts/${accountId}`} variant="secondary">
                Volver al cliente
              </ButtonLink>
            </div>
          ) : null}
          <div className="phase-toolbar">
            <Select
              label="Filtrar por estado"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="">Todos los estados</option>
              {["QUARANTINED", "SCANNING", "AVAILABLE", "REJECTED", "DELETED"].map((value) => (
                <option key={value} value={value}>
                  {documentLabel(value as Document["status"])}
                </option>
              ))}
            </Select>
          </div>
          <DocumentUpload onUploaded={state.reload} />
          {items.length ? (
            <div className="phase-list">
              {items.map((item) => (
                <DocumentRow
                  actions={<DocumentActions item={item} onChanged={state.reload} />}
                  category={item.categoryName}
                  context={
                    item.visitId
                      ? "Vinculado a una visita"
                      : item.taskId
                        ? "Vinculado a una tarea"
                        : "Documento de cliente"
                  }
                  format={item.format}
                  key={item.id}
                  name={item.originalName}
                  size={size(item.sizeBytes)}
                  status={
                    <StatusBadge tone={documentTone(item.status)}>
                      {documentLabel(item.status)}
                    </StatusBadge>
                  }
                />
              ))}
            </div>
          ) : (
            <StatePanel kind="empty" title="Sin documentos">
              <p>Los documentos se cargan desde un cliente cuando estés conectado.</p>
            </StatePanel>
          )}
        </>
      )}
    </LoadBoundary>
  );
}

function DocumentActions({ item, onChanged }: { item: Document; onChanged: () => void }) {
  const [action, setAction] = useState<"archive" | "restore" | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const intent = useIdempotencyKeyController();

  async function confirm() {
    if (!action) return;
    setWorking(true);
    setMessage(undefined);
    try {
      if (action === "archive")
        unwrap(
          await api.DELETE("/documents/{id}", {
            params: { path: { id: item.id }, ...idempotencyParams(intent.current()) },
          }),
        );
      else
        unwrap(
          await api.POST("/documents/{id}/restore", {
            params: { path: { id: item.id }, ...idempotencyParams(intent.current()) },
          }),
        );
      setAction(null);
      intent.rotate();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el documento.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div className="row-actions">
        {item.status === "AVAILABLE" ? (
          <>
            <a
              className="vicam-button vicam-button--secondary"
              href={`/api/v1/documents/${item.id}/download`}
            >
              <Download aria-hidden="true" size={16} />
              Descargar
            </a>
            <Button onClick={() => setAction("archive")} variant="secondary">
              <Archive aria-hidden="true" size={16} />
              Archivar
            </Button>
          </>
        ) : null}
        {item.status === "DELETED" ? (
          <Button onClick={() => setAction("restore")} variant="secondary">
            <ArchiveRestore aria-hidden="true" size={16} />
            Restaurar
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="inline-error" role="alert">
          {message}
        </p>
      ) : null}
      {action ? (
        <Dialog
          description={
            action === "archive"
              ? "El documento irá a la papelera durante 30 días y dejará de estar disponible para descarga."
              : "El documento volverá a estar disponible dentro del cliente."
          }
          onClose={() => setAction(null)}
          title={action === "archive" ? "Archivar documento" : "Restaurar documento"}
        >
          <div className="dialog-actions">
            <Button onClick={() => setAction(null)} variant="secondary">
              Cancelar
            </Button>
            <Button
              loading={working}
              onClick={() => void confirm()}
              variant={action === "archive" ? "danger" : "primary"}
            >
              {action === "archive" ? "Archivar documento" : "Restaurar documento"}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function DocumentUpload({ onUploaded }: { onUploaded: () => void }) {
  const accountId = new URLSearchParams(window.location.search).get("accountId");
  const categories = useAsync(async () => unwrap(await api.GET("/document-categories")), []);
  const [file, setFile] = useState<File | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [message, setMessage] = useState<string>();
  const intent = useIdempotencyKeyController();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !accountId || !categoryId) return;
    if (!/\.(pdf|docx|xlsx)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setMessage("Selecciona un PDF, DOCX o XLSX de máximo 10 MB.");
      return;
    }
    unwrap(
      await api.POST("/commercial-accounts/{id}/documents", {
        params: { path: { id: accountId }, ...idempotencyParams(intent.current()) },
        body: { file, categoryId },
        bodySerializer(body) {
          const formData = new FormData();
          if (!body) return formData;
          if (body.file instanceof File) formData.set("file", body.file);
          formData.set("categoryId", body.categoryId);
          if (body.visitId) formData.set("visitId", body.visitId);
          if (body.taskId) formData.set("taskId", body.taskId);
          return formData;
        },
      }),
    );
    setMessage("Documento enviado a cuarentena para análisis.");
    intent.rotate();
    setFile(null);
    onUploaded();
  }
  if (!accountId)
    return (
      <Card title="Cargar documento">
        <p className="help-text">
          Abre esta ruta desde un cliente para cargar un documento. La carga requiere conexión y no
          se almacena offline.
        </p>
      </Card>
    );
  return (
    <LoadBoundary {...categories}>
      <Card title="Cargar documento">
        <form className="phase-form" onSubmit={(event) => void submit(event)}>
          <Input
            accept=".pdf,.docx,.xlsx"
            label="Archivo"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            type="file"
          />
          <Select
            label="Categoría"
            onChange={(event) => setCategoryId(event.target.value)}
            required
            value={categoryId}
          >
            <option value="">Selecciona una categoría</option>
            {(categories.data ?? [])
              .filter((item: DocumentCategory) => item.active)
              .map((item: DocumentCategory) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </Select>
          {message ? <p role="status">{message}</p> : null}
          <Button disabled={!file || !categoryId} type="submit">
            <Upload aria-hidden="true" />
            Enviar a análisis
          </Button>
        </form>
      </Card>
    </LoadBoundary>
  );
}

export function NotificationsPage() {
  const [unread, setUnread] = useState(true);
  const [page, setPage] = useState(1);
  const intent = useIdempotencyKeyController();
  const state = useAsync(
    async () =>
      unwrap(
        await api.GET("/notifications", {
          params: {
            query: { page, pageSize: 15, ...(unread ? { unread: true } : {}) },
          },
        }),
      ),
    [page, unread],
  );
  function selectTab(nextUnread: boolean) {
    setUnread(nextUnread);
    setPage(1);
  }
  async function readAll() {
    unwrap(
      await api.POST("/notifications/read-all", {
        params: idempotencyParams(intent.current()),
      }),
    );
    intent.rotate();
    if (page === 1) state.reload();
    else setPage(1);
  }
  return (
    <LoadBoundary {...state}>
      <div className="phase-toolbar">
        <div className="tabs" role="tablist">
          <button aria-selected={unread} onClick={() => selectTab(true)} role="tab" type="button">
            No leídas
          </button>
          <button aria-selected={!unread} onClick={() => selectTab(false)} role="tab" type="button">
            Todas
          </button>
        </div>
        <Button onClick={() => void readAll()} variant="secondary">
          Marcar todas leídas
        </Button>
      </div>
      <PushEducationCard />
      {(state.data?.items.length ?? 0) ? (
        <>
          <ol className="notification-list">
            {state.data!.items.map((item) => (
              <NotificationItem item={item} key={item.id} reload={state.reload} />
            ))}
          </ol>
          <nav aria-label="Paginación de notificaciones" className="pagination-controls">
            <Button
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              variant="secondary"
            >
              <ChevronLeft aria-hidden="true" size={18} />
              Anterior
            </Button>
            <span aria-live="polite">
              Página {state.data!.pagination.page} de{" "}
              {Math.max(1, state.data!.pagination.totalPages)}
            </span>
            <Button
              aria-label="Página siguiente"
              disabled={page >= state.data!.pagination.totalPages}
              onClick={() => setPage((current) => current + 1)}
              variant="secondary"
            >
              Siguiente
              <ChevronRight aria-hidden="true" size={18} />
            </Button>
          </nav>
        </>
      ) : (
        <StatePanel
          kind="empty"
          title={unread ? "No tienes notificaciones sin leer" : "Sin notificaciones"}
        >
          <p>Los recordatorios y exportaciones aparecerán aquí.</p>
        </StatePanel>
      )}
    </LoadBoundary>
  );
}
function NotificationItem({ item, reload }: { item: Notification; reload: () => void }) {
  const intent = useIdempotencyKeyController();
  async function mark() {
    unwrap(
      await api.POST("/notifications/{id}/read", {
        params: { path: { id: item.id }, ...idempotencyParams(intent.current()) },
      }),
    );
    intent.rotate();
    reload();
  }
  return (
    <li>
      <div>
        <strong>{item.title}</strong>
        <p>{item.body}</p>
        <small>{formatDateTime(item.createdAt)}</small>
      </div>
      {!item.readAt ? (
        <Button onClick={() => void mark()} variant="secondary">
          Marcar leída
        </Button>
      ) : (
        <StatusBadge tone="neutral">Leída</StatusBadge>
      )}
    </li>
  );
}
function PushEducationCard() {
  const [result, setResult] = useState<WebPushResult>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useIdempotencyKeyController();
  async function request() {
    setWorking(true);
    setError(undefined);
    try {
      setResult(await registerWebPush(intent.current()));
      intent.rotate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo activar este dispositivo.");
    } finally {
      setWorking(false);
    }
  }
  const message =
    result?.kind === "active"
      ? "Este dispositivo quedó registrado para recibir recordatorios."
      : result?.kind === "denied"
        ? "El permiso fue rechazado. Puedes habilitarlo desde la configuración del navegador."
        : result?.kind === "unsupported"
          ? "Este navegador no ofrece Web Push."
          : result?.kind === "unconfigured"
            ? "Web Push no está configurado en este entorno. Las notificaciones internas siguen activas."
            : undefined;
  return (
    <Card title="Recordatorios en este dispositivo">
      <p>
        Activa avisos para recibir recordatorios de visitas, tareas y exportaciones terminadas.
        Puedes cambiarlo después desde tu navegador.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        disabled={result?.kind === "active"}
        loading={working}
        loadingLabel="Activando"
        onClick={() => void request()}
        variant="secondary"
      >
        <BellRing aria-hidden="true" />
        {result?.kind === "active" ? "Notificaciones activas" : "Activar notificaciones"}
      </Button>
    </Card>
  );
}

const reportGroups = [
  {
    value: "VISITS",
    label: "Visitas",
    description: "Agenda, realizadas, canceladas, reprogramadas y productividad.",
    templates: ["agenda", "completed", "cancelled-rescheduled", "productivity"],
  },
  {
    value: "TASKS",
    label: "Tareas",
    description: "Abiertas, vencidas, completadas y carga por responsable.",
    templates: ["open", "overdue", "completed", "workload"],
  },
  {
    value: "ACCOUNTS",
    label: "Clientes",
    description: "Directorio, seguimiento reciente y agrupación comercial.",
    templates: ["directory", "stale", "by-fruit-location-owner"],
  },
  {
    value: "DOCUMENTS",
    label: "Documentos",
    description: "Inventario, categorías y próximas revisiones.",
    templates: ["inventory", "by-category", "review-due"],
  },
  {
    value: "MANAGEMENT",
    label: "Resumen gerencial",
    description: "KPIs y actividad consolidada del periodo.",
    templates: ["kpis", "period-activity"],
  },
] as const;
const reportTemplateLabels: Record<string, string> = {
  agenda: "Agenda",
  completed: "Completadas",
  "cancelled-rescheduled": "Canceladas y reprogramadas",
  productivity: "Productividad",
  open: "Abiertas",
  overdue: "Vencidas",
  workload: "Carga por responsable",
  directory: "Directorio",
  stale: "Sin visita reciente",
  "by-fruit-location-owner": "Por fruta, ubicación y responsable",
  inventory: "Inventario",
  "by-category": "Por categoría",
  "review-due": "Próximas a revisión",
  kpis: "Indicadores clave",
  "period-activity": "Actividad del periodo",
};
type ReportFilterInput = {
  dateFrom: string;
  dateTo: string;
  status: string;
  account: string;
  city: string;
};
function reportFilters(group: (typeof reportGroups)[number]["value"], input: ReportFilterInput) {
  const commonDates = { from: input.dateFrom, to: input.dateTo };
  const filters =
    group === "VISITS"
      ? { ...commonDates, status: input.status, accountId: input.account, city: input.city }
      : group === "TASKS"
        ? { ...commonDates, status: input.status, accountId: input.account }
        : group === "ACCOUNTS"
          ? { status: input.status, city: input.city }
          : group === "DOCUMENTS"
            ? { ...commonDates, accountId: input.account }
            : commonDates;
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}
export function ReportsPage({ exportsOnly = false }: { exportsOnly?: boolean }) {
  const [created, setCreated] = useState(false);
  const state = useAsync(
    async () =>
      unwrap(await api.GET("/reports/exports", { params: { query: { page: 1, pageSize: 20 } } })),
    [],
  );
  return (
    <LoadBoundary {...state}>
      {!exportsOnly ? (
        <>
          <ReportRequest
            onCreated={() => {
              setCreated(true);
              state.reload();
            }}
          />
          {created ? <p role="status">La exportación fue enviada a la cola.</p> : null}
        </>
      ) : null}
      <Card title="Exportaciones">
        <p>Los archivos disponibles vencen a los 7 días.</p>
        {(state.data?.items.length ?? 0) ? (
          <div className="phase-list">
            {state.data!.items.map((item) => (
              <ExportRow item={item} key={item.id} />
            ))}
          </div>
        ) : (
          <StatePanel kind="empty" title="No hay exportaciones">
            <p>Selecciona un reporte y confirma la exportación.</p>
          </StatePanel>
        )}
      </Card>
    </LoadBoundary>
  );
}
function ReportRequest({ onCreated }: { onCreated: () => void }) {
  const [group, setGroup] = useState<(typeof reportGroups)[number]["value"]>("VISITS");
  const selectedGroup = reportGroups.find((item) => item.value === group)!;
  const [template, setTemplate] = useState<string>(selectedGroup.templates[0]);
  const [format, setFormat] = useState<"PDF" | "XLSX">("PDF");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [account, setAccount] = useState("");
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const intent = useIdempotencyKeyController();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation: string[] = [];
    if (dateFrom && dateTo && dateFrom > dateTo)
      validation.push("La fecha inicial no puede ser posterior a la fecha final.");
    setErrors(validation);
    if (validation.length) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".vicam-error-summary")?.focus(),
      );
      return;
    }
    unwrap(
      await api.POST("/reports/exports", {
        params: idempotencyParams(intent.current()),
        body: {
          group,
          format,
          template,
          filters: reportFilters(group, { dateFrom, dateTo, status, account, city }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Guayaquil",
        },
      }),
    );
    intent.rotate();
    onCreated();
  }
  function chooseGroup(value: (typeof reportGroups)[number]["value"]) {
    const next = reportGroups.find((item) => item.value === value)!;
    setGroup(value);
    setTemplate(next.templates[0]);
    setStatus("");
  }
  return (
    <>
      <section aria-labelledby="report-groups-title">
        <h2 className="visually-hidden" id="report-groups-title">
          Grupos de reportes
        </h2>
        <div className="report-group-grid">
          {reportGroups.map((item) => (
            <button
              aria-pressed={group === item.value}
              className="report-group-card"
              key={item.value}
              onClick={() => chooseGroup(item.value)}
              type="button"
            >
              {item.value === "DOCUMENTS" ? (
                <FileText aria-hidden="true" />
              ) : (
                <FileSpreadsheet aria-hidden="true" />
              )}
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </section>
      <form className="phase-form" onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} />
        <FormSection
          description="Los filtros, alcance y zona se conservan en PDF y Excel."
          title={`Configurar: ${selectedGroup.label}`}
        >
          <Select
            label="Plantilla"
            onChange={(event) => setTemplate(event.target.value)}
            value={template}
          >
            {selectedGroup.templates.map((value) => (
              <option key={value} value={value}>
                {reportTemplateLabels[value]}
              </option>
            ))}
          </Select>
          {group !== "ACCOUNTS" ? (
            <>
              <Input
                label="Desde"
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
              <Input
                label="Hasta"
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </>
          ) : null}
          {group === "VISITS" || group === "TASKS" || group === "ACCOUNTS" ? (
            <Select
              label="Estado"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">Todos los estados</option>
              {group === "ACCOUNTS" ? (
                <>
                  <option value="ACTIVE">Activo</option>
                  <option value="ARCHIVED">Archivado</option>
                </>
              ) : (
                <>
                  <option value="PENDING">Pendiente</option>
                  {group === "TASKS" ? <option value="IN_PROGRESS">En progreso</option> : null}
                  <option value="COMPLETED">Completado</option>
                  <option value="CANCELLED">Cancelado</option>
                </>
              )}
            </Select>
          ) : null}
          {group !== "ACCOUNTS" && group !== "MANAGEMENT" ? (
            <Input
              label="ID de cliente"
              onChange={(event) => setAccount(event.target.value)}
              placeholder="UUID del cliente"
              value={account}
            />
          ) : null}
          {group === "VISITS" || group === "ACCOUNTS" ? (
            <Input label="Ciudad" onChange={(event) => setCity(event.target.value)} value={city} />
          ) : null}
          <Select
            label="Formato de exportación"
            onChange={(event) => setFormat(event.target.value as typeof format)}
            value={format}
          >
            <option value="PDF">PDF</option>
            <option value="XLSX">Excel</option>
          </Select>
        </FormSection>
        <Card title="Vista previa de solicitud">
          <dl className="report-preview">
            <div>
              <dt>Grupo y plantilla</dt>
              <dd>
                {selectedGroup.label} · {reportTemplateLabels[template]}
              </dd>
            </div>
            <div>
              <dt>Periodo</dt>
              <dd>
                {dateFrom || "Sin inicio"} — {dateTo || "Sin fin"}
              </dd>
            </div>
            <div>
              <dt>Alcance</dt>
              <dd>
                {account || city ? [account, city].filter(Boolean).join(" · ") : "Según permisos"}
              </dd>
            </div>
            <div>
              <dt>Zona</dt>
              <dd>{Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Guayaquil"}</dd>
            </div>
          </dl>
        </Card>
        <Button type="submit">Solicitar exportación {format}</Button>
      </form>
    </>
  );
}
function ExportRow({ item }: { item: ReportExport }) {
  const labels = {
    QUEUED: "En cola",
    PROCESSING: "Procesando",
    AVAILABLE: "Disponible",
    FAILED: "Falló",
    EXPIRED: "Venció",
  };
  return (
    <article className="export-row">
      <div>
        <strong>{reportGroups.find((group) => group.value === item.group)?.label}</strong>
        <span>
          {item.format} · {formatDateTime(item.createdAt)}
        </span>
        <small>Vence: {formatDateTime(item.expiresAt)}</small>
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
        {labels[item.status]}
      </StatusBadge>
      {item.status === "FAILED" && item.error ? (
        <span className="inline-error">Motivo: {item.error}</span>
      ) : null}
      {item.status === "AVAILABLE" ? (
        <a
          className="vicam-button vicam-button--secondary"
          href={`/api/v1/reports/exports/${item.id}/download`}
        >
          Descargar
        </a>
      ) : null}
    </article>
  );
}

export function ImportsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const intent = useIdempotencyKeyController();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    setBatch(
      unwrap(
        await api.POST("/imports", {
          params: idempotencyParams(intent.current()),
          body,
        }),
      ),
    );
    intent.rotate();
  }
  return (
    <div className="phase-form">
      <Card title="Importar clientes y contactos">
        <ol className="import-steps">
          <li>Descarga y completa la plantilla XLSX o CSV.</li>
          <li>Carga el archivo para validar filas, duplicados y campos obligatorios.</li>
          <li>Revisa el resultado antes de la confirmación idempotente.</li>
        </ol>
        <form onSubmit={(event) => void submit(event)}>
          <Input
            accept=".xlsx,.csv"
            aria-describedby="import-help"
            label="Archivo de importación"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            type="file"
          />
          <p className="help-text" id="import-help">
            Solo XLSX o CSV. Los errores se mostrarán por fila; nada se guarda en silencio.
          </p>
          <Button disabled={!file} type="submit">
            <Upload aria-hidden="true" />
            Validar archivo
          </Button>
        </form>
      </Card>
      {batch ? <ImportSummary batch={batch} /> : null}
      <ImportReview
        batchId={batch?.id ?? new URLSearchParams(window.location.search).get("batchId")}
      />
    </div>
  );
}

function ImportReview({ batchId }: { batchId: string | null | undefined }) {
  const state = useAsync(
    async () =>
      batchId
        ? unwrap(await api.GET("/imports/{id}", { params: { path: { id: batchId } } }))
        : null,
    [batchId],
  );
  const intent = useIdempotencyKeyController();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string>();
  async function confirm() {
    if (!state.data || state.data.status !== "READY" || !state.data.confirmationId) return;
    setConfirming(true);
    setMessage(undefined);
    try {
      const confirmed = unwrap(
        await api.POST("/imports/{id}/confirm", {
          params: {
            path: { id: state.data.id },
            ...idempotencyParams(intent.current()),
          },
          body: { confirmationId: state.data.confirmationId },
        }),
      );
      intent.rotate();
      setMessage(
        confirmed.status === "COMPLETED"
          ? "La importación ya estaba completada; no se duplicaron filas."
          : "Confirmación aceptada. El lote se procesará de forma idempotente.",
      );
      state.reload();
    } finally {
      setConfirming(false);
    }
  }
  if (!batchId) return null;
  return (
    <LoadBoundary {...state}>
      {state.data ? (
        <Card title="Revisión del lote">
          <p>Estado: {state.data.status}. Revisa cada fila antes de confirmar.</p>
          {message ? <p role="status">{message}</p> : null}
          <div
            aria-label="Filas revisadas de la importación"
            className="desktop-table-wrap always"
            role="region"
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Acción</th>
                  <th>Errores</th>
                  <th>Duplicado</th>
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>
                      {row.action === "CREATE"
                        ? "Crear"
                        : row.action === "UPDATE"
                          ? "Actualizar"
                          : row.action === "SKIP"
                            ? "Omitir"
                            : "Error"}
                    </td>
                    <td>{row.errors.join(", ") || "—"}</td>
                    <td>{row.duplicateOfAccountId ? "Posible coincidencia" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.status === "READY" ? (
            <Button
              disabled={!state.data.confirmationId}
              loading={confirming}
              loadingLabel="Confirmando"
              onClick={() => void confirm()}
            >
              Confirmar importación
            </Button>
          ) : (
            <Button onClick={state.reload} variant="secondary">
              Actualizar estado
            </Button>
          )}
        </Card>
      ) : null}
    </LoadBoundary>
  );
}
function ImportSummary({ batch }: { batch: ImportBatch }) {
  return (
    <Card title="Validación en proceso">
      <p role="status">
        Estado: {batch.status}. Filas: {batch.totalRows}.
      </p>
      <dl className="summary-grid">
        <div>
          <dt>Crear</dt>
          <dd>{batch.createRows}</dd>
        </div>
        <div>
          <dt>Actualizar</dt>
          <dd>{batch.updateRows}</dd>
        </div>
        <div>
          <dt>Omitir</dt>
          <dd>{batch.skipRows}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{batch.errorRows}</dd>
        </div>
      </dl>
      <p className="help-text">
        Cuando el lote esté listo, vuelve a cargarlo para revisar las filas y confirmar con la
        acción explícita.
      </p>
    </Card>
  );
}

export function UsersPage() {
  const state = useAsync(
    async () => unwrap(await api.GET("/users", { params: { query: { page: 1, pageSize: 30 } } })),
    [],
  );
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; user: User } | null>(
    null,
  );
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  return (
    <>
      <div className="users-toolbar">
        <div aria-live="polite">
          {temporaryPassword ? (
            <div className="temporary-credential" role="status">
              <strong>Contraseña temporal creada</strong>
              <code>{temporaryPassword}</code>
              <span>Guárdala ahora y entrégala por un canal seguro; se muestra una sola vez.</span>
            </div>
          ) : null}
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus aria-hidden="true" size={18} />
          Crear usuario
        </Button>
      </div>
      <LoadBoundary {...state}>
        {(state.data?.items.length ?? 0) ? (
          <>
            <div className="desktop-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Último acceso</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data!.items.map((item) => (
                    <UserRow
                      item={item}
                      key={item.id}
                      onEdit={() => setDialog({ mode: "edit", user: item })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-cards">
              {state.data!.items.map((item) => (
                <Card key={item.id}>
                  <div className="user-card">
                    <strong>{item.fullName}</strong>
                    <span>
                      {item.username} · {item.role === "MANAGER" ? "Manager" : "Supervisor"}
                    </span>
                    <StatusBadge tone={item.status === "ACTIVE" ? "success" : "neutral"}>
                      {item.status === "ACTIVE" ? "Activo" : "Inactivo"}
                    </StatusBadge>
                    <Button
                      onClick={() => setDialog({ mode: "edit", user: item })}
                      variant="secondary"
                    >
                      <Pencil aria-hidden="true" size={18} />
                      Editar usuario
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <StatePanel kind="empty" title="Sin usuarios">
            <p>Crea el primer Supervisor desde esta pantalla.</p>
          </StatePanel>
        )}
      </LoadBoundary>
      {dialog ? (
        <UserDialog
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onSaved={(password) => {
            setDialog(null);
            setTemporaryPassword(password);
            state.reload();
          }}
          {...(dialog.mode === "edit" ? { user: dialog.user } : {})}
        />
      ) : null}
    </>
  );
}
function UserRow({ item, onEdit }: { item: User; onEdit: () => void }) {
  return (
    <tr>
      <td>
        <strong>{item.fullName}</strong>
        <br />
        <small>{item.username}</small>
      </td>
      <td>{item.role === "MANAGER" ? "Manager" : "Supervisor"}</td>
      <td>
        <StatusBadge tone={item.status === "ACTIVE" ? "success" : "neutral"}>
          {item.status === "ACTIVE" ? "Activo" : "Inactivo"}
        </StatusBadge>
      </td>
      <td>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "Sin acceso"}</td>
      <td>
        <Button onClick={onEdit} variant="secondary">
          <Pencil aria-hidden="true" size={18} />
          Editar
        </Button>
      </td>
    </tr>
  );
}

function UserDialog({
  mode,
  onClose,
  onSaved,
  user,
}: {
  mode: "create" | "edit";
  onClose: () => void;
  onSaved: (temporaryPassword: string | null) => void;
  user?: User;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const idempotency = useIdempotencyKeyController();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fullName = formValue(data, "fullName").trim();
    const username = formValue(data, "username").trim();
    if (!fullName || (mode === "create" && !username)) {
      setErrors(["Completa los campos obligatorios."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      if (mode === "create") {
        const result = unwrap(
          await api.POST("/users", {
            params: idempotencyParams(idempotency.current()),
            body: {
              fullName,
              role: formValue(data, "role") as User["role"],
              username,
            },
          }),
        );
        onSaved(result.temporaryPassword);
      } else {
        unwrap(
          await api.PATCH("/users/{id}", {
            params: { path: { id: user!.id }, ...idempotencyParams(idempotency.current()) },
            body: {
              fullName,
              role: formValue(data, "role") as User["role"],
            },
          }),
        );
        onSaved(null);
      }
    } catch (reason) {
      setErrors([reason instanceof ApiError ? reason.message : "No pudimos guardar el usuario."]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      description={
        mode === "create"
          ? "La contraseña temporal se mostrará una sola vez al guardar."
          : `Actualiza los datos y el acceso de ${user!.fullName}.`
      }
      onClose={onClose}
      title={mode === "create" ? "Crear usuario" : "Editar usuario"}
    >
      <form noValidate onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} />
        <Input
          data-dialog-initial-focus
          defaultValue={user?.fullName}
          label="Nombre completo"
          name="fullName"
          required
        />
        {mode === "create" ? <Input label="Usuario" name="username" required /> : null}
        <Select defaultValue={user?.role ?? "SUPERVISOR"} label="Rol" name="role" required>
          <option value="SUPERVISOR">Supervisor</option>
          <option value="MANAGER">Manager</option>
        </Select>
        <div className="modal-actions">
          <Button onClick={onClose} variant="secondary">
            Cancelar
          </Button>
          <Button loading={busy} loadingLabel="Guardando usuario" type="submit">
            {mode === "create" ? "Crear usuario" : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CatalogsPage() {
  const categories = useAsync(async () => unwrap(await api.GET("/document-categories")), []);
  const fruits = useAsync(
    async () =>
      unwrap(
        await api.GET("/fruits", { params: { query: { includeInactive: true } } }),
      ) as DocumentCategory[],
    [],
  );
  return (
    <div className="catalog-grid">
      <LoadBoundary {...fruits}>
        <CatalogPanel
          items={fruits.data ?? []}
          kind="fruit"
          onCreate={async (name, key) => {
            unwrap(
              await api.POST("/fruits", {
                params: idempotencyParams(key),
                body: { name },
              }),
            );
          }}
          onReload={fruits.reload}
          onUpdate={async (item, change, key) => {
            unwrap(
              await api.PATCH("/fruits/{id}", {
                params: { path: { id: item.id }, ...idempotencyParams(key) },
                body: { ...change, version: item.version },
              }),
            );
          }}
          title="Frutas"
        />
      </LoadBoundary>
      <LoadBoundary {...categories}>
        <CatalogPanel
          items={categories.data ?? []}
          kind="category"
          onCreate={async (name, key) => {
            unwrap(
              await api.POST("/document-categories", {
                params: idempotencyParams(key),
                body: { name },
              }),
            );
          }}
          onReload={categories.reload}
          onUpdate={async (item, change, key) => {
            unwrap(
              await api.PATCH("/document-categories/{id}", {
                params: { path: { id: item.id }, ...idempotencyParams(key) },
                body: { ...change, version: item.version },
              }),
            );
          }}
          title="Categorías de documentos"
        />
      </LoadBoundary>
    </div>
  );
}

type CatalogItem = DocumentCategory;
function CatalogPanel({
  items,
  kind,
  onCreate,
  onReload,
  onUpdate,
  title,
}: {
  items: CatalogItem[];
  kind: "fruit" | "category";
  onCreate: (name: string, key: string) => Promise<void>;
  onReload: () => void;
  onUpdate: (
    item: CatalogItem,
    change: { active?: boolean; name?: string },
    key: string,
  ) => Promise<void>;
  title: string;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<CatalogItem>();
  const [deactivating, setDeactivating] = useState<CatalogItem>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const intent = useIdempotencyKeyController();
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (showInactive || item.active) &&
          item.name.toLocaleLowerCase("es-EC").includes(query.trim().toLocaleLowerCase("es-EC")),
      ),
    [items, query, showInactive],
  );

  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError(undefined);
    try {
      await operation();
      intent.rotate();
      setName("");
      setEditing(undefined);
      setDeactivating(undefined);
      onReload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el catálogo.");
    } finally {
      setWorking(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await run(() => onCreate(name.trim(), intent.current()));
  }

  return (
    <Card title={title}>
      <form className="catalog-create" onSubmit={(event) => void create(event)}>
        <Input
          label={kind === "fruit" ? "Nueva fruta" : "Nueva categoría"}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <Button disabled={!name.trim()} loading={working} type="submit">
          Crear
        </Button>
      </form>
      <div className="catalog-filters">
        <Input
          label={`Buscar en ${title.toLocaleLowerCase("es-EC")}`}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
        <label className="catalog-checkbox">
          <input
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
            type="checkbox"
          />
          Mostrar inactivos
        </label>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {visible.length ? (
        <div className="phase-list">
          {visible.map((item) => (
            <div className="catalog-row" key={item.id}>
              <span>{item.name}</span>
              <StatusBadge tone={item.active ? "success" : "neutral"}>
                {item.active ? "Activo" : "Inactivo"}
              </StatusBadge>
              <Button onClick={() => setEditing(item)} variant="secondary">
                Renombrar
              </Button>
              {item.active ? (
                <Button onClick={() => setDeactivating(item)} variant="secondary">
                  Desactivar
                </Button>
              ) : (
                <Button
                  loading={working}
                  onClick={() => void run(() => onUpdate(item, { active: true }, intent.current()))}
                  variant="secondary"
                >
                  Reactivar
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <StatePanel kind="empty" title={items.length ? "Sin resultados" : "Catálogo vacío"}>
          <p>
            {items.length
              ? "Ajusta la búsqueda o muestra los elementos inactivos."
              : "Crea el primer elemento de este catálogo."}
          </p>
        </StatePanel>
      )}
      {editing ? (
        <CatalogRenameDialog
          item={editing}
          onClose={() => setEditing(undefined)}
          onSave={(nextName) => run(() => onUpdate(editing, { name: nextName }, intent.current()))}
          working={working}
        />
      ) : null}
      {deactivating ? (
        <Dialog
          description="Los elementos usados se conservan en el historial. Al desactivarlo dejará de estar disponible para nuevas selecciones."
          onClose={() => setDeactivating(undefined)}
          title={`Desactivar ${deactivating.name}`}
        >
          <div className="dialog-actions">
            <Button onClick={() => setDeactivating(undefined)} variant="secondary">
              Cancelar
            </Button>
            <Button
              loading={working}
              onClick={() =>
                void run(() => onUpdate(deactivating, { active: false }, intent.current()))
              }
              variant="danger"
            >
              Desactivar
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function CatalogRenameDialog({
  item,
  onClose,
  onSave,
  working,
}: {
  item: CatalogItem;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  working: boolean;
}) {
  const [name, setName] = useState(item.name);
  return (
    <Dialog
      description="El nuevo nombre se validará sin distinguir mayúsculas ni acentos."
      onClose={onClose}
      title={`Renombrar ${item.name}`}
    >
      <form
        className="phase-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onSave(name.trim());
        }}
      >
        <Input
          autoFocus
          label="Nombre"
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <div className="dialog-actions">
          <Button onClick={onClose} variant="secondary">
            Cancelar
          </Button>
          <Button disabled={!name.trim()} loading={working} type="submit">
            Guardar nombre
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SettingsPage() {
  const state = useAsync(async () => unwrap(await api.GET("/settings")), []);
  return (
    <LoadBoundary {...state}>
      {state.data ? <SettingsForm settings={state.data} /> : null}
    </LoadBoundary>
  );
}
function SettingsForm({ settings }: { settings: AppSettings }) {
  const [offline, setOffline] = useState(settings.offlineWindowHours);
  const intent = useIdempotencyKeyController();
  async function submit(event: FormEvent) {
    event.preventDefault();
    unwrap(
      await api.PATCH("/settings", {
        params: idempotencyParams(intent.current()),
        body: { ...settings, offlineWindowHours: offline },
      }),
    );
    intent.rotate();
  }
  return (
    <form className="phase-form" onSubmit={(event) => void submit(event)}>
      <FormSection title="Operación y recordatorios">
        <Input
          label="Ventana offline (horas)"
          max={72}
          min={1}
          onChange={(e) => setOffline(Number(e.target.value))}
          type="number"
          value={offline}
        />
        <p className="help-text">
          Las retenciones legales son fijas: exportaciones {settings.retentionDays.exports} días,
          papelera {settings.retentionDays.documentsTrash} días y jobs {settings.retentionDays.jobs}{" "}
          días.
        </p>
        <Button type="submit">
          <ShieldCheck aria-hidden="true" />
          Guardar configuración
        </Button>
      </FormSection>
    </form>
  );
}

export function ProfilePage() {
  const profile = useAsync(async () => unwrap(await api.GET("/auth/me")), []);
  const sessions = useAsync(async () => unwrap(await api.GET("/auth/sessions")), []);
  const intent = useIdempotencyKeyController();
  async function revoke(id: string) {
    unwrap(
      await api.DELETE("/auth/sessions/{id}", {
        params: { path: { id }, ...idempotencyParams(intent.current()) },
      }),
    );
    intent.rotate();
    sessions.reload();
  }
  return (
    <Card title="Perfil y dispositivo">
      <LoadBoundary {...profile}>
        {profile.data ? (
          <p>
            <strong>{profile.data.fullName}</strong>
          </p>
        ) : null}
      </LoadBoundary>
      <div className="profile-actions">
        <ButtonLink href="/app/notifications" variant="secondary">
          <BellRing aria-hidden="true" />
          Notificaciones
        </ButtonLink>
        <ButtonLink href="/app/sync" variant="secondary">
          Sincronización y PIN local
        </ButtonLink>
      </div>
      <LoadBoundary {...sessions}>
        {sessions.data?.length ? (
          <div className="phase-list">
            {sessions.data.map((session) => (
              <article className="export-row" key={session.id}>
                <div>
                  <strong>{session.deviceName || session.platform}</strong>
                  <small>
                    Última actividad:{" "}
                    {session.lastUsedAt ? formatDateTime(session.lastUsedAt) : "Sin actividad"}
                  </small>
                </div>
                {session.current ? (
                  <StatusBadge tone="success">Sesión actual</StatusBadge>
                ) : (
                  <Button onClick={() => void revoke(session.id)} variant="secondary">
                    Revocar sesión
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <StatePanel kind="empty" title="Sin otras sesiones">
            <p>No hay sesiones activas para revocar.</p>
          </StatePanel>
        )}
      </LoadBoundary>
    </Card>
  );
}
