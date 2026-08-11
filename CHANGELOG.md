# Changelog

Todos los cambios relevantes de VICAM se documentan en este archivo. El
proyecto usa versionado semantico; una version y fecha solo se asignan al crear
un release aprobado.

## [Unreleased]

### Added

- Monorepo pnpm con web React/PWA, API Express, worker pg-boss y PostgreSQL con
  migraciones Drizzle.
- Flujo comercial online para cuentas, contactos, visitas, tareas, usuarios y
  auditoria.
- Operacion offline cifrada con grants, PIN local, cola idempotente,
  sincronizacion incremental, conflictos y purga.
- Documentos privados con cuarentena y ClamAV, reportes PDF/XLSX,
  importaciones, notificaciones, catalogos, configuracion y mapas.
- Compose local, staging y produccion; Caddy, CI, backups y runbooks.
- Validaciones de carga, accesibilidad, PWA, restore, rollback y piloto.
- Vista mensual navegable en Agenda y tira semanal estable al seleccionar días.
- Flujo comercial conectado Cliente → Visita → Resultado → Tarea, con pestañas
  profundas de visitas, tareas, contactos y documentos en el perfil del cliente.
- Historial real de visitas (creación, reprogramaciones, cierre y cancelación),
  resultado comercial separado del estado y detalle propio de tareas.
- Resumen comercial por cliente con próxima visita, tareas abiertas y actividad
  reciente, sin consultas N+1.
- Dashboard analítico de Reportes con resumen gerencial, vistas de visitas,
  tareas, clientes y documentos, filtros operativos, tablas responsive y
  exportación secundaria PDF/XLSX con el alcance vigente.

### Security

- Argon2id, refresh token rotatorio, CSRF, rate limiting, RBAC y ownership.
- Logs con redaccion de secretos y documentos excluidos del almacenamiento
  offline.

### Fixed

- Migracion de retencion de auditoria compatible con bases pobladas y con la
  proteccion append-only activa.
- Usuarios sin configuración de zona horaria y notificaciones paginadas de 15
  en 15 con purga automática a los 30 días.
- Cierre de visita y creación opcional de tarea de seguimiento en una sola
  transacción e idempotencia, tanto online como durante sincronización offline.
