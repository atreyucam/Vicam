import { ArrowLeft, Bell, Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./actions";

export interface NavigationItem {
  active?: boolean;
  href: string;
  icon: ReactNode;
  label: string;
}

export interface SidebarProps {
  footer?: ReactNode;
  items: NavigationItem[];
  productName?: string;
}

export function Sidebar({ footer, items, productName = "VICAM" }: SidebarProps) {
  return (
    <aside aria-label="Navegación principal" className="vicam-sidebar">
      <a className="vicam-wordmark" href="/app">
        {productName}
      </a>
      <nav aria-label="Navegación principal de escritorio">
        <ul className="vicam-sidebar__list">
          {items.map((item) => (
            <li key={item.href}>
              <a
                aria-current={item.active ? "page" : undefined}
                className="vicam-nav-link"
                href={item.href}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {footer ? <div className="vicam-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}

export interface MobileNavProps {
  items: NavigationItem[];
}

export function MobileNav({ items }: MobileNavProps) {
  return (
    <nav aria-label="Navegación principal móvil" className="vicam-mobile-nav">
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <a
              aria-current={item.active ? "page" : undefined}
              className="vicam-mobile-nav__link"
              href={item.href}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface TopBarProps {
  menuExpanded?: boolean;
  notificationHref?: string;
  onMenuClick?: () => void;
  title?: string;
}

export function TopBar({
  menuExpanded = false,
  notificationHref = "/app/notifications",
  onMenuClick,
  title = "VICAM",
}: TopBarProps) {
  return (
    <header className="vicam-topbar">
      {onMenuClick ? (
        <IconButton
          accessibleLabel={menuExpanded ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuExpanded}
          onClick={onMenuClick}
        >
          {menuExpanded ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </IconButton>
      ) : null}
      <a className="vicam-wordmark" href="/app">
        {title}
      </a>
      <a
        aria-label="Ver notificaciones"
        className="vicam-icon-button vicam-icon-button--ghost"
        href={notificationHref}
      >
        <Bell aria-hidden="true" />
      </a>
    </header>
  );
}

export interface PageHeaderProps {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}

export function PageHeader({
  actions,
  backHref,
  backLabel = "Regresar",
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <header className="vicam-page-header">
      <div>
        {backHref ? (
          <a className="vicam-page-header__back" href={backHref}>
            <ArrowLeft aria-hidden="true" size={18} />
            {backLabel}
          </a>
        ) : null}
        {eyebrow ? <p className="vicam-page-header__eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <div className="vicam-page-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="vicam-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface AppShellProps {
  children: ReactNode;
  mobileNav: ReactNode;
  sidebar: ReactNode;
  status?: ReactNode;
  topBar: ReactNode;
}

export function AppShell({ children, mobileNav, sidebar, status, topBar }: AppShellProps) {
  return (
    <div className="vicam-app-shell">
      <a className="vicam-skip-link" href="#contenido-principal">
        Saltar al contenido principal
      </a>
      {sidebar}
      <div className="vicam-app-shell__body">
        {topBar}
        {status}
        <main className="vicam-main" id="contenido-principal" tabIndex={-1}>
          {children}
        </main>
      </div>
      {mobileNav}
    </div>
  );
}
