% VICAM - Arquitectura, Base de Datos y API
% Version 2.0 final | 21 de julio de 2026
% Guia tecnica normativa para implementacion y operacion

> **Decision arquitectonica:** monolito modular TypeScript, API REST versionada y PWA offline parcial, desplegados con Docker Compose en el VPS corporativo. Este documento reemplaza Arquitectura y Base de Datos v1.0.

[[PAGEBREAK]]

# 1. Vista ejecutiva

La arquitectura objetivo evita microservicios y Redis para reducir operacion en un VPS Hostinger KVM 2 con Ubuntu 24.04 LTS, 2 CPU, 8 GB RAM, 100 GB de disco y 8 TB de transferencia. PostgreSQL es la fuente de verdad; la PWA mantiene un subconjunto autorizado en IndexedDB y sincroniza operaciones idempotentes.

| Capa | Tecnologia final |
|---|---|
| Web/PWA | React 19, Vite, TypeScript strict, Workbox, Dexie |
| UI | Tailwind CSS 4, Radix UI, componentes propios, Lucide |
| Estado | TanStack Query, React Hook Form, Zod, Zustand minimo |
| API | Node.js 24 LTS, Express 5, REST `/api/v1`, Zod, OpenAPI 3.1 |
| Datos | PostgreSQL 18, Drizzle ORM, SQL versionado |
| Trabajos | pg-boss sobre PostgreSQL, worker separado |
| Gateway | Caddy, HTTPS automatico y mismo origen |
| Documentos | Volumen privado + ClamAV, sin imagenes |
| Entrega | GitHub Actions, GHCR, imagenes por SHA, Docker Compose |

# 2. Topologia de ambientes

## 2.1 Dominios

- Produccion: `https://app.vicamproduce.com`
- API: `https://app.vicamproduce.com/api/v1`
- Staging: `https://staging.app.vicamproduce.com`
- Desarrollo: localhost con Docker Compose y certificados no requeridos.

El mismo origen evita CORS innecesario y simplifica cookies y alcance del Service Worker. Produccion y staging usan bases, volumenes, claves VAPID, secretos y suscripciones separados. Staging solo usa datos ficticios o anonimizados.

## 2.2 Contenedores de produccion

| Servicio | Responsabilidad | Exposicion | Limite inicial sugerido |
|---|---|---|---|
| `gateway` | Caddy, TLS, archivos estaticos, proxy `/api` | 80/443 | 256 MB |
| `web` | build estatico; puede integrarse en gateway | privada | 128 MB |
| `api` | REST, auth, negocio, sync, descargas | privada | 1.25 GB |
| `worker` | recordatorios, exportaciones, importaciones, limpieza | privada | 1.5 GB; PDF concurrency 1 |
| `postgres` | fuente de verdad y cola pg-boss | privada | 2.5 GB |
| `clamav` | escaneo de documentos y firmas | privada | 1.5 GB |
| `backup` | `pg_dump`, verificacion y rotacion | privada | 256 MB |

Los limites se ajustan con medicion. Se reserva capacidad para SO, Docker y picos. Solo Caddy publica puertos; PostgreSQL nunca se expone a Internet.

# 3. Monorepo y limites modulares

```text
vicam/
  apps/
    web/                 React + Vite + PWA
    api/                 Express y composicion de modulos
    worker/              pg-boss handlers
  packages/
    contracts/           Zod, DTO, enums, OpenAPI
    database/            Drizzle schema, repositorios, migraciones
    ui/                  tokens y componentes VICAM
    config/              tsconfig, lint, test
  infra/
    caddy/
    docker/
    scripts/
  docs/
    adr/ api/ diagrams/ runbooks/
  compose.yaml
  compose.staging.yaml
  compose.production.yaml
```

Modulos de dominio: `auth`, `users`, `accounts`, `contacts`, `visits`, `tasks`, `documents`, `catalogs`, `notifications`, `reports`, `imports`, `sync`, `audit`, `settings`.

Cada modulo contiene rutas, schemas, servicio de aplicacion, repositorio, permisos, eventos y pruebas. Los controladores no acceden directamente a Drizzle. Las transacciones empiezan en servicios de aplicacion y abarcan negocio, auditoria, change log y programacion/cancelacion de jobs cuando corresponda.

# 4. Contrato HTTP

## 4.1 Convenciones

