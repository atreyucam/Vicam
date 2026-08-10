# Plan de ejecucion VICAM

Estado: plan coordinado aprobado para iniciar implementacion por fases.

## Reglas

- Una fase por ejecucion de implementacion.
- No avanzar con pruebas rojas o hallazgos bloqueantes.
- Cada fase registra decisiones D-xx cubiertas.
- El coordinador asigna carpetas exclusivas antes de delegar.
- Produccion requiere autorizacion explicita.
- Los documentos aprobados en `docs/` no se modifican sin autorizacion
  explicita.
- `packages/db` es el nombre canonico del paquete de base de datos salvo
  decision humana distinta.
- `packages/contracts`, workspace, lockfile y configuracion raiz son
  responsabilidad del coordinador.

## Resumen ejecutivo

El repositorio parte de una base documental: aun no existen `apps/`,
`packages/`, `infra/`, `.github/`, Compose, Caddy, pruebas ni workflows. La
primera ejecucion debe crear cimientos integrados, no ajustar una aplicacion
existente.

La implementacion se hara como monorepo pnpm TypeScript strict, con React 19 y
Vite en `apps/web`, Express 5 en `apps/api`, pg-boss en `apps/worker`,
PostgreSQL 18 y Drizzle en `packages/db`, contratos Zod/OpenAPI en
`packages/contracts`, componentes compartidos en `packages/ui`, Docker Compose
y Caddy. No se usara Redis en el MVP.

El agente coordinador integra cambios compartidos y reserva configuracion raiz,
lockfile, contratos, documentos aprobados y plan. Los subagentes trabajan con
propiedad exclusiva por carpeta y el agente `reviewer` revisa en solo lectura.

## Propiedad de carpetas

- Backend: `apps/api/**`, `apps/worker/**`, `packages/db/**` y pruebas backend
  relacionadas.
- Frontend: `apps/web/**`, `packages/ui/**` y pruebas frontend relacionadas.
- Platform: `infra/**`, `.github/**`, `docs/runbooks/**`, Compose, Caddy,
  Dockerfiles y scripts operativos asignados.
- Coordinador: `package.json`, `pnpm-workspace.yaml`, lockfile, configs raiz,
  `packages/contracts/**`, `AGENTS.md`, `PLANS.md`, documentos aprobados y
  cambios de arquitectura compartida.
- Reviewer: solo lectura; revisa requisitos, diseno, seguridad, pruebas,
  migraciones, compatibilidad y evidencias.

## Fase 0 - Cimientos integrados

Objetivo y entregable demostrable: monorepo pnpm con web, API y worker
arrancando en local; contratos base; DB inicial; shell responsive; tokens y
componentes base; CI minimo; Docker local.

Orden de dependencias:

1. Coordinador crea estructura raiz, workspace, scripts, TypeScript strict,
   configuracion de lint/test, `packages/contracts` y reserva lockfile/configs.
2. Backend crea `apps/api`, `apps/worker`, `packages/db`, health live/ready,
   logger seguro, error envelope, conexion PostgreSQL y migraciones iniciales.
3. Frontend crea `packages/ui` con tokens canonicos y componentes base, mas
   `apps/web` con shell responsive, rutas base, estados globales y PWA shell.
4. Platform crea `infra/`, Compose local, Caddy base, Dockerfiles, CI inicial y
   runbooks base.
5. Reviewer revisa requisitos, propiedad, seguridad, diseno, pruebas y
   evidencias antes de cerrar fase.

Decisiones cubiertas: D-22, D-23, D-34, D-37, D-38, D-46 a D-60, D-61, D-67,
D-71, D-75 y D-78.

Migraciones y contratos:

- Migracion SQL inicial para extensiones `unaccent` y `pg_trgm`.
- Tablas base para usuarios, sesiones, dispositivos, cuentas, contactos,
  visitas, tareas, auditoria, sync base y metadata de documentos.
