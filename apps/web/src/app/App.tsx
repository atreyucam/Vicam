import {
  AppShell,
  Button,
  ButtonLink,
  MobileNav,
  OfflineBanner,
  PageHeader,
  Sidebar,
  StatePanel,
  SyncIndicator,
  TopBar,
  UpdateBanner,
  type NavigationItem,
} from "@vicam/ui";
import {
  BookOpen,
  Bell,
  CalendarDays,
  FileText,
  Home,
  ListChecks,
  LogOut,
  MoreHorizontal,
  BarChart3,
  Settings,
  Users,
  ScrollText,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useSession } from "./session";
import { useOnlineStatus } from "./useOnlineStatus";
import { LoginPage } from "../routes/LoginPage";
import { ChangePasswordPage } from "../routes/ChangePasswordPage";
import { OfflineUnlockPage } from "../routes/OfflineUnlockPage";
import { AuditPage } from "../routes/AuditPage";
import { DashboardPage } from "../routes/DashboardPage";
import { handleInternalNavigation } from "../routes/shared";
import { useOfflineRuntime } from "../offline/useOfflineRuntime";
import { offlineEnabled } from "../offline/config";
import { applyPwaShellUpdateWhenSafe, pwaUpdateReadyEvent } from "./pwaUpdateState";
import { waitForSyncIdle } from "../offline/syncEngine";

const AccountDetailPage = lazy(() =>
  import("../routes/AccountsPages").then((module) => ({ default: module.AccountDetailPage })),
);
const AccountFormPage = lazy(() =>
  import("../routes/AccountsPages").then((module) => ({ default: module.AccountFormPage })),
);
const AccountsPage = lazy(() =>
  import("../routes/AccountsPages").then((module) => ({ default: module.AccountsPage })),
);
const AgendaPage = lazy(() =>
  import("../routes/VisitsPages").then((module) => ({ default: module.AgendaPage })),
);
const VisitDetailPage = lazy(() =>
  import("../routes/VisitsPages").then((module) => ({ default: module.VisitDetailPage })),
);
const VisitFormPage = lazy(() =>
  import("../routes/VisitsPages").then((module) => ({ default: module.VisitFormPage })),
);
const TaskFormPage = lazy(() =>
  import("../routes/TasksPages").then((module) => ({ default: module.TaskFormPage })),
);
const TaskDetailPage = lazy(() =>
  import("../routes/TasksPages").then((module) => ({ default: module.TaskDetailPage })),
);
const TasksPage = lazy(() =>
  import("../routes/TasksPages").then((module) => ({ default: module.TasksPage })),
);
const SyncCenterPage = lazy(() =>
  import("../routes/SyncPages").then((module) => ({ default: module.SyncCenterPage })),
);
const SyncConflictDetailPage = lazy(() =>
  import("../routes/SyncPages").then((module) => ({ default: module.SyncConflictDetailPage })),
);
const SyncConflictsPage = lazy(() =>
  import("../routes/SyncPages").then((module) => ({ default: module.SyncConflictsPage })),
);
const CatalogsPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.CatalogsPage })),
);
const DocumentsPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.DocumentsPage })),
);
const ImportsPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.ImportsPage })),
);
const NotificationsPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.NotificationsPage })),
);
const ProfilePage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.ProfilePage })),
);
const ReportsPage = lazy(() =>
  import("../routes/ReportsPage").then((module) => ({ default: module.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.SettingsPage })),
);
const UsersPage = lazy(() =>
  import("../routes/Phase3Pages").then((module) => ({ default: module.UsersPage })),
);