- Base `/api/v1`; JSON UTF-8; nombres de campos `camelCase` en API y `snake_case` en PostgreSQL.
- UUID v7 o UUID aleatorio ordenable para entidades; el mismo ID puede generarse offline.
- Requests y responses validados con Zod; OpenAPI 3.1 se genera desde contratos compartidos.
- Cliente TypeScript del frontend generado desde OpenAPI y envuelto por TanStack Query.
- Fechas de instante en RFC 3339 UTC; fechas civiles `YYYY-MM-DD`; zona IANA separada.
- `PATCH` para cambios parciales; no usar `PUT` salvo reemplazo completo real.
- Listados comunes: `page`, `pageSize` maximo 100, `sort` allowlist y filtros tipados.
- Sync usa cursor monotono; no comparte paginacion de listados.

## 4.2 Formato de error

```json
{
  "code": "ACCOUNT_VERSION_CONFLICT",
  "message": "La cuenta fue modificada en otro dispositivo.",
  "fieldErrors": {"displayName": ["Valor en conflicto"]},
  "requestId": "01J...",
  "details": {"conflictId": "01J..."}
}
```

Codigos HTTP: 200/201/204, 400 sintaxis, 401 sesion, 403 permiso, 404 recurso o recurso no visible, 409 conflicto/idempotencia, 422 regla de negocio, 429 limite y 500 error no esperado. Un Supervisor no debe distinguir entre ID inexistente y registro ajeno cuando esa diferencia filtre informacion.

## 4.3 Endpoints principales

```text
POST   /auth/login                 POST /auth/refresh
POST   /auth/logout                GET  /auth/me
GET    /auth/sessions              DELETE /auth/sessions/:id
POST   /auth/offline-grants        POST /auth/change-password

GET/POST/PATCH /users
GET/POST/PATCH /commercial-accounts
GET/POST/PATCH /commercial-accounts/:id/contacts
GET/POST        /commercial-accounts/:id/notes
GET/POST/PATCH /visits
POST /visits/:id/reschedule        POST /visits/:id/complete
POST /visits/:id/cancel
GET/POST/PATCH /tasks              POST /tasks/:id/complete

GET/POST/PATCH /fruits
GET/POST/PATCH /document-categories
GET/POST /commercial-accounts/:id/documents
GET    /documents/:id/download     DELETE /documents/:id
POST   /documents/:id/restore

GET /notifications                POST /notifications/read-all
POST /push-subscriptions           DELETE /push-subscriptions/:id
GET/POST /reports/exports          GET /reports/exports/:id/download
POST /imports                      GET /imports/:id
POST /imports/:id/confirm

POST /sync/push                    GET /sync/pull?cursor=...
GET /sync/status                   GET/PATCH /sync/conflicts/:id
GET /audit                         GET/PATCH /settings
GET /health/live                   GET /health/ready
```

# 5. Autenticacion y autorizacion

## 5.1 Sesion online

La contrasena se almacena con Argon2id y salt administrado por la biblioteca. Parametros iniciales minimos: 19 MiB, 2 iteraciones y paralelismo 1, sujetos a benchmark para mantener la verificacion por debajo de un segundo. Se rehashea al siguiente login cuando aumenten parametros.

El access token dura 15 minutos y vive solo en memoria. El refresh token opaco/aleatorio dura hasta 7 dias, rota en cada uso, viaja en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, se almacena como hash y se asocia a sesion/dispositivo. La reutilizacion de un refresh antiguo revoca la familia.

Se usa proteccion CSRF en operaciones que dependen de cookie: token anti-CSRF ligado a sesion y verificacion de origen. Caddy aplica HTTPS/HSTS; la API aplica CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y limites de cuerpo.

## 5.2 Offline grant y PIN

Tras login online, la API puede emitir un grant firmado con usuario, dispositivo, rol, alcance, `issuedAt` y `expiresAt` maximo 72 horas. La PWA genera una clave aleatoria para cifrar su cache; el PIN local envuelve esa clave mediante una KDF y Web Crypto. Cinco fallos locales destruyen el material de clave y la cache.

El PIN reduce exposicion casual, pero no equivale a autenticacion fuerte en un navegador comprometido. Los documentos no se cachean y el subconjunto de datos se mantiene minimo. Al reconectar, la API revalida rol/asignaciones antes de aceptar operaciones.

## 5.3 Permisos

La autorizacion se aplica en servicios/repositorios con un `AccessContext` obligatorio. Cada consulta del Supervisor incluye el responsable vigente; cada mutacion vuelve a validar propiedad y estado dentro de la transaccion. RLS no se activa en MVP para evitar errores de contexto con pooling, pero puede anadirse despues como defensa adicional.

