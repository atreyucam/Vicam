import {
  createCommercialAccountRequestSchema,
  type CommercialAccountSummary,
  type CommercialAccount,
  type CommercialContact,
  type Task,
  type Visit,
} from "@vicam/contracts";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  ErrorSummary,
  FormSection,
  Input,
  PriorityBadge,
  Select,
  SkeletonList,
  StatePanel,
  StatusBadge,
  StickyActionBar,
} from "@vicam/ui";
import { LocateFixed, Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, ApiError, unwrap } from "../api/api";
import { queryKeys } from "../api/queryClient";
import { createIdempotencyKey, idempotencyParams, useIdempotencyKey } from "../api/idempotency";
import { useAsync } from "../api/useAsync";
import { useSession } from "../app/session";
import {
  isPendingOfflineValue,
  putOfflineEntity,
  readOfflineEntities,
  readOfflineEntity,
} from "../offline/entities";
import { withOfflineFallback } from "../offline/loaders";
import { runStructuredMutation } from "../offline/mutations";
import { loadActiveFruits } from "../offline/catalogs";
import { purgeAccountOwnership } from "../offline/vault";
import { formValue, formatDate, formatDateTime, go, LoadBoundary } from "./shared";

const MapLibreField = lazy(() =>
  import("../components/MapLibreField").then((module) => ({ default: module.MapLibreField })),
);
const DocumentsPage = lazy(() =>
  import("./Phase3Pages").then((module) => ({ default: module.DocumentsPage })),
);