type NavTuple = readonly [string, string, LucideIcon, "ALL" | "MANAGER"];
const nav: readonly NavTuple[] = [
  ["/app", "Inicio", Home, "ALL"],
  ["/app/agenda", "Agenda", CalendarDays, "ALL"],
  ["/app/accounts", "Clientes", BookOpen, "ALL"],
  ["/app/tasks", "Tareas", ListChecks, "ALL"],
  ["/app/documents", "Documentos", FileText, "ALL"],
  ["/app/reports", "Reportes", BarChart3, "ALL"],
  ["/app/notifications", "Notificaciones", Bell, "ALL"],
  ["/app/users", "Usuarios", Users, "MANAGER"],
  ["/app/catalogs/fruits", "Catálogos", BookOpen, "MANAGER"],
  ["/app/audit", "Auditoría", ScrollText, "MANAGER"],
  ["/app/settings", "Configuración", Settings, "MANAGER"],
];
const mobile: readonly NavTuple[] = [
  ["/app", "Inicio", Home, "ALL"],
  ["/app/agenda", "Agenda", CalendarDays, "ALL"],
  ["/app/accounts", "Clientes", BookOpen, "ALL"],
  ["/app/tasks", "Tareas", ListChecks, "ALL"],
  ["/app/more", "Más", MoreHorizontal, "ALL"],
];
const titles: Record<string, [string, string, string]> = {
  "/app": ["Inicio", "Espacio de trabajo", "Tus acciones comerciales prioritarias."],
  "/app/agenda": ["Agenda", "Organización", "Visitas visibles según tu rol y asignación."],
  "/app/accounts": [
    "Clientes",
    "Relaciones comerciales",
    "Busca y administra los clientes dentro de tu alcance.",
  ],
  "/app/accounts/new": [
    "Nuevo cliente",
    "Relaciones comerciales",
    "Registra la identidad y datos operativos del cliente.",
  ],
  "/app/visits/new": ["Agendar cita", "Agenda", "Programa una visita y sus datos esenciales."],
  "/app/tasks": ["Tareas", "Seguimiento", "Prioriza vencidas, de hoy y próximas."],
  "/app/tasks/new": ["Nueva tarea", "Seguimiento", "Crea una acción de seguimiento."],
  "/app/documents": [
    "Documentos",
    "Operación",
    "Metadatos y estados de seguridad; los archivos nunca se guardan offline.",
  ],
  "/app/notifications": ["Notificaciones", "Operación", "Recordatorios y avisos de trabajo."],
  "/app/reports": ["Reportes", "Operación", "Analiza la actividad comercial y operativa."],
  "/app/reports/exports": [
    "Exportaciones",
    "Reportes",
    "Consulta los archivos disponibles durante siete días.",
  ],
  "/app/imports": [
    "Importaciones",
    "Administración",
    "Valida, revisa y confirma lotes de forma idempotente.",
  ],
  "/app/users": ["Usuarios", "Administración", "Gestiona acceso interno y estado de usuarios."],
  "/app/catalogs/fruits": ["Catálogos", "Administración", "Frutas y categorías operativas."],
  "/app/catalogs/document-categories": [
    "Categorías de documentos",
    "Administración",
    "Clasifica documentos permitidos.",
  ],
  "/app/settings": ["Configuración", "Administración", "Reglas operativas auditadas."],
  "/app/profile": ["Perfil", "Cuenta", "Preferencias y seguridad de este dispositivo."],
  "/app/audit": ["Auditoría", "Administración", "Actividad segura e inmutable de Fase 1."],
  "/app/more": ["Más", "Navegación", "Acciones personales y administrativas."],
  "/app/sync": [
    "Sincronización",
    "Trabajo offline",
    "Estado, pendientes y vigencia de este dispositivo.",
  ],
  "/app/sync/conflicts": [
    "Conflictos",
    "Sincronización",
    "Cambios que requieren revisión explícita.",
  ],
};

function navigationItems(
  source: readonly NavTuple[],
  pathname: string,
  role: "MANAGER" | "SUPERVISOR",
): NavigationItem[] {
  return source
    .filter(([, , , access]) => access === "ALL" || role === "MANAGER")
    .map(([href, label, Icon]) => ({
      href,
      label,
      icon: <Icon aria-hidden="true" size={20} />,
      active: href === "/app" ? pathname === href : pathname.startsWith(href),
    }));
}
function routeTitle(pathname: string): [string, string, string] | undefined {
  if (/^\/app\/accounts\/[^/]+\/edit$/.test(pathname))
    return [
      "Editar cliente",
      "Relaciones comerciales",
      "Actualiza información respetando la versión actual.",
    ];
  if (/^\/app\/accounts\/[^/]+\/contacts$/.test(pathname))
    return ["Contactos", "Cliente comercial", "Administra contactos y su principal."];
  if (/^\/app\/accounts\/[^/]+\/visits$/.test(pathname))
    return ["Visitas del cliente", "Relaciones comerciales", "Historial de visitas del cliente."];
  if (/^\/app\/accounts\/[^/]+\/tasks$/.test(pathname))
    return ["Tareas del cliente", "Relaciones comerciales", "Seguimientos asociados al cliente."];
  if (/^\/app\/accounts\/[^/]+\/documents$/.test(pathname))
    return ["Documentos del cliente", "Relaciones comerciales", "Documentos asociados al cliente."];
  if (/^\/app\/accounts\/[^/]+$/.test(pathname))
    return ["Detalle del cliente", "Relaciones comerciales", "Información y acciones del cliente."];
  if (/^\/app\/visits\/[^/]+\/complete$/.test(pathname))
    return ["Completar visita", "Agenda", "Registra el cierre y la hora efectiva."];
  if (/^\/app\/visits\/[^/]+$/.test(pathname))
    return ["Detalle de visita", "Agenda", "Consulta y actualiza el estado de la visita."];
  if (/^\/app\/tasks\/[^/]+\/edit$/.test(pathname))
    return ["Editar tarea", "Seguimiento", "Actualiza la acción de seguimiento."];
  if (/^\/app\/tasks\/[^/]+$/.test(pathname))
    return ["Detalle de tarea", "Seguimiento", "Consulta relaciones, estado e historial."];
  if (/^\/app\/sync\/conflicts\/[^/]+$/.test(pathname))
    return ["Resolver conflicto", "Sincronización", "Compara Base, Servidor y Dispositivo."];
  if (pathname === "/app/tasks/new" && new URLSearchParams(window.location.search).has("taskId"))
    return ["Editar tarea", "Seguimiento", "Actualiza el seguimiento pendiente."];
  return titles[pathname];
}

