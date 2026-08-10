import { Button, SkeletonList, StatePanel } from "@vicam/ui";
import { ApiError } from "../api/api";
import { formatInstantInZone } from "../lib/timezone";

export function LoadBoundary({
  children,
  error,
  loading,
  reload,
}: {
  children: React.ReactNode;
  error?: Error | undefined;
  loading: boolean;
  reload: () => void;
}) {
  if (loading) return <SkeletonList />;
  if (!error) return <>{children}</>;
  const status = error instanceof ApiError ? error.status : 500;
  const requestId = error instanceof ApiError ? error.envelope?.requestId : undefined;
  const kind =
    status === 403
      ? "permission"
      : status === 409
        ? "conflict"
        : status === 422
          ? "validation"
          : status === 429
            ? "rate-limited"
            : status === 404
              ? "not-found"
              : status === 401
                ? "session-expired"
                : status >= 500
                  ? "server-error"
                  : "error";
  const titles = {
    permission: "No tienes permiso",
    conflict: "Los datos cambiaron",
    validation: "Revisa la información",
    "rate-limited": "Demasiadas solicitudes",
    "not-found": "Recurso no disponible",
    "session-expired": "Tu sesión venció",
    "server-error": "El servicio no está disponible",
    error: "No pudimos cargar los datos",
  } as const;
  return (
    <StatePanel kind={kind} title={titles[kind]}>
      <p>{status === 429 ? "Espera un momento antes de volver a intentar." : error.message}</p>
      {requestId ? (
        <p>
          Referencia: <code>{requestId}</code>
        </p>
      ) : null}
      <Button onClick={reload} variant="secondary">
        Reintentar
      </Button>
    </StatePanel>
  );
}
export const formatDateTime = (value: string, timeZone = "America/Guayaquil") =>
  formatInstantInZone(value, timeZone);
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
export function formValue(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
export function go(path: string) {
  const target = new URL(path, window.location.href);
  if (target.origin !== window.location.origin) {
    window.location.assign(target.href);
    return;
  }
  window.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function handleInternalNavigation(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey
  )
    return;
  const target = event.target;
  const anchor = target instanceof Element ? target.closest("a") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (anchor.hasAttribute("download") || anchor.hash.startsWith("#")) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  event.preventDefault();
  go(`${url.pathname}${url.search}${url.hash}`);
}