export function AccountsPage() {
  const query = new URLSearchParams(window.location.search);
  const search = query.get("search") ?? "";
  const status = query.get("status") ?? "";
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () => {
          const page = unwrap(
            await api.GET("/commercial-accounts", {
              params: {
                query: {
                  page: Number(query.get("page") ?? 1),
                  pageSize: 20,
                  ...(search ? { search } : {}),
                  ...(status === "ACTIVE" || status === "ARCHIVED" ? { status } : {}),
                },
              },
            }),
          );
          await Promise.all(
            page.items
              .filter((account) => account.status === "ACTIVE")
              .map((account) =>
                putOfflineEntity({
                  accountId: account.id,
                  entityId: account.id,
                  entityType: "ACCOUNT",
                  value: account,
                  version: account.version,
                }),
              ),
          );
          return page;
        },
        async () => {
          const stored = await readOfflineEntities<CommercialAccount>(
            "ACCOUNT",
            (account) =>
              (!search ||
                `${account.displayName} ${account.city} ${account.primaryContactName ?? ""}`
                  .toLocaleLowerCase("es")
                  .includes(search.toLocaleLowerCase("es"))) &&
              account.status === "ACTIVE" &&
              (!status || status === "ACTIVE"),
          );
          return {
            items: stored,
            pagination: {
              page: 1,
              pageSize: 20,
              total: stored.length,
              totalPages: stored.length ? 1 : 0,
            },
          };
        },
      ),
    [search, status, query.get("page")],
  );
  const items = state.data?.items ?? [];
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const term = formValue(data, "search");
    const stateValue = formValue(data, "status");
    if (term) next.set("search", term);
    if (stateValue) next.set("status", stateValue);
    go(`/app/accounts${next.size ? `?${next}` : ""}`);
  }
  return (
    <>
      <form className="filter-bar" onSubmit={filter}>
        <Input
          defaultValue={search}
          label="Buscar clientes"
          name="search"
          placeholder="Nombre, ciudad o contacto"
        />
        <Select defaultValue={status} label="Estado" name="status">
          <option value="">Todos</option>
          <option value="ACTIVE">Activas</option>
          <option value="ARCHIVED">Archivadas</option>
        </Select>
        <Button type="submit">
          <Search aria-hidden="true" size={18} />
          Buscar
        </Button>
      </form>
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        {items.length ? (
          <>
            <div className="desktop-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Ciudad</th>
                    <th>Contacto principal</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((account) => (
                    <tr key={account.id}>
                      <th scope="row">{account.displayName}</th>
                      <td>{account.city}</td>
                      <td>{account.primaryContactName ?? "Sin contacto"}</td>
                      <td>{account.ownerFullName}</td>
                      <td>
                        <StatusBadge tone={account.status === "ACTIVE" ? "success" : "neutral"}>
                          {account.status === "ACTIVE" ? "Activa" : "Archivada"}
                        </StatusBadge>
                      </td>
                      <td>
                        {isPendingOfflineValue(account) ? (
                          <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
                        ) : null}
                        <ButtonLink href={`/app/accounts/${account.id}`} variant="ghost">
                          Ver detalle
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-cards">
              {items.map((account) => (
                <Card key={account.id}>
                  <div className="entity-card">
                    <div>
                      <strong>{account.displayName}</strong>
                      <span>
                        {account.city} · {account.primaryContactName ?? "Sin contacto"}
                      </span>
                      <small>Responsable: {account.ownerFullName}</small>
                    </div>
                    <StatusBadge tone={account.status === "ACTIVE" ? "success" : "neutral"}>
                      {account.status === "ACTIVE" ? "Activa" : "Archivada"}
                    </StatusBadge>
                    {isPendingOfflineValue(account) ? (
                      <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
                    ) : null}
                    <ButtonLink href={`/app/accounts/${account.id}`} variant="secondary">
                      Ver detalle
                    </ButtonLink>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <StatePanel
            kind={search || status ? "no-results" : "empty"}
            title={search || status ? "Sin resultados" : "Aún no hay clientes"}
          >
            <p>
              {search || status
                ? "Prueba quitando filtros o usando otro término."
                : "Crea el primer cliente comercial para comenzar."}
            </p>
            {!search && !status ? (
              <ButtonLink href="/app/accounts/new">Nuevo cliente</ButtonLink>
            ) : null}
          </StatePanel>
        )}
      </LoadBoundary>
    </>
  );
}

interface AccountFormValues {
  accountType: string;
  address: string;
  city: string;
  countryCode: string;
  displayName: string;
  email: string;
  legalName: string;
  latitude: number | null;
  longitude: number | null;
  ownerUserId: string;
  phone: string;
  postalCode: string;
  stateProvince: string;
  timezone: string;
  fruitIds: string[];
  contactEmail: string;
  contactName: string;
  contactPhone: string;
  contactTitle: string;
}
type AccountPayload = {
  displayName: string;
  legalName: string | null;
  accountType: string;
  ownerUserId: string;
  countryCode: string;
  stateProvince: string | null;
  city: string;
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: "MANUAL" | "DEVICE" | null;
  locationCapturedAt: string | null;
  fruitIds: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function clientFacingCopy(message: string) {
  return message
    .replaceAll("La cuenta", "El cliente")
    .replaceAll("la cuenta", "el cliente")
    .replaceAll("cuentas", "clientes")
    .replaceAll("Cuentas", "Clientes")
    .replaceAll("cuenta", "cliente")
    .replaceAll("Cuenta", "Cliente");
}

function sameAccountField(field: keyof AccountPayload, left: unknown, right: unknown): boolean {
  if (field === "fruitIds" && isStringArray(left) && isStringArray(right))
    return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
  return Object.is(left, right);
}

export function accountChangedFields(
  payload: AccountPayload,
  base?: AccountPayload,
): (keyof AccountPayload)[] {
  const fields = Object.keys(payload) as (keyof AccountPayload)[];
  return base
    ? fields.filter((field) => !sameAccountField(field, payload[field], base[field]))
    : fields;
}

const accountFieldSteps: Partial<Record<keyof AccountFormValues, number>> = {
  displayName: 1,
  accountType: 1,
  ownerUserId: 1,
  countryCode: 2,
  city: 2,
  stateProvince: 2,
  address: 2,
  postalCode: 2,
  phone: 2,
  email: 2,
  latitude: 2,
  longitude: 2,
  timezone: 3,
  fruitIds: 3,
  contactEmail: 2,
  contactName: 2,
  contactPhone: 2,
  contactTitle: 2,
};
const emptyAccount: AccountFormValues = {
  accountType: "DISTRIBUTOR",
  address: "",
  city: "",
  countryCode: "EC",
  displayName: "",
  email: "",
  legalName: "",
  latitude: null,
  longitude: null,
  ownerUserId: "",
  phone: "",
  postalCode: "",
  stateProvince: "",
  timezone: "America/Guayaquil",
  fruitIds: [],
  contactEmail: "",
  contactName: "",
  contactPhone: "",
  contactTitle: "",
};
export function AccountFormPage({ accountId }: { accountId?: string }) {
  const { user } = useSession();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [locationOverride, setLocationOverride] = useState<
    { latitude: number; longitude: number } | null | undefined
  >(undefined);
  const [locationState, setLocationState] = useState<
    "idle" | "requesting" | "obtained" | "denied" | "unavailable" | "error"
  >("idle");
  const idempotencyKey = useIdempotencyKey();
  const contactIdempotencyKey = useIdempotencyKey();
  const [localEntityId] = useState(() => accountId ?? crypto.randomUUID());
  const [localContactId] = useState(() => crypto.randomUUID());
  const fruitsState = useQuery({
    queryKey: queryKeys.activeFruits,
    queryFn: loadActiveFruits,
  });
  const form = useForm<AccountFormValues>({ defaultValues: emptyAccount });
  const state = useQuery({
    queryKey: ["accounts", "form", accountId ?? "new", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [accountResult, usersResult] = await Promise.all([
        accountId
          ? withOfflineFallback(
              async () =>
                unwrap(
                  await api.GET("/commercial-accounts/{id}", {
                    params: { path: { id: accountId } },
                  }),
                ),
              () => readOfflineEntity<CommercialAccount>("ACCOUNT", accountId),
            )
          : Promise.resolve(null),
        user?.role === "MANAGER" && navigator.onLine
          ? api.GET("/users", { params: { query: { page: 1, pageSize: 100, status: "ACTIVE" } } })
          : Promise.resolve(null),
      ]);
      return {
        account: accountResult ?? undefined,
        users: usersResult ? unwrap(usersResult).items : user ? [user] : [],
      };
    },
  });
  const account = state.data?.account;
  const values: AccountFormValues = account
    ? {
        accountType: account.accountType,
        address: account.address ?? "",
        city: account.city,
        countryCode: account.countryCode,
        displayName: account.displayName,
        email: account.email ?? "",
        legalName: account.legalName ?? "",
        latitude: account.latitude ?? null,
        longitude: account.longitude ?? null,
        ownerUserId: account.ownerUserId,
        phone: account.phone ?? "",
        postalCode: account.postalCode ?? "",
        stateProvince: account.stateProvince ?? "",
        timezone: account.timezone ?? "America/Guayaquil",
        fruitIds: account.fruitIds ?? account.fruits?.map((fruit) => fruit.id) ?? [],
        contactEmail: "",
        contactName: "",
        contactPhone: "",
        contactTitle: "",
      }
    : {
        ...emptyAccount,
        ownerUserId: user?.id ?? "",
        timezone: "America/Guayaquil",
      };
  useEffect(() => {
    if (state.data) form.reset(values);
  }, [state.data, form.reset]);
  if (state.isLoading || fruitsState.isLoading) return <SkeletonList />;
  if (state.error || fruitsState.error)
    return (
      <LoadBoundary
        error={state.error ?? fruitsState.error ?? undefined}
        loading={false}
        reload={() => void Promise.all([state.refetch(), fruitsState.refetch()])}
      >
        {null}
      </LoadBoundary>
    );
  async function submit(data: AccountFormValues) {
    const contactRequested = [
      data.contactName,
      data.contactTitle,
      data.contactPhone,
      data.contactEmail,
    ].some((value) => value.trim().length > 0);
    const contactErrors: string[] = [];
    if (contactRequested && !data.contactName.trim()) {
      form.setError("contactName", { message: "Ingresa el nombre del contacto." });
      contactErrors.push("Ingresa el nombre del contacto.");
    }
    if (contactRequested && !data.contactPhone.trim() && !data.contactEmail.trim()) {
      form.setError("contactPhone", { message: "Ingresa teléfono o correo del contacto." });
      contactErrors.push("Ingresa teléfono o correo del contacto.");
    }
    if (contactErrors.length) {
      setStep(2);
      setErrors(contactErrors);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".vicam-error-summary")?.focus(),
      );
      return;
    }
    const parsed = createCommercialAccountRequestSchema.safeParse({
      displayName: data.displayName,
      legalName: data.legalName || null,
      accountType: data.accountType,
      ownerUserId: data.ownerUserId,
      countryCode: data.countryCode.toUpperCase(),
      stateProvince: data.stateProvince || null,
      city: data.city,
      address: data.address || null,
      postalCode: data.postalCode || null,
      phone: data.phone || null,
      email: data.email || null,
      timezone: data.timezone || "America/Guayaquil",
      latitude:
        (locationOverride === undefined ? values.latitude : locationOverride?.latitude) ?? null,
      longitude:
        (locationOverride === undefined ? values.longitude : locationOverride?.longitude) ?? null,
      locationSource:
        locationOverride === undefined
          ? (account?.locationSource ?? null)
          : locationOverride
            ? "DEVICE"
            : null,
      locationCapturedAt:
        locationOverride === undefined
          ? (account?.locationCapturedAt ?? null)
          : locationOverride && locationState === "obtained"
            ? new Date().toISOString()
            : null,
      fruitIds: data.fruitIds,
    });
    if (!parsed.success) {
      form.clearErrors();
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in emptyAccount)
          form.setError(field as keyof AccountFormValues, {
            message: clientFacingCopy(issue.message),
          });
      }
      const invalidSteps = parsed.error.issues
        .map((issue) => accountFieldSteps[issue.path[0] as keyof AccountFormValues])
        .filter((invalidStep): invalidStep is number => invalidStep !== undefined);
      setStep(invalidSteps.length ? Math.min(...invalidSteps) : 1);
      setErrors(
        Array.from(new Set(parsed.error.issues.map((issue) => clientFacingCopy(issue.message)))),
      );
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".vicam-error-summary")?.focus(),
      );
      return;
    }
    form.clearErrors();
    setErrors([]);
    setBusy(true);
    const payload: AccountPayload = {
      displayName: parsed.data.displayName,
      legalName: parsed.data.legalName ?? null,
      accountType: parsed.data.accountType,
      ownerUserId: parsed.data.ownerUserId,
      countryCode: parsed.data.countryCode,
      stateProvince: parsed.data.stateProvince ?? null,
      city: parsed.data.city,
      address: parsed.data.address ?? null,
      postalCode: parsed.data.postalCode ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      timezone: parsed.data.timezone ?? null,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      locationSource: parsed.data.locationSource ?? null,
      locationCapturedAt: parsed.data.locationCapturedAt ?? null,
      fruitIds: parsed.data.fruitIds ?? [],
    };
    const basePayload = account
      ? {
          displayName: account.displayName,
          legalName: account.legalName ?? null,
          accountType: account.accountType,
          ownerUserId: account.ownerUserId,
          countryCode: account.countryCode,
          stateProvince: account.stateProvince ?? null,
          city: account.city,
          address: account.address ?? null,
          postalCode: account.postalCode ?? null,
          phone: account.phone ?? null,
          email: account.email ?? null,
          timezone: account.timezone ?? null,
          latitude: account.latitude ?? null,
          longitude: account.longitude ?? null,
          locationSource: account.locationSource ?? null,
          locationCapturedAt: account.locationCapturedAt ?? null,
          fruitIds: account.fruitIds ?? account.fruits?.map((fruit) => fruit.id) ?? [],
        }
      : null;
    const changedFields = accountChangedFields(payload, basePayload ?? undefined);
    if (account && changedFields.length === 0) {
      go(`/app/accounts/${account.id}`);
      return;
    }
    const syncPayload = account
      ? Object.fromEntries(changedFields.map((field) => [field, payload[field]]))
      : payload;
    try {
      const localValue: CommercialAccount = {
        ...payload,
        id: localEntityId,
        status: account?.status ?? "ACTIVE",
        version: account?.version ?? 1,
        ownerFullName:
          user?.role === "SUPERVISOR"
            ? user.fullName
            : (state.data?.users.find((owner) => owner.id === payload.ownerUserId)?.fullName ??
              account?.ownerFullName ??
              "Responsable"),
        primaryContactName: account?.primaryContactName ?? null,
        fruits: fruitsState.data?.filter((fruit) => payload.fruitIds.includes(fruit.id)) ?? [],
        createdAt: account?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const saved = (
        await runStructuredMutation<CommercialAccount>({
          action: accountId ? "UPDATE" : "CREATE",
          baseVersion: account?.version ?? null,
          changedFields,
          clientOperationId: idempotencyKey,
          entityId: localEntityId,
          entityType: "ACCOUNT",
          localValue,
          online: async () =>
            unwrap(
              accountId
                ? await api.PATCH("/commercial-accounts/{id}", {
                    params: { path: { id: accountId }, ...idempotencyParams(idempotencyKey) },
                    body: { ...payload, version: account!.version },
                  })
                : await api.POST("/commercial-accounts", {
                    params: idempotencyParams(idempotencyKey),
                    body: payload,
                  }),
            ),
          payload: syncPayload,
        })
      ).value;
      if (!accountId && contactRequested) {
        const contactPayload = {
          fullName: data.contactName.trim(),
          title: data.contactTitle.trim() || null,
          phone: data.contactPhone.trim() || null,
          email: data.contactEmail.trim() || null,
          notes: null,
          isPrimary: true,
        };
        await runStructuredMutation<CommercialContact>({
          accountId: saved.id,
          action: "CREATE",
          baseVersion: null,
          changedFields: Object.keys(contactPayload),
          clientOperationId: contactIdempotencyKey,
          dependencyEntities: [{ entityId: saved.id, entityType: "ACCOUNT" }],
          entityId: localContactId,
          entityType: "CONTACT",
          localValue: {
            ...contactPayload,
            accountId: saved.id,
            id: localContactId,
            version: 1,
          },
          online: async () =>
            unwrap(
              await api.POST("/commercial-accounts/{id}/contacts", {
                params: {
                  path: { id: saved.id },
                  ...idempotencyParams(contactIdempotencyKey),
                },
                body: contactPayload,
              }),
            ),
          payload: { ...contactPayload, accountId: saved.id },
        });
      }
      go(`/app/accounts/${saved.id}`);
    } catch (reason) {
      setErrors([reason instanceof ApiError ? reason.message : "No pudimos guardar el cliente."]);
    } finally {
      setBusy(false);
    }
  }
  const currentLocation =
    locationOverride === undefined
      ? values.latitude !== null && values.longitude !== null
        ? { latitude: values.latitude, longitude: values.longitude }
        : null
      : locationOverride;

  function requestLocation() {
    setLocationState("requesting");
    if (!("geolocation" in navigator)) {
      setLocationState("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationOverride({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationState("obtained");
      },
      (error) => {
        setLocationState(
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.POSITION_UNAVAILABLE
              ? "unavailable"
              : "error",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  }
  return (
    <form
      className="entity-form"
      noValidate
      onSubmit={(event) => void form.handleSubmit((data) => void submit(data))(event)}
    >
      <ErrorSummary errors={errors} />
      <div className="mobile-stepper" aria-label="Progreso del formulario">
        <span>Paso {step} de 3</span>
        <strong>
          {["Identidad", "Ubicación y contactos", "Clasificación y revisión"][step - 1]}
        </strong>
      </div>
      <div className={step === 1 ? "mobile-step active" : "mobile-step"}>
        <FormSection title="Identidad">
          <Input
            error={form.formState.errors.displayName?.message}
            label="Nombre visible"
            required
            {...form.register("displayName")}
          />
          <Input
            error={form.formState.errors.legalName?.message}
            label="Razón social"
            {...form.register("legalName")}
          />
          <Select
            error={form.formState.errors.accountType?.message}
            label="Tipo de cliente"
            required
            {...form.register("accountType")}
          >
            <option value="DISTRIBUTOR">Distribuidora</option>
            <option value="FARM">Finca</option>
            <option value="COMPANY">Empresa</option>
            <option value="PERSON">Persona</option>
            <option value="OTHER">Otra</option>
          </Select>
          {user?.role === "MANAGER" ? (
            <Select
              error={form.formState.errors.ownerUserId?.message}
              label="Responsable"
              required
              {...form.register("ownerUserId")}
            >
              {state.data?.users.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.fullName}
                </option>
              ))}
            </Select>
          ) : (
            <input type="hidden" {...form.register("ownerUserId")} />
          )}
        </FormSection>
      </div>
      <div className={step === 2 ? "mobile-step active" : "mobile-step"}>
        <FormSection title="Ubicación y contactos">
          <Input
            error={form.formState.errors.countryCode?.message}
            help="Código ISO de dos letras, por ejemplo EC."
            label="País"
            maxLength={2}
            required
            {...form.register("countryCode")}
          />
          <Input
            error={form.formState.errors.city?.message}
            label="Ciudad"
            required
            {...form.register("city")}
          />
          <Input
            error={form.formState.errors.stateProvince?.message}
            label="Estado o provincia"
            {...form.register("stateProvince")}
          />
          <Input
            error={form.formState.errors.address?.message}
            label="Dirección"
            {...form.register("address")}
          />
          <Input
            error={form.formState.errors.postalCode?.message}
            label="Código postal"
            {...form.register("postalCode")}
          />
          <Input
            error={form.formState.errors.phone?.message}
            label="Teléfono"
            type="tel"
            {...form.register("phone")}
          />
          <Input
            error={form.formState.errors.email?.message}
            label="Correo electrónico"
            type="email"
            {...form.register("email")}
          />
          {!accountId ? (
            <div className="embedded-contact-fields">
              <h3>Contacto principal (opcional)</h3>
              <p>Puedes registrar el primer contacto al crear el cliente.</p>
              <Input
                error={form.formState.errors.contactName?.message}
                label="Nombre del contacto"
                {...form.register("contactName")}
              />
              <Input label="Cargo" {...form.register("contactTitle")} />
              <Input
                error={form.formState.errors.contactPhone?.message}
                label="Teléfono del contacto"
                type="tel"
                {...form.register("contactPhone")}
              />
              <Input
                error={form.formState.errors.contactEmail?.message}
                label="Correo del contacto"
                type="email"
                {...form.register("contactEmail")}
              />
            </div>
          ) : null}
          <div className="location-field">
            <div>
              <strong>Coordenadas GPS (opcional)</strong>
              <p>
                Solo pediremos permiso al navegador cuando selecciones “Usar mi ubicación”. VICAM
                guardará las coordenadas de este dispositivo con el cliente.
              </p>
            </div>
            <div className="location-actions">
              <Button
                disabled={locationState === "requesting"}
                onClick={requestLocation}
                variant="secondary"
              >
                <LocateFixed aria-hidden="true" size={18} />
                {locationState === "requesting" ? "Solicitando ubicación" : "Usar mi ubicación"}
              </Button>
              {currentLocation ? (
                <Button
                  onClick={() => {
                    setLocationOverride(null);
                    setLocationState("idle");
                  }}
                  variant="ghost"
                >
                  Quitar ubicación
                </Button>
              ) : null}
            </div>
            <div aria-live="polite" className="location-status">
              {locationState === "requesting" ? "Esperando respuesta del navegador…" : null}
              {locationState === "obtained" ? "Ubicación obtenida correctamente." : null}
              {locationState === "denied"
                ? "Permiso denegado. Puedes continuar sin ubicación o habilitarlo en el navegador."
                : null}
              {locationState === "unavailable"
                ? "La ubicación no está disponible en este dispositivo. Puedes continuar sin ella."
                : null}
              {locationState === "error"
                ? "No fue posible obtener la ubicación. Intenta nuevamente o continúa sin ella."
                : null}
              {currentLocation ? (
                <span>
                  Latitud {currentLocation.latitude.toFixed(6)} · Longitud{" "}
                  {currentLocation.longitude.toFixed(6)}
                </span>
              ) : null}
            </div>
          </div>
        </FormSection>
      </div>
      <div className={step === 3 ? "mobile-step active" : "mobile-step"}>
        <FormSection title="Clasificación y revisión">
          <input type="hidden" {...form.register("timezone")} />
          <fieldset className="fruit-selector">
            <legend>Frutas (opcional)</legend>
            <p>Selecciona todas las frutas activas relacionadas con el cliente.</p>
            {fruitsState.data?.length ? (
              <div className="fruit-options">
                {fruitsState.data.map((fruit) => (
                  <label className="checkbox" key={fruit.id}>
                    <input type="checkbox" value={fruit.id} {...form.register("fruitIds")} />
                    {fruit.name}
                  </label>
                ))}
              </div>
            ) : (
              <p>No hay frutas activas disponibles.</p>
            )}
          </fieldset>
          <div className="review-note">
            <strong>Revisión</strong>
            <p>
              Confirma la clasificación y los datos del cliente antes de guardar. Podrás gestionar
              más contactos desde el detalle.
            </p>
          </div>
        </FormSection>
      </div>
      <StickyActionBar>
        <Button
          className="mobile-only"
          disabled={step === 1}
          onClick={() => setStep((value) => Math.max(1, value - 1))}
          variant="secondary"
        >
          Anterior
        </Button>
        {step < 3 ? (
          <Button
            className="mobile-only"
            onClick={() => setStep((value) => Math.min(3, value + 1))}
          >
            Continuar
          </Button>
        ) : null}
        <ButtonLink
          href={accountId ? `/app/accounts/${accountId}` : "/app/accounts"}
          variant="secondary"
        >
          Cancelar
        </ButtonLink>
        <Button
          className={step < 3 ? "desktop-only" : undefined}
          loading={busy}
          loadingLabel="Guardando cliente"
          type="submit"
        >
          Guardar cliente
        </Button>
      </StickyActionBar>
    </form>
  );
}

