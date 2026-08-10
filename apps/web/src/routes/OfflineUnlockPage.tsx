import { Button, Input, StatePanel } from "@vicam/ui";
import { useState, type FormEvent } from "react";
import { useSession } from "../app/session";

export function OfflineUnlockPage() {
  const { unlockOffline } = useSession();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry = new FormData(event.currentTarget).get("pin");
    const pin = typeof entry === "string" ? entry : "";
    setLoading(true);
    setError(undefined);
    try {
      await unlockOffline(pin);
      window.history.replaceState({}, "", "/app");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible desbloquear.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="offline-title">
        <span className="login-wordmark">VICAM</span>
        <p className="login-eyebrow">Acceso local protegido</p>
        <h1 id="offline-title">Desbloquea tus datos offline</h1>
        <p>Ingresa el PIN de seis dígitos configurado en este dispositivo.</p>
        {error ? (
          <StatePanel kind="error" title="No se pudo desbloquear">
            <p>{error}</p>
          </StatePanel>
        ) : null}
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <Input
            autoComplete="off"
            inputMode="numeric"
            label="PIN de seis dígitos"
            maxLength={6}
            minLength={6}
            name="pin"
            pattern="[0-9]{6}"
            required
            type="password"
          />
          <Button loading={loading} type="submit">
            Desbloquear
          </Button>
        </form>
        <p className="login-note">Cinco intentos fallidos eliminan los datos locales protegidos.</p>
      </section>
    </main>
  );
}