- Contratos Zod/OpenAPI minimos para auth, health y flujo vertical inicial.

Pruebas, evidencia y puertas de calidad:

- `format`, `lint`, `typecheck`, unit tests iniciales y build web/API/worker.
- Migraciones ejecutadas desde DB vacia.
- Health local verificado.
- Shell validado en 360, 768 y 1440 px.
- Revision de que no existen imagenes, fotografias ni colores fuera de tokens.

Riesgos y rollback:

- Riesgo principal: crear cimientos incompletos que bloqueen a subagentes.
- Rollback: revertir la fase completa antes de que existan datos reales; no hay
  migraciones productivas.

Criterio de aceptacion:

- Los tres artefactos principales arrancan localmente, CI minimo pasa, los
  contratos base generan OpenAPI valido y reviewer no reporta hallazgos
  bloqueantes.

## Fase 1 - Flujo vertical online

Objetivo y entregable demostrable: Manager y Supervisor ejecutan online
`cuenta -> visita -> cierre -> tarea -> auditoria` con permisos backend reales.

Orden de dependencias:

1. Backend implementa auth online, refresh rotatorio, CSRF/rate limit,
   usuarios, RBAC/ownership, cuentas/contactos, visitas/cierre, tareas y
   auditoria transaccional.
2. Frontend implementa login, inicio por rol, cuentas lista/formulario/detalle,
   agenda, visita/cierre y tareas con estados obligatorios.
3. Coordinador integra contratos OpenAPI, cliente generado y cambios
   compartidos.
4. Reviewer revisa permisos horizontales, diseno, accesibilidad y trazabilidad.

Decisiones cubiertas: D-01 a D-15, D-25, D-28, D-29, D-33 a D-39, D-52 a
D-55, D-66, D-67, D-70 a D-72 y D-75.

Migraciones y contratos:

- Tablas y constraints definitivos para usuarios, sesiones, cuentas, contactos,
  visitas, reprogramaciones, tareas, reminders y auditoria.
- Endpoints `/auth/*`, `/users`, `/commercial-accounts`, `/visits`, `/tasks` y
  `/audit`.

Pruebas, evidencia y puertas de calidad:

- Supertest de RBAC/ownership y errores 401/403/404/409/422.
- Testcontainers PostgreSQL para migraciones, constraints y concurrencia.
- Unitarias de dominio, permisos, fechas y auditoria.
- Playwright Manager/Supervisor, axe, teclado/foco y capturas 360/768/1440.
- Verificacion de logs sin contrasenas, tokens, PIN ni contenido documental.

Riesgos y rollback:

- Riesgo principal: autorizacion horizontal incompleta o auditoria insegura.
- Rollback: volver a imagen anterior si la migracion es compatible; si no,
  aplicar forward-fix antes de avanzar.

Criterio de aceptacion:

- Manager y Supervisor completan el flujo vertical online sin acceso a datos
  ajenos, con auditoria segura y pruebas verdes.

ssssss
## Fase 3 - Operacion completa

Objetivo y entregable demostrable: documentos seguros, push, reportes,
importaciones, catalogos, mapa, dashboard y observabilidad operativa en staging.

Orden de dependencias:

1. Backend implementa documentos/ClamAV, catalogos, settings, notificaciones y
   push, reportes worker, importaciones idempotentes y retenciones.
2. Frontend implementa documentos, notificaciones, reportes, importaciones,
   usuarios, catalogos, auditoria, settings, perfil y mapas sin imagenes ni
   fotografias.
3. Platform completa Compose staging/prod, Caddy, GHCR, scans, backups,
   observabilidad y runbooks.
4. Reviewer revisa seguridad de documentos, reportes, importaciones,
   accesibilidad y operacion.

Decisiones cubiertas: D-24, D-27, D-30 a D-32, D-40 a D-42, D-56, D-57, D-61 a
D-65, D-68, D-69, D-73, D-74 y D-76 a D-79.

