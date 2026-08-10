import { describe, expect, it, vi } from "vitest";
import { go, handleInternalNavigation } from "./shared";

describe("navegación interna", () => {
  it("actualiza la ruta sin recargar el documento", () => {
    const listener = vi.fn();
    window.addEventListener("popstate", listener);
    go("/app/accounts?status=ACTIVE");
    expect(window.location.pathname).toBe("/app/accounts");
    expect(window.location.search).toBe("?status=ACTIVE");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", listener);
  });

  it("intercepta enlaces internos y conserva enlaces de salto", () => {
    document.body.innerHTML =
      '<a id="internal" href="/app/tasks">Tareas</a><a id="skip" href="#contenido">Saltar</a>';
    const internal = document.querySelector<HTMLAnchorElement>("#internal")!;
    const internalEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    internal.addEventListener("click", handleInternalNavigation);
    internal.dispatchEvent(internalEvent);
    expect(internalEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/app/tasks");

    const skip = document.querySelector<HTMLAnchorElement>("#skip")!;
    const skipEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    skip.addEventListener("click", handleInternalNavigation);
    skip.dispatchEvent(skipEvent);
    expect(skipEvent.defaultPrevented).toBe(false);
  });
});
