import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = "Procesando",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx("vicam-button", `vicam-button--${variant}`, className)}
      disabled={disabled || loading}
      type={type}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="vicam-spin" size={18} /> : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accessibleLabel: string;
  children: ReactNode;
  variant?: Exclude<ButtonVariant, "primary">;
}

export function IconButton({
  accessibleLabel,
  children,
  className,
  type = "button",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={accessibleLabel}
      className={cx("vicam-icon-button", `vicam-icon-button--${variant}`, className)}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentPropsWithoutRef<"a"> & {
  variant?: ButtonVariant;
};

export function ButtonLink({ className, variant = "primary", ...props }: ButtonLinkProps) {
  return <a className={cx("vicam-button", `vicam-button--${variant}`, className)} {...props} />;
}