# 6. Protocolo offline y sincronizacion

## 6.1 Almacenamiento local

Dexie administra bases versionadas: `entities`, `operations`, `syncState`, `conflicts`, `catalogs`, `offlineGrant`. Workbox precachea shell y assets con revision; API dinamica usa network-first o manejo explicito. Nunca se incluye token, PIN en claro o cuerpo de documentos en Cache Storage.

## 6.2 Operacion local

```json
{
  "operationId": "uuid",
  "clientOperationId": "uuid",
  "deviceId": "uuid",
  "sequence": 104,
  "entityType": "visit",
  "entityId": "uuid",
  "action": "PATCH",
  "baseVersion": 3,
  "dependsOn": ["uuid"],
  "payload": {},
  "occurredAt": "2026-07-21T20:30:00Z"
}
```

El cliente ordena por dependencias. El servidor inserta `sync_operations` con unique `(device_id, client_operation_id)` antes de aplicar. Repetir una operacion devuelve el resultado anterior. Cada cambio aceptado incrementa `version`, crea auditoria y escribe `change_log` con cursor.

## 6.3 Conflictos

Un update ejecuta `WHERE id = ? AND version = baseVersion`. Si no coincide, se comparan campos contra la version base. Cambios en campos diferentes se fusionan de forma segura; mismo campo, cambio de estado incompatible, registro archivado o perdida de asignacion genera `sync_conflicts`. Solo Manager resuelve por campo o version completa; toda resolucion queda auditada.

## 6.4 Pull

`GET /sync/pull?cursor=` devuelve cambios autorizados posteriores, tombstones, nueva asignacion y `nextCursor`. El cambio de asignacion hace que el Supervisor purgue la cuenta y dependencias que ya no pueda consultar. El servidor no confia en la cache previa para decidir permisos.

# 7. Documentos

Ruta fisica: `/srv/vicam/documents/`. El `storage_key` es aleatorio, no contiene nombre del cliente y nunca se convierte en URL publica.

Flujo: carga online -> limite 10 MB -> extension/MIME/firma -> nombre seguro -> checksum SHA-256 -> cuarentena -> ClamAV -> estado `AVAILABLE` o `REJECTED` -> auditoria. Las firmas se actualizan con FreshClam. Descarga autorizada establece `Content-Disposition`, `nosniff`, tipo validado y streaming; no renderiza DOCX/XLSX inline.

Estados: `QUARANTINED`, `SCANNING`, `AVAILABLE`, `REJECTED`, `DELETED`. El borrado logico conserva metadata 30 dias; el worker elimina bytes y registra evidencia.

# 8. Worker y jobs

pg-boss usa un schema separado y colas: `reminder-delivery`, `report-pdf`, `report-xlsx`, `document-scan`, `import-validate`, `import-commit`, `retention-cleanup`, `backup-check`.

- Jobs con clave singleton/deduplicacion por recurso y version.
- Reintentos exponenciales y dead-letter operativo.
- PDF con concurrencia 1; XLSX puede usar 1 inicialmente.
- Cambiar/cancelar recurso invalida jobs previos transaccionalmente.
- Worker expone readiness y registra `jobId`, tipo, duracion y resultado sin contenido sensible.

# 9. Modelo de datos

## 9.1 Convenciones

UUID PK; `created_at`, `created_by`, `updated_at`, `updated_by`; `version integer not null default 1` para sincronizables; `deleted_at` solo donde la politica lo requiere. Todos los instantes usan `timestamptz`. Estados se modelan con `pgEnum` o `CHECK` versionado. Migraciones SQL son el unico medio para cambiar produccion.

Extensiones: `pg_trgm` y `unaccent`. No usar `uuid-ossp` si los UUID se generan en aplicacion. Busqueda normaliza acentos y usa indices GIN trigram donde las consultas lo justifiquen.

## 9.2 Diccionario de tablas