function routeBackHref(pathname: string): string | undefined {
  if (pathname === "/app/accounts/new") return "/app/accounts";
  if (pathname === "/app/visits/new") return "/app/agenda";
  if (pathname === "/app/tasks/new") return "/app/tasks";
  if (pathname === "/app/reports/exports") return "/app/reports";
  if (pathname === "/app/catalogs/document-categories") return "/app/catalogs/fruits";
  const accountChild = pathname.match(
    /^\/app\/accounts\/([^/]+)\/(edit|contacts|visits|tasks|documents)$/,
  );
  if (accountChild) return `/app/accounts/${accountChild[1]}`;
  if (/^\/app\/accounts\/[^/]+$/.test(pathname)) return "/app/accounts";
  const visitComplete = pathname.match(/^\/app\/visits\/([^/]+)\/complete$/);
  if (visitComplete) return `/app/visits/${visitComplete[1]}`;
  if (/^\/app\/visits\/[^/]+$/.test(pathname)) return "/app/agenda";
  const taskEdit = pathname.match(/^\/app\/tasks\/([^/]+)\/edit$/);
  if (taskEdit) return `/app/tasks/${taskEdit[1]}`;
  if (/^\/app\/tasks\/[^/]+$/.test(pathname)) return "/app/tasks";
  if (/^\/app\/sync\/conflicts\/[^/]+$/.test(pathname)) return "/app/sync/conflicts";
  if (pathname === "/app/sync/conflicts") return "/app/sync";
  return pathname === "/app" ? undefined : "/app";
}

