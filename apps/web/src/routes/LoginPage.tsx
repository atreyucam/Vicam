import { Button, Input, StatePanel } from "@vicam/ui";
import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api/api";
import { useSession } from "../app/session";
import { formValue, go } from "./shared";

export function LoginPage() {
  const { expired, login } = useSession();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await login({
        username: formValue(data, "username"),
        password: formValue(data, "password"),
        deviceName: "Navegador web",
        platform: "web",
      });
      go("/app");
    } catch (reason) {
      const apiError = reason instanceof ApiError ? reason : null;
      setError(
        apiError
          ? {
              status: apiError.status,
              message:
                apiError.status === 429
                  ? "Demasiados intentos. Espera antes de volver a intentar."
                  : "Usuario o contraseña incorrectos.",
            }
          : { message: "Necesitas conexión para iniciar sesión." },
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page" id="contenido-principal">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-wordmark">VICAM</div>
        <p className="login-eyebrow">Gestión comercial</p>
        <h1 id="login-title">Iniciar sesión</h1>
        <p>Accede con tus credenciales internas.</p>
        {expired ? (
          <StatePanel kind="session-expired" title="Tu sesión venció">
            <p>Inicia sesión nuevamente para continuar.</p>
          </StatePanel>
        ) : null}
        {error ? (
          <StatePanel
            kind={error.status === 429 ? "rate-limited" : "error"}
            title={error.status === 429 ? "Espera requerida" : "No pudimos iniciar sesión"}
          >
            <p>{error.message}</p>
          </StatePanel>
        ) : null}
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <Input autoComplete="username" label="Usuario" name="username" required />
          <div className="password-field">
            <Input
              autoComplete="current-password"
              label="Contraseña"
              name="password"
              required
              type={visible ? "text" : "password"}
            />
            <button
              aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
              onClick={() => setVisible((value) => !value)}
              type="button"
            >
              {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
          <Button loading={busy} loadingLabel="Iniciando sesión" type="submit">
            Iniciar sesión
          </Button>
        </form>
        <p className="login-note">El primer acceso requiere conexión a internet.</p>
        <small>Versión 0.1.0</small>
      </section>
    </main>
  );
}
