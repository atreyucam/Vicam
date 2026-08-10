import {
  AlertTriangle,
  Ban,
  CircleAlert,
  CloudOff,
  FileQuestion,
  LoaderCircle,
  RefreshCw,
  SearchX,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./actions";
import { cx } from "./utils";

export type StateKind =
  | "loading"
  | "empty"
  | "no-results"
  | "error"
  | "not-found"
  | "validation"
  | "rate-limited"
  | "server-error"
  | "session-expired"
  | "permission"
  | "offline"
  | "stale"
  | "pending"
  | "syncing"
  | "conflict";

const icons = {
  loading: LoaderCircle,
  empty: FileQuestion,
  "no-results": SearchX,
  error: CircleAlert,
  "not-found": FileQuestion,
  validation: CircleAlert,
  "rate-limited": AlertTriangle,
  "server-error": TriangleAlert,
  "session-expired": ShieldAlert,
  permission: ShieldAlert,
  offline: CloudOff,
  stale: AlertTriangle,
  pending: RefreshCw,
  syncing: RefreshCw,
  conflict: TriangleAlert,
} as const;

export interface StatePanelProps {
  actionLabel?: string;
  children?: ReactNode;
  className?: string;
  kind: StateKind;
  onAction?: () => void;
  title: string;
}

export function StatePanel({
  actionLabel,
  children,
  className,
  kind,
  onAction,
  title,
}: StatePanelProps) {
  const Icon = icons[kind];
  const isLive = kind === "loading" || kind === "syncing";

  return (
    <section
      aria-atomic={isLive || undefined}
      aria-live={isLive ? "polite" : undefined}
      className={cx("vicam-state", `vicam-state--${kind}`, className)}
    >
      <Icon aria-hidden="true" className={isLive ? "vicam-spin" : undefined} size={24} />
      <div className="vicam-state__copy">
        <h2>{title}</h2>
        {children ? <div className="vicam-state__description">{children}</div> : null}
      </div>
      {actionLabel && onAction ? (
        <Button onClick={onAction} variant="secondary">
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}

export interface OfflineBannerProps {
  message?: string;
}

export function OfflineBanner({
  message = "Sin conexión. Puedes consultar el contenido disponible en este dispositivo.",
}: OfflineBannerProps) {
  return (
    <div aria-live="polite" className="vicam-banner vicam-banner--warning" role="status">
      <CloudOff aria-hidden="true" size={18} />
      <span>{message}</span>
    </div>
  );
}

export interface UpdateBannerProps {
  applying?: boolean;
  onApply: () => void | Promise<void>;
}

export function UpdateBanner({ applying = false, onApply }: UpdateBannerProps) {
  return (
    <div aria-live="polite" className="vicam-banner vicam-banner--update" role="status">
      <RefreshCw aria-hidden="true" size={18} />
      <span>
        {applying
          ? "Esperando que termine la sincronización para actualizar."
          : "Nueva versión lista."}
      </span>
      <Button
        loading={applying}
        loadingLabel="Actualizando"
        onClick={() => void onApply()}
        variant="secondary"
      >
        Actualizar
      </Button>
    </div>
  );
}

export interface StaleDataNoticeProps {
  updatedAt: string;
}

export function StaleDataNotice({ updatedAt }: StaleDataNoticeProps) {
  return (
    <div className="vicam-banner vicam-banner--warning" role="status">
      <AlertTriangle aria-hidden="true" size={18} />
      <span>Datos hasta {updatedAt}.</span>
    </div>
  );
}

export interface SyncIndicatorProps {
  label: string;
  state?: "current" | "pending" | "syncing" | "conflict";
}

export function SyncIndicator({ label, state = "current" }: SyncIndicatorProps) {
  const Icon = state === "conflict" ? Ban : state === "current" ? RefreshCw : LoaderCircle;
  return (
    <span className={cx("vicam-sync-indicator", `vicam-sync-indicator--${state}`)} role="status">
      <Icon
        aria-hidden="true"
        className={state === "syncing" ? "vicam-spin" : undefined}
        size={16}
      />
      {label}
    </span>
  );
}