export type AccountDetailTab = "summary" | "visits" | "tasks" | "contacts" | "documents";

export function AccountDetailPage({
  accountId,
  contactsOnly = false,
  documentsContent,
  tab: requestedTab,
}: {
  accountId: string;
  contactsOnly?: boolean;
  documentsContent?: ReactNode;
  tab?: AccountDetailTab;
}) {
  const tab = requestedTab ?? (contactsOnly ? "contacts" : "summary");
  const state = useAsync(async () => {
    return withOfflineFallback(
      async () => {
        const [accountResult, contactsResult] = await Promise.all([
          api.GET("/commercial-accounts/{id}", { params: { path: { id: accountId } } }),
          api.GET("/commercial-accounts/{id}/contacts", { params: { path: { id: accountId } } }),
        ]);
        const account = unwrap(accountResult);
        const contacts = unwrap(contactsResult);
        if (account.status === "ACTIVE")
          await Promise.all([
            putOfflineEntity({
              accountId,
              entityId: accountId,
              entityType: "ACCOUNT",
              value: account,
              version: account.version,
            }),
            ...contacts.map((contact) =>
              putOfflineEntity({
                accountId,
                entityId: contact.id,
                entityType: "CONTACT",
                value: contact,
                version: contact.version,
              }),
            ),
          ]);
        else await purgeAccountOwnership([accountId]);
        return { account, contacts, offline: false };
      },
      async () => {
        const account = await readOfflineEntity<CommercialAccount>("ACCOUNT", accountId);
        if (!account) return undefined;
        const contacts = await readOfflineEntities<CommercialContact>(
          "CONTACT",
          (contact) => contact.accountId === accountId,
        );
        return { account, contacts, offline: true };
      },
    );
  }, [accountId]);
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {state.data ? (
        <>
          <div className="detail-hero">
            <div>
              <strong>{state.data.account.displayName}</strong>
              <div>
                {isPendingOfflineValue(state.data.account) ? (
                  <StatusBadge tone="warning">Pendiente de sincronizar</StatusBadge>
                ) : null}
                <StatusBadge tone={state.data.account.status === "ACTIVE" ? "success" : "neutral"}>
                  {state.data.account.status === "ACTIVE" ? "Activa" : "Archivada"}
                </StatusBadge>
              </div>
              <p>
                {state.data.account.accountType} · {state.data.account.city},{" "}
                {state.data.account.countryCode}
              </p>
              <span>Responsable: {state.data.account.ownerFullName}</span>
            </div>
            <div>
              <ButtonLink href={`/app/visits/new?accountId=${accountId}`}>
                <Plus aria-hidden="true" size={18} />
                Agendar visita
              </ButtonLink>
              <ButtonLink href={`/app/tasks/new?accountId=${accountId}`} variant="secondary">
                Nueva tarea
              </ButtonLink>
              <ButtonLink href={`/app/accounts/${accountId}/edit`} variant="secondary">
                Editar
              </ButtonLink>
            </div>
          </div>
          <AccountTabs accountId={accountId} active={tab} />
          {state.data.offline && tab !== "contacts" ? (
            <StatePanel kind="offline" title="Información comercial parcial">
              <p>
                Sin conexión solo se muestran los datos autorizados guardados en este dispositivo.
              </p>
            </StatePanel>
          ) : null}
          {tab === "summary" ? (
            <AccountSummaryPanel
              account={state.data.account}
              accountId={accountId}
              contacts={state.data.contacts}
              offline={state.data.offline}
            />
          ) : tab === "visits" ? (
            <AccountVisitsPanel accountId={accountId} offline={state.data.offline} />
          ) : tab === "tasks" ? (
            <AccountTasksPanel accountId={accountId} offline={state.data.offline} />
          ) : tab === "contacts" ? (
            <ContactsPanel
              accountId={accountId}
              contacts={state.data.contacts}
              reload={state.reload}
            />
          ) : (
            (documentsContent ?? (
              <Suspense fallback={<StatePanel kind="loading" title="Cargando documentos" />}>
                <DocumentsPage accountId={accountId} />
              </Suspense>
            ))
          )}
        </>
      ) : null}
    </LoadBoundary>
  );
}

