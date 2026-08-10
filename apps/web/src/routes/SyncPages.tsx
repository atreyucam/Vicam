import { Button, ButtonLink, Card, Input, StatePanel, StatusBadge } from "@vicam/ui";
import { useEffect, useState, type FormEvent } from "react";
import { api, unwrap } from "../api/api";
import { useSession } from "../app/session";
import { offlineEnabled } from "../offline/config";
import { encryptJson } from "../offline/crypto";
import { offlineDb } from "../offline/db";
import { retryOperation } from "../offline/queue";
import { readConflict, readQueueOperations, useOfflineRuntime } from "../offline/useOfflineRuntime";
import type { QueueOperation } from "../offline/types";
import {
  enrollOfflineDevice,
  getOfflineAuthorization,
  getRuntimeDek,
  isOfflineVaultUnlocked,
  unlockOfflineVault,
} from "../offline/vault";
import { go } from "./shared";

interface SyncConflict {
  id: string;
  entityType: "ACCOUNT" | "CONTACT" | "VISIT" | "TASK";
  entityId: string;
  serverVersion: number;
  code: string;
  conflictingFields: string[];
  base: Record<string, unknown>;
  server: Record<string, unknown>;
  device: Record<string, unknown>;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

function dateTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Aún no disponible";
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

const fieldLabels: Record<string, string> = {
  accountType: "Tipo de cliente",
  actualEndedAt: "Hora real de finalización",
  actualStartedAt: "Hora real de inicio",
  address: "Dirección",
  city: "Ciudad",
  countryCode: "País",
  description: "Descripción",
  displayName: "Nombre visible",
  dueDate: "Fecha de vencimiento",
  dueTime: "Hora de vencimiento",
  email: "Correo electrónico",
  fruitIds: "Frutas",
  isPrimary: "Contacto principal",
  legalName: "Razón social",
  notes: "Notas",
  observation: "Observación",
  ownerUserId: "Responsable",
  phone: "Teléfono",
  priority: "Prioridad",
  reason: "Motivo",
  responsibleUserId: "Responsable",
  scheduledAt: "Fecha y hora programada",
  stateProvince: "Estado o provincia",
  status: "Estado",
  timezone: "Zona horaria",
  title: "Título",
};
const entityLabels: Record<SyncConflict["entityType"], string> = {
  ACCOUNT: "Cliente",
  CONTACT: "Contacto",
  TASK: "Tarea",
  VISIT: "Visita",
};

export function conflictFieldLabel(field: string): string {
  return fieldLabels[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").toLocaleLowerCase("es-EC");
}

export function SyncCenterPage() {
  const { user } = useSession();
  const runtime = useOfflineRuntime(Boolean(user));
  const [operations, setOperations] = useState<QueueOperation[]>([]);
  const [configured, setConfigured] = useState(false);
  const [setupError, setSetupError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [unlocked, setUnlocked] = useState(isOfflineVaultUnlocked());

  useEffect(() => {
    if (!offlineEnabled) return;
    void getOfflineAuthorization().then((value) => setConfigured(Boolean(value)));
    void readQueueOperations().then(setOperations);
  }, [runtime.status]);

  async function setup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    const pin = formText(form, "pin");
    const confirmation = formText(form, "pinConfirmation");
    if (!/^\d{6}$/.test(pin) || pin !== confirmation) {
      setSetupError("El PIN debe tener seis dígitos y coincidir con la confirmación.");
      return;
    }
    setSaving(true);
    setSetupError(undefined);
    try {
      const device = unwrap(
        await api.POST("/devices", {
          body: { name: "PWA VICAM", platform: navigator.userAgent.slice(0, 100) },
        }),
      );
      const grant = unwrap(
        await api.POST("/auth/offline-grants", { body: { deviceId: device.id } }),
      );
      await enrollOfflineDevice({
        deviceId: device.id,
        expiresAt: grant.expiresAt,
        grantToken: grant.grantToken,
        issuedAt: grant.issuedAt,
        pin,
        user,
      });
      setConfigured(true);
      setUnlocked(true);
      await runtime.synchronize();
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : "No fue posible activar el acceso offline.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pin = formText(new FormData(event.currentTarget), "unlockPin");
    setSaving(true);
    setSetupError(undefined);
    try {
      await unlockOfflineVault(pin);
      setUnlocked(true);
      await runtime.synchronize();
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : "No fue posible desbloquear.");
    } finally {
      setSaving(false);
    }
  }

  if (!offlineEnabled)
    return (
      <StatePanel kind="offline" title="Modo online activo">
        <p>El almacenamiento y la sincronización offline están desactivados por configuración.</p>
      </StatePanel>
    );

  if (!configured)
    return (
      <Card title="Configurar acceso offline">
        <p>Con conexión, crea un PIN local. Su vigencia máxima es de 72 horas.</p>
        {setupError ? (
          <p className="form-error" role="alert">
            {setupError}
          </p>
        ) : null}
        <form className="sync-pin-form" onSubmit={(event) => void setup(event)}>
          <Input
            inputMode="numeric"
            label="PIN de seis dígitos"
            maxLength={6}
            name="pin"
            pattern="[0-9]{6}"
            required
            type="password"
          />
          <Input
            inputMode="numeric"
            label="Confirma el PIN"
            maxLength={6}
            name="pinConfirmation"
            pattern="[0-9]{6}"
            required
            type="password"
          />
          <Button disabled={!navigator.onLine} loading={saving} type="submit">
            Activar acceso offline
          </Button>
        </form>
      </Card>
    );

  if (!unlocked)
    return (
      <Card title="Desbloquear datos offline">
        <p>El dispositivo está autorizado. Ingresa tu PIN para abrir la bóveda local.</p>
        {setupError ? (
          <p className="form-error" role="alert">
            {setupError}
          </p>
        ) : null}
        <form className="sync-pin-form" onSubmit={(event) => void unlock(event)}>
          <Input
            inputMode="numeric"
            label="PIN de seis dígitos"
            maxLength={6}
            name="unlockPin"
            pattern="[0-9]{6}"
            required
            type="password"
          />
          <Button loading={saving} type="submit">
            Desbloquear y sincronizar
          </Button>
        </form>
      </Card>
    );

  return (
    <div className="sync-layout">
      {runtime.error ? (
        <StatePanel
          actionLabel="Reintentar"
          kind="error"
          onAction={() => void runtime.synchronize()}
          title="Sincronización interrumpida"
        >
          <p>{runtime.error}</p>
        </StatePanel>
      ) : null}
      <section className="sync-summary" aria-label="Resumen de sincronización">
        <Card title="Conexión">
          <strong>{navigator.onLine ? "En línea" : "Sin conexión"}</strong>
          <span>Última sync: {dateTime(runtime.status.lastSyncAt)}</span>
        </Card>
        <Card title="Pendientes">
          <strong>{runtime.status.pending}</strong>
          <span>{runtime.status.failed} fallidas</span>
        </Card>
        <Card title="Conflictos">
          <strong>{runtime.status.conflicts}</strong>
          <span>{user?.role === "MANAGER" ? "Puedes resolverlos" : "Requieren un Manager"}</span>
        </Card>
        <Card title="Vigencia offline">
          <strong>{dateTime(runtime.status.grantExpiresAt)}</strong>
          <span>Máximo 72 horas</span>
        </Card>
      </section>
      <div className="sync-actions">
        <Button
          disabled={!navigator.onLine || runtime.status.syncing}
          loading={runtime.status.syncing}
          onClick={() => void runtime.synchronize()}
        >
          Sincronizar ahora
        </Button>
      </div>
      <Card title="Operaciones locales">
        {operations.length === 0 ? (
          <StatePanel kind="empty" title="No hay operaciones pendientes">
            <p>Todos los cambios locales fueron procesados.</p>
          </StatePanel>
        ) : (
          <ul className="sync-operation-list">
            {operations.map((operation) => (
              <li key={operation.clientOperationId}>
                <div>
                  <strong>{operation.entityType}</strong>
                  <span>
                    {dateTime(operation.occurredAt)} · {operation.attempts} intentos
                  </span>
                </div>
                <StatusBadge
                  tone={
                    operation.status === "FAILED" || operation.status === "CONFLICT"
                      ? "danger"
                      : "warning"
                  }
                >
                  {operation.status === "FAILED"
                    ? "Fallida"
                    : operation.status === "CONFLICT"
                      ? "Conflicto"
                      : "Pendiente"}
                </StatusBadge>
                {operation.status === "FAILED" ? (
                  <Button
                    onClick={() => void retryOperation(operation.clientOperationId)}
                    variant="secondary"
                  >
                    Reintentar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {runtime.status.conflicts > 0 ? (
        <ButtonLink href="/app/sync/conflicts" variant="secondary">
          Ver conflictos
        </ButtonLink>
      ) : null}
    </div>
  );
}

export function SyncConflictsPage() {
  const { user } = useSession();
  const [conflicts, setConflicts] = useState<SyncConflict[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api
      .GET("/sync/conflicts")
      .then(unwrap)
      .then(setConflicts)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "No fue posible consultar conflictos."),
      );
  }, []);
  if (error)
    return (
      <StatePanel kind="error" title="No se pudieron cargar los conflictos">
        <p>{error}</p>
      </StatePanel>
    );
  if (!conflicts) return <StatePanel kind="loading" title="Cargando conflictos" />;
  if (conflicts.length === 0) return <StatePanel kind="empty" title="No hay conflictos abiertos" />;
  return (
    <ul className="conflict-list">
      {conflicts.map((conflict) => (
        <li key={conflict.id}>
          <Card title={`${entityLabels[conflict.entityType]} con cambios simultáneos`}>
            <p>{conflict.conflictingFields.map(conflictFieldLabel).join(", ")}</p>
            <p>
              {user?.role === "MANAGER"
                ? "Compara las versiones antes de resolver."
                : "Un Manager debe resolver este conflicto."}
            </p>
            <ButtonLink href={`/app/sync/conflicts/${conflict.id}`} variant="secondary">
              Comparar versiones
            </ButtonLink>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function SyncConflictDetailPage({ conflictId }: { conflictId: string }) {
  const { user } = useSession();
  const [conflict, setConflict] = useState<SyncConflict>();
  const [selection, setSelection] = useState<"SERVER" | "DEVICE" | "MERGED">("SERVER");
  const [fieldSelections, setFieldSelections] = useState<Record<string, "SERVER" | "DEVICE">>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    void readConflict<SyncConflict>(conflictId)
      .then(setConflict)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "No fue posible abrir el conflicto."),
      );
  }, [conflictId]);
  if (error)
    return (
      <StatePanel kind="error" title="No se pudo abrir el conflicto">
        <p>{error}</p>
      </StatePanel>
    );
  if (!conflict) return <StatePanel kind="loading" title="Cargando comparación" />;
  async function resolve() {
    try {
      const resolved = unwrap(
        await api.POST("/sync/conflicts/{id}/resolve", {
          params: { path: { id: conflictId } },
          body:
            selection === "MERGED"
              ? {
                  resolution: "MERGED",
                  mergedFields: Object.fromEntries(
                    fields.map((field) => [
                      field,
                      (fieldSelections[field] ?? "SERVER") === "SERVER"
                        ? conflict!.server[field]
                        : conflict!.device[field],
                    ]),
                  ),
                }
              : { resolution: selection },
        }),
      );
      const db = offlineDb();
      await db.transaction("rw", db.conflicts, db.operations, db.entities, async () => {
        if (selection === "SERVER") {
          const key = `${resolved.entityType}:${resolved.entityId}`;
          const current = await db.entities.get(key);
          const snapshotVersion = resolved.server.version;
          const version =
            typeof snapshotVersion === "number" && snapshotVersion > 0
              ? snapshotVersion
              : (current?.version ?? 1);
          const snapshotAccountId = resolved.server.accountId;
          const accountId =
            typeof snapshotAccountId === "string"
              ? snapshotAccountId
              : resolved.entityType === "ACCOUNT"
                ? resolved.entityId
                : current?.accountId;
          await db.entities.put({
            key,
            entityType: resolved.entityType,
            entityId: resolved.entityId,
            ...(accountId ? { accountId } : {}),
            pending: false,
            version,
            updatedAt: new Date().toISOString(),
            value: await encryptJson(getRuntimeDek(), resolved.server, `entity:${key}`),
          });
        }
        await db.conflicts.delete(conflictId);
        const operations = await db.operations.where("status").equals("CONFLICT").toArray();
        await db.operations.bulkDelete(
          operations
            .filter(
              (operation) =>
                operation.conflictId === conflictId ||
                (!operation.conflictId &&
                  operation.entityType === resolved.entityType &&
                  operation.entityId === resolved.entityId),
            )
            .map((operation) => operation.clientOperationId),
        );
      });
      go("/app/sync/conflicts");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible resolver.");
    }
  }
  const fields = Array.from(
    new Set([
      ...Object.keys(conflict.base),
      ...Object.keys(conflict.server),
      ...Object.keys(conflict.device),
    ]),
  );
  return (
    <div className="conflict-detail">
      <p>Revisa Base, Servidor y Dispositivo. Ningún cambio se aplica silenciosamente.</p>
      <div className="conflict-table-wrap">
        <table className="conflict-table">
          <thead>
            <tr>
              <th scope="col">Campo</th>
              <th scope="col">Base</th>
              <th scope="col">Servidor</th>
              <th scope="col">Dispositivo</th>
              {selection === "MERGED" ? <th scope="col">Valor elegido</th> : null}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field}>
                <th scope="row">{conflictFieldLabel(field)}</th>
                <td>{displayValue(conflict.base[field])}</td>
                <td>{displayValue(conflict.server[field])}</td>
                <td>{displayValue(conflict.device[field])}</td>
                {selection === "MERGED" ? (
                  <td>
                    <label className="sr-only" htmlFor={`merge-${field}`}>
                      Elegir valor para {conflictFieldLabel(field)}
                    </label>
                    <select
                      className="vicam-select"
                      id={`merge-${field}`}
                      onChange={(event) =>
                        setFieldSelections((current) => ({
                          ...current,
                          [field]: event.target.value as "SERVER" | "DEVICE",
                        }))
                      }
                      value={fieldSelections[field] ?? "SERVER"}
                    >
                      <option value="SERVER">Usar servidor</option>
                      <option value="DEVICE">Usar dispositivo</option>
                    </select>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {user?.role === "MANAGER" ? (
        <div className="conflict-resolution">
          <label>
            <input
              checked={selection === "SERVER"}
              name="resolution"
              onChange={() => setSelection("SERVER")}
              type="radio"
            />{" "}
            Conservar servidor
          </label>
          <label>
            <input
              checked={selection === "DEVICE"}
              name="resolution"
              onChange={() => setSelection("DEVICE")}
              type="radio"
            />{" "}
            Conservar dispositivo
          </label>
          <label>
            <input
              checked={selection === "MERGED"}
              name="resolution"
              onChange={() => setSelection("MERGED")}
              type="radio"
            />{" "}
            Combinar por campo
          </label>
          <Button onClick={() => void resolve()}>Confirmar resolución</Button>
        </div>
      ) : (
        <StatePanel kind="permission" title="Resolución reservada al Manager">
          <p>Puedes comparar las versiones y solicitar su revisión.</p>
        </StatePanel>
      )}
    </div>
  );
}