| Tabla | Campos/relaciones centrales | Reglas clave |
|---|---|---|
| `users` | username, full_name, role, password_hash, status | username lower unico; desactivar, no borrar |
| `user_sessions` | user, device, refresh_hash, family_id, expires/revoked | rotacion y deteccion de reuso |
| `devices` | user, name, platform, last_seen, status | revocable; soporte offline/push |
| `offline_grants` | user, device, scope_hash, issued/expires, revoked | maximo configurable 72 h |
| `push_subscriptions` | user/device, endpoint_hash, p256dh, auth, expires | unique endpoint; secreto protegido |
| `notification_preferences` | user, visit/task channels y offsets | in-app siempre; push configurable |
| `commercial_accounts` | display/legal name, type, owner, location, phone/email, GPS | owner requerido; phone OR email; version |
| `commercial_contacts` | account, name, title, phone/email, is_primary | at most one primary; negocio garantiza uno si hay contactos |
| `commercial_account_fruits` | account, fruit | PK compuesta; solo frutas activas nuevas |
| `commercial_account_notes` | account, body, author | historial; no hard delete ordinario |
| `fruits` | name, normalized_name, active | nombre normalizado unico activo |
| `document_categories` | name, normalized_name, active | desactivar si esta en uso |
| `visits` | account, responsible, scheduled_at, timezone, status, observations | cierre exige datos; version |
| `visit_reschedules` | visit, old/new time, reason, actor | append-only |
| `tasks` | account, optional visit, responsible, due_at, status, priority | visita de misma cuenta; due requerido |
| `documents` | account, optional visit/task, category, storage_key, MIME, checksum, scan status | visit XOR task; misma cuenta; max 10 MB |
| `reminders` | visit XOR task, scheduled_at, status, job_key | exactamente un target; deduplicacion |
| `notifications` | user, type, resource, title/body, read_at | cuerpo breve sin secretos; purga a los 30 dias |
| `audit_logs` | actor, action, entity, before/after, request/device/IP | append-only; 5 anos |
| `sync_operations` | device, client_operation_id, payload_hash, result, status | unique idempotente |
| `change_log` | cursor bigint, entity/id, operation, version, visibility hint | pull incremental; retencion suficiente para ventana offline |
| `sync_conflicts` | entity/id, local/server/base, fields, resolution | Manager resuelve; auditado |
| `report_exports` | requester, template, filters, format, status, storage, expiry | 7 dias; permisos congelados y revalidados al descargar |
| `import_batches` | requester, file, mapping, totals, status | preview/confirm idempotente |
| `import_rows` | batch, row_number, normalized data, errors, action | evidencia por fila |
| `app_settings` | key, JSON typed value, version | allowlist y auditoria |

pg-boss administra sus tablas en schema propio; no se duplican en el dominio.

## 9.3 Restricciones esenciales

```sql
CHECK (phone IS NOT NULL OR email IS NOT NULL);
CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
CHECK (num_nonnulls(visit_id, task_id) <= 1); -- documents, account_id obligatorio
CHECK (num_nonnulls(visit_id, task_id) = 1);  -- reminders

CREATE UNIQUE INDEX uq_contact_primary
  ON commercial_contacts(account_id)
  WHERE is_primary AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_sync_operation
  ON sync_operations(device_id, client_operation_id);
```

Las reglas “contacto principal si existen contactos”, “visita/tarea pertenecen a la misma cuenta” y “responsable activo” se validan dentro de transacciones de servicio; se agregan triggers solo si una restriccion declarativa no es posible y el beneficio supera la complejidad.

## 9.4 Indices iniciales

- accounts: owner/status, country/city, GIN trigram sobre nombre normalizado.
- contacts: account, telefono/email normalizados, trigram sobre nombre.
- visits: `(responsible_user_id, scheduled_at)` parcial para `PENDING`; account/date.
- tasks: `(responsible_user_id, due_at)` parcial para estados abiertos; account.
- documents: account/category/date; checksum.
- notifications: user/read/created; audit actor/date/entity.
- change_log: cursor PK y entity/id/version.

Los indices se validan con `EXPLAIN ANALYZE`; no se crean por intuicion para cada columna.

# 10. Migraciones y consistencia

Drizzle define schema TypeScript y genera SQL revisable. Desarrollo: `generate`, `migrate`, seeds; nunca `push` en staging/produccion. Cada release ejecuta una migracion one-shot antes de actualizar API.

Cambios grandes siguen expand/contract: agregar columna nullable/compatible, desplegar codigo dual, backfill en worker, hacer constraint, retirar campo en release posterior. Rollback normal vuelve a imagen previa; una migracion aplicada no se revierte automaticamente si perderia datos. Se prepara forward-fix.

# 11. Despliegue

GitHub Actions ejecuta format, lint, typecheck, unitarias, integracion PostgreSQL, build, E2E smoke, escaneo de dependencias e imagen. Publica imagenes `web/api/worker` en GHCR con SHA y version.

