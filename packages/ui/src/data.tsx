import { CheckCircle2, Circle, Clock3, FileSpreadsheet, FileText, Flag } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./utils";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return <span className={cx("vicam-badge", `vicam-badge--${tone}`)}>{children}</span>;
}
export function PriorityBadge({ priority }: { priority: "LOW" | "MEDIUM" | "HIGH" }) {
  const labels = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" };
  return (
    <StatusBadge tone={priority === "HIGH" ? "danger" : priority === "MEDIUM" ? "warning" : "info"}>
      <Flag aria-hidden="true" size={13} />
      Prioridad {labels[priority]}
    </StatusBadge>
  );
}
export function StatCard({
  label,
  value,
  detail,
}: {
  detail?: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <article className="vicam-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}
export function Card({
  actions,
  children,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <article className="vicam-card">
      {title || actions ? (
        <header>
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </article>
  );
}
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div aria-label={label} className="vicam-segmented" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Timeline({
  items,
}: {
  items: Array<{ detail: ReactNode; state?: "done" | "current"; title: string }>;
}) {
  return (
    <ol className="vicam-timeline">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          {item.state === "done" ? (
            <CheckCircle2 aria-hidden="true" />
          ) : item.state === "current" ? (
            <Clock3 aria-hidden="true" />
          ) : (
            <Circle aria-hidden="true" />
          )}
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Cargando contenido"
      className="vicam-skeleton-list"
      role="status"
    >
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function DocumentRow({
  actions,
  category,
  context,
  format,
  name,
  size,
  status,
}: {
  actions?: ReactNode;
  category: string;
  context: string;
  format: "PDF" | "DOCX" | "XLSX";
  name: string;
  size: string;
  status: ReactNode;
}) {
  const Icon = format === "XLSX" ? FileSpreadsheet : FileText;
  return (
    <article className="vicam-document-row">
      <Icon aria-hidden="true" size={24} />
      <div>
        <strong>{name}</strong>
        <span>
          {format} · {category} · {size}
        </span>
        <small>{context}</small>
      </div>
      <div className="vicam-document-row__status">{status}</div>
      {actions ? <div className="vicam-document-row__actions">{actions}</div> : null}
    </article>
  );
}
