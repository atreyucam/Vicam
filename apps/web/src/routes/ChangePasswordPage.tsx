import { Button, ErrorSummary, Input, StatePanel } from "@vicam/ui";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api/api";
import { useSession } from "../app/session";
import { formValue } from "./shared";

const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,128}$/;

export function ChangePasswordPage() {
  const { changePassword } = useSession();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = formValue(data, "currentPassword");
    const newPassword = formValue(data, "newPassword");
    const confirmation = formValue(data, "confirmation");
    const validation: string[] = [];
    if (!currentPassword) validation.push("Ingresa tu contraseña actual.");
    if (!passwordRule.test(newPassword))
      validation.push(
        "La nueva contraseña debe tener entre 8 y 128 caracteres, mayúscula, minúscula, número y símbolo.",
      );
    if (newPassword !== confirmation) validation.push("Las contraseñas nuevas no coinciden.");
    if (currentPassword === newPassword)
      validation.push("La nueva contraseña debe ser diferente de la actual.");
    if (validation.length) {
      setErrors(validation);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await changePassword({ currentPassword, newPassword });
      window.location.assign("/app");
    } catch (reason) {
      setErrors([
        reason instanceof ApiError
          ? reason.status === 401
            ? "La contraseña actual no es correcta."
            : reason.message
          : "No pudimos cambiar la contraseña ni restablecer la sesión.",
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page" id="contenido-principal">
      <section className="login-card" aria-labelledby="change-password-title">
        <div className="login-wordmark">VICAM</div>
        <p className="login-eyebrow">Seguridad de la cuenta</p>
        <h1 id="change-password-title">Cambia tu contraseña</h1>
        <StatePanel kind="pending" title="Cambio obligatorio">
          <p>Debes definir una contraseña personal antes de acceder a la aplicación.</p>
        </StatePanel>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <ErrorSummary errors={errors} />
          <Input
            autoComplete="current-password"
            label="Contraseña actual"
            name="currentPassword"
            required
            type="password"
          />
          <Input
            autoComplete="new-password"
            label="Nueva contraseña"
            name="newPassword"
            required
            type="password"
          />
          <Input
            autoComplete="new-password"
            label="Confirma la nueva contraseña"
            name="confirmation"
            required
            type="password"
          />
          <Button loading={busy} loadingLabel="Cambiando contraseña" type="submit">
            Cambiar contraseña
          </Button>
        </form>
      </section>
    </main>
  );
}
