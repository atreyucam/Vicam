import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "./utils";

interface FieldShellProps {
  children: ReactNode;
  error?: string | undefined;
  help?: string | undefined;
  id: string;
  label: string;
  required?: boolean | undefined;
}
function FieldShell({ children, error, help, id, label, required }: FieldShellProps) {
  const description =
    [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("vicam-field", error && "vicam-field--error")}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {help ? (
        <span className="vicam-field__help" id={`${id}-help`}>
          {help}
        </span>
      ) : null}
      <div data-described-by={description}>{children}</div>
      {error ? (
        <span className="vicam-field__error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | undefined;
  help?: string;
  label: string;
}
export function Input({ className, error, help, id, label, required, ...props }: InputProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replaceAll(" ", "-");
  const describedBy =
    [help ? `${fieldId}-help` : "", error ? `${fieldId}-error` : ""].filter(Boolean).join(" ") ||
    undefined;
  return (
    <FieldShell error={error} help={help} id={fieldId} label={label} required={required}>
      <input
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={cx("vicam-input", className)}
        id={fieldId}
        required={required}
        {...props}
      />
    </FieldShell>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string | undefined;
  help?: string;
  label: string;
}
export function Textarea({ className, error, help, id, label, required, ...props }: TextareaProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replaceAll(" ", "-");
  const describedBy =
    [help ? `${fieldId}-help` : "", error ? `${fieldId}-error` : ""].filter(Boolean).join(" ") ||
    undefined;
  return (
    <FieldShell error={error} help={help} id={fieldId} label={label} required={required}>
      <textarea
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={cx("vicam-textarea", className)}
        id={fieldId}
        required={required}
        {...props}
      />
    </FieldShell>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
  error?: string | undefined;
  help?: string;
  label: string;
}
export function Select({
  children,
  className,
  error,
  help,
  id,
  label,
  required,
  ...props
}: SelectProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replaceAll(" ", "-");
  const describedBy =
    [help ? `${fieldId}-help` : "", error ? `${fieldId}-error` : ""].filter(Boolean).join(" ") ||
    undefined;
  return (
    <FieldShell error={error} help={help} id={fieldId} label={label} required={required}>
      <select
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={cx("vicam-select", className)}
        id={fieldId}
        required={required}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function FormSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <fieldset className="vicam-form-section">
      <legend>{title}</legend>
      {description ? <p>{description}</p> : null}
      <div className="vicam-form-grid">{children}</div>
    </fieldset>
  );
}

export function ErrorSummary({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="vicam-error-summary" role="alert" tabIndex={-1}>
      <strong>Revisa la información</strong>
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

export function StickyActionBar({ children }: { children: ReactNode }) {
  return <div className="vicam-sticky-actions">{children}</div>;
}
