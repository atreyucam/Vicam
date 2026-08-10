import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createIdempotencyKey,
  idempotencyParams,
  useIdempotencyKey,
  useIdempotencyKeyController,
} from "./idempotency";

function Intent() {
  const key = useIdempotencyKey();
  return <output>{key}</output>;
}

function RotatingIntent() {
  const intent = useIdempotencyKeyController();
  return (
    <>
      <output>{intent.current()}</output>
      <button onClick={() => intent.rotate()}>Completar</button>
    </>
  );
}

describe("Idempotency-Key por intención", () => {
  it("genera UUID distintos para acciones nuevas", () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).not.toBe(first);
    expect(idempotencyParams(first)).toEqual({ header: { "idempotency-key": first } });
  });

  it("conserva la clave durante rerenders y crea otra al remontar", () => {
    const firstRender = render(<Intent />);
    const first = screen.getByRole("status").textContent;
    firstRender.rerender(<Intent />);
    expect(screen.getByRole("status")).toHaveTextContent(first);
    firstRender.unmount();

    render(<Intent />);
    expect(screen.getByRole("status").textContent).not.toBe(first);
  });

  it("rota la clave solamente después de completar una intención", () => {
    const view = render(<RotatingIntent />);
    const first = screen.getByRole("status").textContent;
    fireEvent.click(screen.getByRole("button", { name: "Completar" }));
    view.rerender(<RotatingIntent />);
    expect(screen.getByRole("status").textContent).not.toBe(first);
  });
});