function RouteContent({ pathname }: { pathname: string }) {
  const { user } = useSession();
  if (pathname === "/app") return <DashboardPage />;
  if (pathname === "/app/accounts") return <AccountsPage />;
  if (pathname === "/app/accounts/new") return <AccountFormPage />;
  let match = pathname.match(/^\/app\/accounts\/([^/]+)\/edit$/);
  if (match) return <AccountFormPage accountId={match[1]!} />;
  match = pathname.match(/^\/app\/accounts\/([^/]+)\/contacts$/);
  if (match) return <AccountDetailPage accountId={match[1]!} tab="contacts" />;
  match = pathname.match(/^\/app\/accounts\/([^/]+)\/visits$/);
  if (match) return <AccountDetailPage accountId={match[1]!} tab="visits" />;
  match = pathname.match(/^\/app\/accounts\/([^/]+)\/tasks$/);
  if (match) return <AccountDetailPage accountId={match[1]!} tab="tasks" />;
  match = pathname.match(/^\/app\/accounts\/([^/]+)\/documents$/);
  if (match) return <AccountDetailPage accountId={match[1]!} tab="documents" />;
  match = pathname.match(/^\/app\/accounts\/([^/]+)$/);
  if (match) return <AccountDetailPage accountId={match[1]!} />;
  if (pathname === "/app/agenda") return <AgendaPage />;
  if (pathname === "/app/visits/new") return <VisitFormPage />;
  match = pathname.match(/^\/app\/visits\/([^/]+)\/complete$/);
  if (match)
    return <VisitDetailPage action="complete" key={`${match[1]!}:complete`} visitId={match[1]!} />;
  match = pathname.match(/^\/app\/visits\/([^/]+)$/);
  if (match) return <VisitDetailPage key={`${match[1]!}:detail`} visitId={match[1]!} />;
  if (pathname === "/app/tasks") return <TasksPage />;
  if (pathname === "/app/tasks/new") {
    const taskId = new URLSearchParams(window.location.search).get("taskId");
    return taskId ? <TaskFormPage taskId={taskId} /> : <TaskFormPage />;
  }
  match = pathname.match(/^\/app\/tasks\/([^/]+)\/edit$/);
  if (match) return <TaskFormPage taskId={match[1]!} />;
  match = pathname.match(/^\/app\/tasks\/([^/]+)$/);
  if (match) return <TaskDetailPage taskId={match[1]!} />;
  if (pathname === "/app/audit")
    return user?.role === "MANAGER" ? (
      <AuditPage />
    ) : (
      <StatePanel kind="permission" title="No tienes permiso">
        <p>La auditoría está disponible solo para Manager.</p>
        <ButtonLink href="/app">Volver al inicio</ButtonLink>
      </StatePanel>
    );
  if (pathname === "/app/documents") return <DocumentsPage />;
  if (pathname === "/app/notifications") return <NotificationsPage />;
  if (pathname === "/app/reports") return <ReportsPage />;
  if (pathname === "/app/reports/exports") return <ReportsPage exportsOnly />;
  if (pathname === "/app/imports")
    return user?.role === "MANAGER" ? <ImportsPage /> : <ManagerOnly />;
  if (pathname === "/app/users") return user?.role === "MANAGER" ? <UsersPage /> : <ManagerOnly />;
  if (pathname === "/app/catalogs/fruits" || pathname === "/app/catalogs/document-categories")
    return user?.role === "MANAGER" ? <CatalogsPage /> : <ManagerOnly />;
  if (pathname === "/app/settings")
    return user?.role === "MANAGER" ? <SettingsPage /> : <ManagerOnly />;
  if (pathname === "/app/profile") return <ProfilePage />;
  if (pathname === "/app/more") return <MorePage />;
  if (pathname === "/app/sync") return <SyncCenterPage />;
  if (pathname === "/app/sync/conflicts") return <SyncConflictsPage />;
  match = pathname.match(/^\/app\/sync\/conflicts\/([^/]+)$/);
  if (match) return <SyncConflictDetailPage conflictId={match[1]!} />;
  return (
    <StatePanel kind="not-found" title="Página no disponible">
      <p>La ruta no existe o ya no está disponible.</p>
      <ButtonLink href="/app">Volver al inicio</ButtonLink>
    </StatePanel>
  );
}

function ManagerOnly() {
  return (
    <StatePanel kind="permission" title="No tienes permiso">
      <p>Esta sección está disponible solo para Manager.</p>
      <ButtonLink href="/app">Volver al inicio</ButtonLink>
    </StatePanel>
  );
}

function MorePage() {
  const { logout, user } = useSession();
  return (
    <div className="more-grid">
      {user?.role === "MANAGER" ? (
        <>
          <ButtonLink href="/app/users" variant="secondary">
            <Users aria-hidden="true" />
            Usuarios
          </ButtonLink>
          <ButtonLink href="/app/catalogs/fruits" variant="secondary">
            <BookOpen aria-hidden="true" />
            Catálogos
          </ButtonLink>
          <ButtonLink href="/app/imports" variant="secondary">
            <FileText aria-hidden="true" />
            Importaciones
          </ButtonLink>
          <ButtonLink href="/app/audit" variant="secondary">
            <ScrollText aria-hidden="true" />
            Auditoría
          </ButtonLink>
        </>
      ) : null}
      <ButtonLink href="/app/documents" variant="secondary">
        <FileText aria-hidden="true" />
        Documentos
      </ButtonLink>
      <ButtonLink href="/app/reports" variant="secondary">
        <BarChart3 aria-hidden="true" />
        Reportes
      </ButtonLink>
      <ButtonLink href="/app/notifications" variant="secondary">
        <Bell aria-hidden="true" />
        Notificaciones
      </ButtonLink>
      <ButtonLink href="/app/profile" variant="secondary">
        <Users aria-hidden="true" />
        Perfil
      </ButtonLink>
      <ButtonLink href="/app/sync" variant="secondary">
        <RefreshCw aria-hidden="true" />
        Sincronización
      </ButtonLink>
      <Button onClick={() => void logout()} variant="secondary">
        <LogOut aria-hidden="true" />
        Cerrar sesión
      </Button>
    </div>
  );
}

