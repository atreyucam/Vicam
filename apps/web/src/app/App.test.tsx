import { render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const logout = vi.fn();
let mustChangePassword = false;
const changePassword = vi.fn();
vi.mock("./session", () => ({
  useSession: () => ({
    expired: false,
    changePassword,
    loading: false,
    logout,
    user: {
      id: "019b3e83-7a28-7000-8000-000000000001",
      username: "manager",
      fullName: "María Manager",
      role: "MANAGER",
      timezone: "America/Guayaquil",
      mustChangePassword,
    },
  }),
}));
vi.mock("../api/useAsync", () => ({
  useAsync: () => ({ data: { visits: [], tasks: [] }, loading: false, reload: vi.fn() }),
}));

describe("aplicación Fase 1", () => {
  beforeEach(() => {
    mustChangePassword = false;
    window.history.replaceState({}, "", "/app");
  });
  it("renderiza inicio y navegación Manager por rol", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Auditoría" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Saltar al contenido principal" })).toHaveAttribute(
      "href",
      "#contenido-principal",
    );
  });
  it("muestra Regresar sobre el título de un módulo principal", () => {
    window.history.replaceState({}, "", "/app/accounts");
    render(<App />);

    const back = screen.getByRole("link", { name: "Regresar" });
    expect(back).toHaveAttribute("href", "/app");
    expect(screen.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
  });
  it("bloquea una URL de negocio mientras el cambio es obligatorio", async () => {
    mustChangePassword = true;
    window.history.replaceState({}, "", "/app/accounts");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Cambia tu contraseña" })).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe("/change-password"));
  });

  it("impide volver a la ruta de cambio después de resolverlo", async () => {
    window.history.replaceState({}, "", "/change-password");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/app"));
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  });
  it("no presenta infracciones axe automáticas", async () => {
    const { container } = render(<App />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    await waitFor(() => expect(results.violations).toEqual([]));
  });
});
