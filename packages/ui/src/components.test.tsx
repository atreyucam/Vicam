import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalendarDays, Home } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AppShell,
  Button,
  Dialog,
  Input,
  MobileNav,
  PageHeader,
  Sidebar,
  StatePanel,
  TopBar,
  UpdateBanner,
} from "./index";

const items = [
  { active: true, href: "/app", icon: <Home aria-hidden="true" />, label: "Inicio" },
  { href: "/app/agenda", icon: <CalendarDays aria-hidden="true" />, label: "Agenda" },
];

describe("componentes base VICAM", () => {
  it("expone el estado de carga y evita acciones duplicadas", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Procesando" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marca la ruta activa en ambas navegaciones", () => {
    render(
      <>
        <Sidebar items={items} />
        <MobileNav items={items} />
      </>,
    );
    const currentLinks = screen.getAllByRole("link", { name: "Inicio" });
    expect(currentLinks).toHaveLength(2);
    currentLinks.forEach((link) => expect(link).toHaveAttribute("aria-current", "page"));
  });

  it("incluye skip link, main enfocable y destinos reales", () => {
    render(
      <AppShell
        mobileNav={<MobileNav items={items} />}
        sidebar={<Sidebar items={items} />}
        topBar={<TopBar />}
      >
        <StatePanel kind="empty" title="Sin elementos">
          Agrega el primero cuando esté disponible.
        </StatePanel>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Saltar al contenido principal" })).toHaveAttribute(
      "href",
      "#contenido-principal",
    );
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: "Ver notificaciones" })).toHaveAttribute(
      "href",
      "/app/notifications",
    );
  });

  it("asocia ayuda y error persistentes al campo", () => {
    render(
      <Input
        error="Ingresa un valor válido"
        help="Usa el nombre comercial."
        label="Nombre"
        name="displayName"
        required
      />,
    );
    const input = screen.getByRole("textbox", { name: /Nombre/ });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "displayName-help displayName-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Ingresa un valor válido");
  });

  it("muestra Regresar con icono antes del título cuando existe destino", () => {
    render(<PageHeader backHref="/app/clientes" title="Nuevo cliente" />);
    const back = screen.getByRole("link", { name: "Regresar" });
    expect(back).toHaveAttribute("href", "/app/clientes");
    expect(back.querySelector("svg")).not.toBeNull();
    expect(
      back.compareDocumentPosition(screen.getByRole("heading", { name: "Nuevo cliente" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("bloquea acciones duplicadas mientras la actualización espera la sincronización", () => {
    const onApply = vi.fn();
    render(<UpdateBanner applying onApply={onApply} />);
    expect(
      screen.getByText("Esperando que termine la sincronización para actualizar."),
    ).toBeVisible();
    const button = screen.getByRole("button", { name: "Actualizando" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("gestiona título, descripción, foco inicial, Escape y retorno de foco", async () => {
    function DialogHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Abrir confirmación</Button>
          {open ? (
            <Dialog
              description="Explica el impacto antes de confirmar."
              onClose={() => setOpen(false)}
              title="Confirmar acción"
            >
              <Input data-dialog-initial-focus label="Motivo" name="reason" />
              <Button onClick={() => setOpen(false)}>Confirmar</Button>
            </Dialog>
          ) : null}
        </>
      );
    }

    const rendered = render(<DialogHarness />);
    const trigger = rendered.getByRole("button", { name: "Abrir confirmación" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Confirmar acción" });
    expect(dialog).toHaveAccessibleDescription("Explica el impacto antes de confirmar.");
    const input = screen.getByRole("textbox", { name: "Motivo" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cerrar diálogo" })).toBeVisible();
    expect(rendered.container).toHaveProperty("inert", true);
    expect(document.body).toHaveStyle({ overflow: "hidden" });

    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(Boolean(rendered.container.inert)).toBe(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