Migraciones y contratos:

- Documentos, categorias, push subscriptions, notifications, report_exports,
  import_batches, import_rows, app_settings y retenciones.
- Contratos para `/documents`, `/notifications`, `/reports`, `/imports`,
  `/fruits`, `/document-categories` y `/settings`.

Pruebas, evidencia y puertas de calidad:

- Uploads PDF/DOCX/XLSX con extension, MIME, firma, tamano, checksum y ClamAV.
- Descarga autorizada sin exponer rutas de volumen.
- Reportes PDF/XLSX equivalentes y con permisos correctos.
- Importacion repetida sin duplicados y con errores por fila.
- Backup `pg_dump` verificado, staging con datos ficticios, CI y scans verdes.

Riesgos y rollback:

- Riesgo principal: carga operativa del VPS por PostgreSQL, ClamAV, PDF worker,
  backups temporales y documentos.
- Rollback: volver a imagen anterior si la DB sigue compatible; para datos,
  usar forward-fix o runbook restore segun impacto.

Criterio de aceptacion:

- Staging demuestra operacion completa con documentos protegidos, jobs
  observables, importaciones/reportes correctos y sin secretos en logs.

## Fase 4 - Validacion, seguridad y piloto

Objetivo y entregable demostrable: release candidato validado en staging,
restore/rollback probado, evidencia de accesibilidad/carga/PWA y piloto de una
semana preparado.

Orden de dependencias:

1. Platform ejecuta pruebas de restore/rollback, smoke staging, monitor externo,
   runbooks finales y checklist de produccion sin desplegar.
2. Backend y frontend corrigen hallazgos bloqueantes de carga, permisos, sync,
   UI y accesibilidad.
3. Reviewer hace revision final contra D-01 a D-80 y criterios de aceptacion
   del MVP.
4. Coordinador consolida evidencia, changelog, ADR/runbooks y lista de
   aprobacion humana.

Decisiones cubiertas: D-43 a D-45, D-55 a D-57, D-74 a D-80 y criterios de
aceptacion del MVP.

Pruebas, evidencia y puertas de calidad:

- `format`, `lint`, `typecheck`, unitarias, componentes, API, DB y E2E
  completos.
- Playwright PWA, k6 con dataset sintetico, Lighthouse/PWA, teclado, foco y
  axe.
- Viewports 360, 390, 768, 1366 y 1440 px.
- Restore trimestral simulado, rollback de imagen y smoke de release.

Riesgos y rollback:

- Riesgo principal: descubrir defectos bloqueantes tarde en piloto o pruebas de
  carga.
- Rollback: mantener proceso anterior disponible durante piloto y no desplegar
  produccion hasta aceptacion humana formal.

Criterio de aceptacion:

- No hay defectos bloqueantes/criticos, restore y rollback estan probados,
  usuarios completan escenarios, y Manager/Supervisor firman aceptacion o lista
  fechada de correcciones no bloqueantes.

## Contradicciones y decisiones pendientes

- `packages/db` vs `packages/database`: `AGENTS.md` y `backend.toml` asignan
  `packages/db`; arquitectura menciona `packages/database`. Se usara
  `packages/db` y no se creara `packages/database` salvo aprobacion humana
  distinta.
- Backend necesita contratos compartidos, pero su `.toml` prohibe modificarlos
  directamente. El coordinador integra `packages/contracts`; backend y frontend
  solo proponen cambios o consumen contratos aprobados.
- No hay contradiccion material sobre diseno, seguridad, offline, operacion o
  despliegue. La brecha actual es estructural: el repositorio aun no contiene
  implementacion.
- Quedan por confirmar repositorio GitHub/GHCR, DNS `app.vicamproduce.com` y
  `staging.app.vicamproduce.com`, acceso SSH al VPS y responsables de release y
  backup.
- Cualquier despliegue real a produccion requiere aprobacion explicita en la
  fase correspondiente.