function AccountTabs({ accountId, active }: { accountId: string; active: AccountDetailTab }) {
  const tabs: Array<{ href: string; label: string; value: AccountDetailTab }> = [
    { href: `/app/accounts/${accountId}`, label: "Resumen", value: "summary" },
    { href: `/app/accounts/${accountId}/visits`, label: "Visitas", value: "visits" },
    { href: `/app/accounts/${accountId}/tasks`, label: "Tareas", value: "tasks" },
    { href: `/app/accounts/${accountId}/contacts`, label: "Contactos", value: "contacts" },
    { href: `/app/accounts/${accountId}/documents`, label: "Documentos", value: "documents" },
  ];
  return (
    <nav aria-label="Secciones del cliente" className="tabs">
      {tabs.map((item) => (
        <a
          aria-current={active === item.value ? "page" : undefined}
          href={item.href}
          key={item.value}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function AccountSummaryPanel({
  account,
  accountId,
  contacts,
  offline,
}: {
  account: CommercialAccount;
  accountId: string;
  contacts: CommercialContact[];
  offline: boolean;
}) {
  return (
    <div className="task-groups">
      {offline ? null : <OnlineCommercialSummary accountId={accountId} />}
      <AccountContactAndLocation account={account} contacts={contacts} />
    </div>
  );
}

function OnlineCommercialSummary({ accountId }: { accountId: string }) {
  const state = useAsync(
    async () =>
      unwrap(
        await api.GET("/commercial-accounts/{id}/commercial-summary", {
          params: { path: { id: accountId } },
        }),
      ),
    [accountId],
  );
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {state.data ? <CommercialSummaryContent accountId={accountId} summary={state.data} /> : null}
    </LoadBoundary>
  );
}

function CommercialSummaryContent({
  accountId,
  summary,
}: {
  accountId: string;
  summary: CommercialAccountSummary;
}) {
  return (
    <>
      <div className="detail-grid">
        <Card title="Próxima visita">
          {summary.nextVisit ? (
            <div className="task-card">
              <div>
                <strong>{formatDateTime(summary.nextVisit.scheduledAt)}</strong>
                <span>{summary.nextVisit.reason}</span>
                <small>{summary.nextVisit.responsibleFullName}</small>
              </div>
              <PriorityBadge priority={summary.nextVisit.priority} />
              <div>
                <ButtonLink href={`/app/visits/${summary.nextVisit.id}`} variant="secondary">
                  Ver visita
                </ButtonLink>
              </div>
            </div>
          ) : (
            <StatePanel kind="empty" title="No hay una próxima visita">
              <p>Agenda una visita para continuar el seguimiento.</p>
              <ButtonLink href={`/app/visits/new?accountId=${accountId}`}>
                Agendar visita
              </ButtonLink>
            </StatePanel>
          )}
        </Card>
        <Card title="Tareas abiertas">
          <dl className="detail-list">
            <div>
              <dt>Pendientes o en progreso</dt>
              <dd>{summary.openTaskCount}</dd>
            </div>
            <div>
              <dt>Vencen hoy</dt>
              <dd>{summary.dueTodayTaskCount}</dd>
            </div>
          </dl>
          <div className="quick-actions">
            <ButtonLink href={`/app/accounts/${accountId}/tasks`} variant="secondary">
              Ver tareas
            </ButtonLink>
          </div>
        </Card>
      </div>
      <Card title="Actividad reciente">
        {summary.recentActivity.length ? (
          <ol className="contact-list">
            {summary.recentActivity.map((item) => (
              <li key={item.id}>
                <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
                <a
                  href={
                    item.resourceType === "VISIT"
                      ? `/app/visits/${item.resourceId}`
                      : `/app/tasks/${item.resourceId}`
                  }
                >
                  <strong>{item.title}</strong>
                </a>
                {item.description ? <span>{item.description}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <StatePanel kind="empty" title="Sin actividad comercial reciente">
            <p>Las visitas y tareas del cliente aparecerán aquí.</p>
          </StatePanel>
        )}
      </Card>
    </>
  );
}

function AccountContactAndLocation({
  account,
  contacts,
}: {
  account: CommercialAccount;
  contacts: CommercialContact[];
}) {
  const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0];
  return (
    <div className="detail-grid">
      <Card title="Datos de contacto">
        <dl className="detail-list">
          <div>
            <dt>Contacto principal</dt>
            <dd>{primaryContact?.fullName ?? "No registrado"}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{account.phone ?? primaryContact?.phone ?? "No registrado"}</dd>
          </div>
          <div>
            <dt>Correo</dt>
            <dd>{account.email ?? primaryContact?.email ?? "No registrado"}</dd>
          </div>
          <div>
            <dt>Dirección</dt>
            <dd>{account.address ?? "No registrada"}</dd>
          </div>
          <div>
            <dt>Zona horaria del cliente</dt>
            <dd>{account.timezone ?? "America/Guayaquil"}</dd>
          </div>
          <div>
            <dt>Coordenadas GPS</dt>
            <dd>
              {account.latitude != null && account.longitude != null
                ? `${account.latitude.toFixed(6)}, ${account.longitude.toFixed(6)}`
                : "No registradas"}
            </dd>
          </div>
          <div>
            <dt>Frutas</dt>
            <dd>
              {account.fruits.length
                ? account.fruits.map((fruit) => fruit.name).join(", ")
                : "Sin frutas asignadas"}
            </dd>
          </div>
        </dl>
      </Card>
      <Card title="Ubicación">
        {navigator.onLine ? (
          <Suspense fallback={<StatePanel kind="loading" title="Cargando mapa" />}>
            <MapLibreField
              latitude={account.latitude ?? null}
              longitude={account.longitude ?? null}
            />
          </Suspense>
        ) : (
          <StatePanel kind="offline" title="Mapa no disponible sin conexión">
            <p>Las coordenadas guardadas siguen visibles en el resumen.</p>
          </StatePanel>
        )}
      </Card>
    </div>
  );
}

const visitStatusLabels = {
  PENDING: "Pendiente",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;
const taskStatusLabels = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;

function AccountVisitsPanel({ accountId, offline }: { accountId: string; offline: boolean }) {
  const query = new URLSearchParams(window.location.search);
  const status = query.get("status") ?? "";
  const page = Math.max(1, Number(query.get("page") ?? 1) || 1);
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () =>
          unwrap(
            await api.GET("/visits", {
              params: {
                query: {
                  accountId,
                  page,
                  pageSize: 20,
                  ...(["PENDING", "COMPLETED", "CANCELLED"].includes(status)
                    ? { status: status as Visit["status"] }
                    : {}),
                },
              },
            }),
          ),
        async () => {
          const items = await readOfflineEntities<Visit>(
            "VISIT",
            (visit) => visit.accountId === accountId && (!status || visit.status === status),
          );
          return {
            items,
            pagination: {
              page: 1,
              pageSize: 20,
              total: items.length,
              totalPages: items.length ? 1 : 0,
            },
          };
        },
      ),
    [accountId, page, status],
  );
  const base = `/app/accounts/${accountId}/visits`;
  return (
    <section aria-labelledby="account-visits-title">
      <div className="tasks-toolbar">
        <nav aria-label="Filtrar visitas" className="tabs">
          {[
            ["", "Todas"],
            ["PENDING", "Pendientes"],
            ["COMPLETED", "Completadas"],
            ["CANCELLED", "Canceladas"],
          ].map(([value, label]) => (
            <a
              aria-current={status === value ? "page" : undefined}
              href={`${base}${value ? `?status=${value}` : ""}`}
              key={value}
            >
              {label}
            </a>
          ))}
        </nav>
        <ButtonLink href={`/app/visits/new?accountId=${accountId}`}>Agendar visita</ButtonLink>
      </div>
      <h2 className="visually-hidden" id="account-visits-title">
        Visitas del cliente
      </h2>
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        {state.data?.items.length ? (
          <div className="task-list">
            {state.data.items.map((visit) => (
              <Card key={visit.id}>
                <div className="task-card">
                  <div>
                    <a href={`/app/visits/${visit.id}`}>
                      <strong>{visit.reason}</strong>
                    </a>
                    <span>
                      {formatDateTime(visit.scheduledAt)} · {visit.responsibleFullName}
                    </span>
                  </div>
                  <PriorityBadge priority={visit.priority} />
                  <StatusBadge
                    tone={
                      visit.status === "COMPLETED"
                        ? "success"
                        : visit.status === "PENDING"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {visitStatusLabels[visit.status]}
                  </StatusBadge>
                  <div>
                    <ButtonLink href={`/app/visits/${visit.id}`} variant="secondary">
                      Ver
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <StatePanel
            kind={status ? "no-results" : "empty"}
            title={status ? "No hay visitas con este filtro" : "No hay visitas registradas"}
          >
            <p>
              {offline
                ? "El historial completo estará disponible al recuperar la conexión."
                : "Agenda la primera visita para comenzar el seguimiento."}
            </p>
            <ButtonLink href={`/app/visits/new?accountId=${accountId}`}>Agendar visita</ButtonLink>
          </StatePanel>
        )}
        {state.data ? (
          <AccountPagination
            base={base}
            page={page}
            status={status}
            totalPages={state.data.pagination.totalPages}
          />
        ) : null}
      </LoadBoundary>
    </section>
  );
}

type TaskWithVisitContext = Task & {
  visitReason?: string | null;
  visitScheduledAt?: string | null;
};

function AccountTasksPanel({ accountId, offline }: { accountId: string; offline: boolean }) {
  const query = new URLSearchParams(window.location.search);
  const status = query.get("status") ?? "";
  const page = Math.max(1, Number(query.get("page") ?? 1) || 1);
  const state = useAsync(
    async () =>
      withOfflineFallback(
        async () =>
          unwrap(
            await api.GET("/tasks", {
              params: {
                query: {
                  accountId,
                  page,
                  pageSize: 20,
                  ...(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(status)
                    ? { status: status as Task["status"] }
                    : {}),
                },
              },
            }),
          ),
        async () => {
          const items = await readOfflineEntities<TaskWithVisitContext>(
            "TASK",
            (task) => task.accountId === accountId && (!status || task.status === status),
          );
          return {
            items,
            pagination: {
              page: 1,
              pageSize: 20,
              total: items.length,
              totalPages: items.length ? 1 : 0,
            },
          };
        },
      ),
    [accountId, page, status],
  );
  const items = (state.data?.items ?? []) as TaskWithVisitContext[];
  const base = `/app/accounts/${accountId}/tasks`;
  return (
    <section aria-labelledby="account-tasks-title">
      <div className="tasks-toolbar">
        <nav aria-label="Filtrar tareas" className="tabs">
          {[
            ["", "Todas"],
            ["PENDING", "Pendientes"],
            ["IN_PROGRESS", "En progreso"],
            ["COMPLETED", "Completadas"],
            ["CANCELLED", "Canceladas"],
          ].map(([value, label]) => (
            <a
              aria-current={status === value ? "page" : undefined}
              href={`${base}${value ? `?status=${value}` : ""}`}
              key={value}
            >
              {label}
            </a>
          ))}
        </nav>
        <ButtonLink href={`/app/tasks/new?accountId=${accountId}`}>Nueva tarea</ButtonLink>
      </div>
      <h2 className="visually-hidden" id="account-tasks-title">
        Tareas del cliente
      </h2>
      <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
        {items.length ? (
          <div className="task-list">
            {items.map((task) => (
              <Card key={task.id}>
                <div className="task-card">
                  <div>
                    <a href={`/app/tasks/${task.id}`}>
                      <strong>{task.title}</strong>
                    </a>
                    <span>
                      Vence {formatDate(task.dueDate)}
                      {task.dueTime ? ` a las ${task.dueTime.slice(0, 5)}` : ""} ·{" "}
                      {task.responsibleFullName}
                    </span>
                    {task.visitId ? (
                      <small>
                        Vinculada a:{" "}
                        <a href={`/app/visits/${task.visitId}`}>
                          {task.visitScheduledAt
                            ? `${formatDateTime(task.visitScheduledAt)} · `
                            : ""}
                          {task.visitReason ?? "Ver visita"}
                        </a>
                      </small>
                    ) : (
                      <small>Sin visita vinculada</small>
                    )}
                  </div>
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge
                    tone={
                      task.overdue
                        ? "danger"
                        : task.status === "COMPLETED"
                          ? "success"
                          : task.status === "CANCELLED"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {task.overdue ? "Vencida" : taskStatusLabels[task.status]}
                  </StatusBadge>
                  <div>
                    <ButtonLink href={`/app/tasks/${task.id}`} variant="secondary">
                      Ver
                    </ButtonLink>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <StatePanel
            kind={status ? "no-results" : "empty"}
            title={status ? "No hay tareas con este filtro" : "No hay tareas para este cliente"}
          >
            <p>
              {offline
                ? "Las tareas históricas estarán disponibles al recuperar la conexión."
                : "Crea una tarea para dar seguimiento comercial."}
            </p>
            <ButtonLink href={`/app/tasks/new?accountId=${accountId}`}>Nueva tarea</ButtonLink>
          </StatePanel>
        )}
        {state.data ? (
          <AccountPagination
            base={base}
            page={page}
            status={status}
            totalPages={state.data.pagination.totalPages}
          />
        ) : null}
      </LoadBoundary>
    </section>
  );
}

function AccountPagination({
  base,
  page,
  status,
  totalPages,
}: {
  base: string;
  page: number;
  status: string;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    query.set("page", String(nextPage));
    return `${base}?${query}`;
  };
  return (
    <nav aria-label="Paginación" className="pagination-actions">
      {page > 1 ? (
        <ButtonLink href={href(page - 1)} variant="secondary">
          Anterior
        </ButtonLink>
      ) : null}
      <span>
        Página {page} de {totalPages}
      </span>
      {page < totalPages ? (
        <ButtonLink href={href(page + 1)} variant="secondary">
          Siguiente
        </ButtonLink>
      ) : null}
    </nav>
  );
}

function ContactsPanel({
  accountId,
  contacts,
  reload,
}: {
  accountId: string;
  contacts: CommercialContact[];
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [localContactId, setLocalContactId] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const phone = formValue(data, "phone");
    const email = formValue(data, "email");
    if (!phone && !email) {
      setError(["Ingresa teléfono o correo electrónico."]);
      return;
    }
    setBusy(true);
    setError([]);
    try {
      const payload = {
        fullName: formValue(data, "fullName"),
        title: formValue(data, "title") || null,
        phone: phone || null,
        email: email || null,
        notes: null,
        isPrimary: Boolean(data.get("isPrimary")),
      };
      await runStructuredMutation<CommercialContact>({
        accountId,
        action: "CREATE",
        baseVersion: null,
        changedFields: Object.keys(payload),
        clientOperationId: idempotencyKey,
        dependencyEntities: [{ entityId: accountId, entityType: "ACCOUNT" }],
        entityId: localContactId,
        entityType: "CONTACT",
        localValue: { ...payload, id: localContactId, accountId, version: 1 },
        online: async () =>
          unwrap(
            await api.POST("/commercial-accounts/{id}/contacts", {
              params: { path: { id: accountId }, ...idempotencyParams(idempotencyKey) },
              body: payload,
            }),
          ),
        payload: { ...payload, accountId },
      });
      setOpen(false);
      reload();
    } catch (reason) {
      setError([reason instanceof ApiError ? reason.message : "No pudimos guardar el contacto."]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      actions={
        <Button
          onClick={() => {
            setIdempotencyKey(createIdempotencyKey());
            setLocalContactId(crypto.randomUUID());
            setOpen(true);
          }}
          variant="secondary"
        >
          Agregar contacto
        </Button>
      }
      title="Contactos"
    >
      {contacts.length ? (
        <ul className="contact-list">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <div>
                <strong>{contact.fullName}</strong>
                {contact.isPrimary ? <StatusBadge tone="info">Principal</StatusBadge> : null}
                {isPendingOfflineValue(contact) ? (
                  <StatusBadge tone="warning">Pendiente</StatusBadge>
                ) : null}
              </div>
              <span>{contact.title ?? "Sin cargo"}</span>
              <span>{contact.phone ?? contact.email}</span>
            </li>
          ))}
        </ul>
      ) : (
        <StatePanel kind="empty" title="Sin contactos">
          <p>El cliente puede continuar sin contactos.</p>
        </StatePanel>
      )}
      {open ? (
        <Dialog
          description="Registra al menos un teléfono o correo electrónico."
          onClose={() => setOpen(false)}
          title="Nuevo contacto"
        >
          <form onSubmit={(event) => void submit(event)}>
            <ErrorSummary errors={error} />
            <Input data-dialog-initial-focus label="Nombre completo" name="fullName" required />
            <Input label="Cargo" name="title" />
            <Input label="Teléfono" name="phone" />
            <Input label="Correo" name="email" type="email" />
            <label className="checkbox">
              <input name="isPrimary" type="checkbox" /> Contacto principal
            </label>
            <div className="modal-actions">
              <Button onClick={() => setOpen(false)} variant="secondary">
                Cancelar
              </Button>
              <Button loading={busy} type="submit">
                Guardar contacto
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </Card>
  );
}