export function App() {
  const { loading, logout, offlineAvailable, user } = useSession();
  const online = useOnlineStatus();
  const offline = useOfflineRuntime(Boolean(user));
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [pathname, setPathname] = useState(window.location.pathname.replace(/\/$/, "") || "/app");
  useEffect(() => {
    const change = () => setPathname(window.location.pathname.replace(/\/$/, "") || "/app");
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener(pwaUpdateReadyEvent, ready);
    return () => window.removeEventListener(pwaUpdateReadyEvent, ready);
  }, []);
  useEffect(() => {
    document.addEventListener("click", handleInternalNavigation);
    return () => document.removeEventListener("click", handleInternalNavigation);
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD || !user || !online) return;
    void Promise.all([
      import("../routes/AccountsPages"),
      import("../routes/VisitsPages"),
      import("../routes/TasksPages"),
    ]);
  }, [online, user]);
  useEffect(() => {
    if (!user) return;
    const target = user.mustChangePassword
      ? "/change-password"
      : pathname === "/change-password" || pathname === "/login"
        ? "/app"
        : null;
    if (target && pathname !== target) {
      window.history.replaceState({}, "", target);
      setPathname(target);
    }
  }, [pathname, user]);
  if (loading)
    return (
      <main className="center-state">
        <StatePanel kind="loading" title="Recuperando sesión">
          <p>Validando tu sesión online.</p>
        </StatePanel>
      </main>
    );
  if (!user) return offlineAvailable && !online ? <OfflineUnlockPage /> : <LoginPage />;
  if (user.mustChangePassword || pathname === "/change-password") return <ChangePasswordPage />;
  const header = routeTitle(pathname) ?? [
    "Página no disponible",
    "Navegación",
    "Regresa a un lugar seguro.",
  ];
  const backHref = routeBackHref(pathname);
  return (
    <AppShell
      mobileNav={<MobileNav items={navigationItems(mobile, pathname, user.role)} />}
      sidebar={
        <Sidebar
          footer={
            <>
              <a className="sidebar-sync-link" href="/app/sync">
                <SyncIndicator
                  label={
                    offline.enabled && offline.status.pending > 0
                      ? `${offline.status.pending} pendiente(s)`
                      : online
                        ? "Sesión online"
                        : "Sin conexión"
                  }
                  state={
                    offline.status.conflicts > 0
                      ? "conflict"
                      : offline.status.syncing
                        ? "syncing"
                        : offline.status.pending > 0
                          ? "pending"
                          : "current"
                  }
                />
              </a>
              <span>{user.fullName}</span>
              <button className="sidebar-logout" onClick={() => void logout()} type="button">
                <LogOut aria-hidden="true" size={16} />
                Cerrar sesión
              </button>
              <small>Versión 0.1.0</small>
            </>
          }
          items={navigationItems(nav, pathname, user.role)}
        />
      }
      status={
        <>
          {!online ? (
            <OfflineBanner
              message={
                offlineEnabled
                  ? "Sin conexión. Trabajas con datos autorizados guardados en este dispositivo."
                  : "Sin conexión. El modo offline está desactivado."
              }
            />
          ) : null}
          {!online && offline.status.lastSyncAt ? (
            <div className="stale-global" role="status">
              Datos hasta{" "}
              {new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(
                new Date(offline.status.lastSyncAt),
              )}
              .
            </div>
          ) : null}
          {updateReady ? (
            <UpdateBanner
              applying={applyingUpdate}
              onApply={async () => {
                setApplyingUpdate(true);
                try {
                  await applyPwaShellUpdateWhenSafe(waitForSyncIdle);
                } finally {
                  setApplyingUpdate(false);
                }
              }}
            />
          ) : null}
        </>
      }
      topBar={<TopBar />}
    >
      <PageHeader
        actions={
          pathname === "/app/accounts" ? (
            <ButtonLink href="/app/accounts/new">Nuevo cliente</ButtonLink>
          ) : undefined
        }
        {...(backHref ? { backHref } : {})}
        description={header[2]}
        eyebrow={header[1]}
        title={header[0]}
      />
      <Suspense fallback={<StatePanel kind="loading" title="Cargando contenido" />}>
        <RouteContent pathname={pathname} />
      </Suspense>
    </AppShell>
  );
}