Produccion requiere aprobacion manual: verificar backup, descargar imagenes, ejecutar migracion, actualizar Compose, esperar healthchecks, ejecutar smoke y registrar release. Ante fallo se restaura imagen previa si la base sigue compatible; ante dano de datos se activa el runbook de restauracion.

No usar PM2 dentro de contenedores. `restart: unless-stopped`, usuario no root, filesystem read-only cuando sea posible, capabilities minimas, secretos fuera de imagen y red privada.

# 12. VPS, red y recuperacion

- Crear usuario administrativo con llave SSH; validar acceso antes de deshabilitar login root por contrasena.
- Firewall Hostinger/UFW: 22 restringido cuando sea viable, 80 y 443 publicos; negar PostgreSQL y puertos internos.
- DNS A de `app` y `staging`; Caddy renueva certificados y redirige HTTP.
- Activar backup diario de Hostinger. Hostinger conserva sus copias separadas del VPS, con retencion propia del servicio.
- `pg_dump` diario verificado, snapshot manual antes de migraciones y prueba trimestral de restauracion.
- Riesgo aceptado: no existe copia independiente de otro proveedor; RPO aproximado 24 h, RTO objetivo 4 h.
- Reservar inicialmente 20 GB para documentos, 20 GB para PostgreSQL/indices/WAL y margen amplio para SO, imagenes Docker, firmas y backups temporales.

# 13. Observabilidad

Pino produce JSON con `request_id`, actor seguro, ruta normalizada, status y duracion; redaccion obligatoria de auth, cookies, PIN, payloads sensibles y documentos. Docker usa driver `local` y rotacion. `/health/live` comprueba proceso; `/health/ready` comprueba DB y dependencias criticas sin ejecutar operaciones costosas.

Un monitor externo consulta salud y certificado. Hostinger aporta CPU, RAM, disco y red. Alertas minimas: sitio caido, readiness fallida, disco >80 %, backup fallido, cola atrasada, ClamAV sin firmas, certificados y errores 5xx sostenidos.

# 14. Seguridad de entrega

- Dependabot/Renovate con PR y pruebas; no actualizaciones flotantes en produccion.
- Secret scanning, `npm audit`/scanner equivalente y escaneo de imagen en CI.
- Dependencias fijadas en lockfile y base images con digest o tag de parche controlado.
- Revision OWASP de auth, autorizacion horizontal, CSRF, XSS, uploads, SSRF y headers.
- Auditoria de cada asignacion, cambio de rol, reset, exportacion, documento, conflicto y setting.
- Datos de staging ficticios; backups y exports no entran al repositorio.

# 15. Capacidad y evolucion

Objetivo de diseno inicial: 50 usuarios registrados, 20 concurrentes, 100 000 cuentas, 1 000 000 de visitas/tareas y 20 GB de documentos. Es una hipotesis para pruebas, no una promesa sin benchmark. k6 y datos sinteticos validan p95 y recursos.

Escalamiento preferido: optimizar consultas/indices, aumentar VPS, separar PostgreSQL o documentos, y solo despues evaluar servicios separados. Redis, Kubernetes, microservicios y almacenamiento de objetos no forman parte del MVP.

# 16. ADR obligatorios al iniciar el repositorio

1. Monolito modular y limites.
2. Tokens/cookies y recuperacion administrativa.
3. Drizzle como unico dueno de migraciones.
4. pg-boss sin Redis.
5. Protocolo sync e idempotencia.
6. Documentos online, volumen privado y ClamAV.
7. Reportes background con Chromium concurrency 1.
8. Caddy y mismo origen.
9. Backup Hostinger como riesgo aceptado.

# 17. Referencias oficiales

- Node.js releases: https://nodejs.org/en/about/previous-releases
- Express 5: https://expressjs.com/en/starter/installing/
- Drizzle migrations: https://orm.drizzle.team/docs/migrations
- pg-boss: https://github.com/timgit/pg-boss
- Caddy HTTPS: https://caddyserver.com/docs/automatic-https
- Workbox: https://developer.chrome.com/docs/workbox
- Dexie: https://dexie.org/docs
- OWASP Password Storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- ClamAV Docker: https://docs.clamav.net/manual/Installing/Docker.html
- PostgreSQL `pg_trgm`: https://www.postgresql.org/docs/current/pgtrgm.html
- Hostinger VPS backups: https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps-at-hostinger/
