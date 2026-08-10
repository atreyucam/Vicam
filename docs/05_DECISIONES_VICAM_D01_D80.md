# VICAM — Registro de decisiones aprobadas

Versión 1.0 final  
Fecha: 21 de julio de 2026  
Estado: línea base obligatoria para programación

Este registro evita que Codex o un subagente vuelva a decidir asuntos ya
cerrados. D-01 a D-66 fueron seleccionadas durante la revisión. D-67 a D-80 se
cerraron automáticamente con los defaults recomendados bajo autorización final.

## Dominio, actores y datos comerciales

| ID | Decisión aprobada |
|---|---|
| D-01 | Cada cuenta comercial tiene un único responsable actual. Manager puede reasignarlo. |
| D-02 | Supervisor solo accede a las cuentas que tiene asignadas en ese momento. |
| D-03 | Una cuenta admite múltiples contactos y uno principal cuando existan contactos. |
| D-04 | La cuenta requiere al menos teléfono o correo electrónico. |
| D-05 | Una cuenta puede existir temporalmente sin contactos. |
| D-06 | Nombre visible y tipo son obligatorios; razón social es opcional. |
| D-07 | País y ciudad son obligatorios. |
| D-08 | Coordenadas GPS opcionales y obtenidas solo mediante acción explícita. |
| D-09 | Las frutas son opcionales y provienen de catálogo administrable. |

## Visitas, tareas y recordatorios

| ID | Decisión aprobada |
|---|---|
| D-10 | Supervisor crea sus visitas; Manager puede crear y asignar visitas. |
| D-11 | Reprogramar conserva la visita en `PENDING` y agrega historial con motivo, actor y fechas. |
| D-12 | La tarea exige fecha de vencimiento; la hora es opcional; `OVERDUE` se deriva. |
| D-13 | Completar una visita exige observaciones y registra hora real y actor. |
| D-14 | Supervisor crea tareas propias; Manager puede asignarlas. |
| D-15 | Notificaciones in-app y push; visitas 1 día y 1 hora antes; tareas 1 día antes y al vencer. |

## PWA, offline y sincronización

| ID | Decisión aprobada |
|---|---|
| D-16 | Offline admite solo datos estructurados; nunca imágenes, fotos o documentos. |
| D-17 | Autorización offline máxima 72 horas; primer login online; logout purga datos locales. |
| D-18 | El caché offline conserva el mínimo autorizado según rol y asignación. |
| D-19 | Campos distintos pueden fusionarse automáticamente; choque del mismo campo crea conflicto para Manager. |
| D-20 | Sincronización automática y acción manual “Sincronizar ahora”. |
| D-21 | Ningún archivo entra en la cola offline. |

## Dominio, infraestructura y seguridad base

| ID | Decisión aprobada |
|---|---|
| D-22 | Producción en `https://app.vicamproduce.com` y API same-origin en `/api/v1`. |
| D-23 | Despliegue completo mediante Docker Compose. |
| D-24 | Backup diario Hostinger, `pg_dump`, snapshot previo a migraciones y prueba trimestral; RPO 24 h, RTO 4 h. |
| D-25 | Sin recuperación por correo: Manager restablece Supervisor; Manager se recupera mediante CLI segura del VPS. |
| D-26 | El MVP no incluye MFA. |
| D-27 | Archivos permitidos: PDF, DOCX y XLSX; máximo 10 MB; sin imágenes. |
| D-28 | Sesión 7 días, access token 15 minutos y autorización offline máxima 72 horas. |
| D-29 | Contraseña: mínimo 8 caracteres, mayúscula, minúscula, número y símbolo; bloquear contraseñas comunes o comprometidas. |
| D-30 | Documentos en volumen privado del VPS; la aplicación no sube imágenes o fotos. |

## Reportes y experiencia

| ID | Decisión aprobada |
|---|---|
| D-31 | PDF/XLSX se generan en worker; concurrencia PDF inicial 1; exportaciones disponibles 7 días. |
| D-32 | Cinco grupos: visitas, tareas, cuentas, documentos y resumen gerencial. |
| D-33 | Dashboard orientado a acciones, no a gráficos decorativos. |
| D-34 | Sidebar en escritorio y navegación inferior en móvil. |
| D-35 | Formulario de cuenta por secciones en escritorio y tres pasos en móvil. |
| D-36 | Agenda semana/mes/lista en escritorio y día/mes/lista en móvil; la tira semanal no se desplaza al seleccionar un día. |
| D-37 | Tipografía Inter. |
| D-38 | Color primario `#0075DE`. |
| D-39 | CTA contextual y barra fija de acciones en formularios móviles. |

## Servicios, ambientes y operación

| ID | Decisión aprobada |
|---|---|
| D-40 | MapLibre con proveedor configurable. |
| D-41 | El sistema no enviará correos en el MVP. |
| D-42 | Se acepta backup diario Hostinger sin copia automática en un proveedor independiente. |
| D-43 | Soporte últimas dos versiones objetivo; ancho mínimo 360 px. |
| D-44 | Desarrollo, staging y producción separados; staging solo con datos ficticios o saneados. |
| D-45 | Piloto operativo de una semana. |
| D-46 | Monorepo pnpm, TypeScript strict. |
| D-47 | Drizzle y migraciones SQL versionadas; prohibido `push` directo en producción. |
| D-48 | pg-boss sobre PostgreSQL; sin Redis. |

## Stack, API y autenticación

| ID | Decisión aprobada |
|---|---|
| D-49 | Node.js 24 LTS, Express 5 y PostgreSQL 18. |
| D-50 | Caddy como gateway y terminación TLS. |
| D-51 | Workbox para PWA y Dexie para almacenamiento autorizado offline. |
| D-52 | REST, Zod, OpenAPI 3.1 y cliente TypeScript generado. |
| D-53 | Access token en memoria; refresh token rotatorio en cookie HttpOnly y almacenado como hash. |
| D-54 | PIN local de seis dígitos; vigencia máxima 72 horas; cinco fallos purgan datos. |
| D-55 | Vitest, React Testing Library, Supertest, Testcontainers, Playwright y k6. |
| D-56 | GitHub Actions y GitHub Container Registry. |
| D-57 | Despliegue controlado con aprobación, smoke tests y rollback. |

## Frontend, observabilidad y ciclo de vida

| ID | Decisión aprobada |
|---|---|
| D-58 | React 19 y Vite. |
| D-59 | Tailwind CSS 4, Radix UI, componentes propios y Lucide. |
| D-60 | TanStack Query, React Hook Form, Zod, Zustand y Dexie. |
| D-61 | Pino, rotación de logs, health/readiness y monitor externo. |
| D-62 | Retenciones: auditoría 5 años; seguridad 1 año; jobs 90 días; exportaciones 7 días; notificaciones y logs 30 días. |
| D-63 | Usuarios se desactivan, cuentas se archivan y documentos/errores eliminados permanecen 30 días en papelera. |
| D-64 | Todo documento pertenece a una cuenta y opcionalmente a una visita o tarea de esa misma cuenta. |
| D-65 | Manager importa XLSX/CSV con preview, errores por fila, deduplicación y confirmación idempotente. |
| D-66 | Interfaz `es-EC`; persistencia UTC; presentación fija en `America/Guayaquil`, sin zona configurable por usuario; zona opcional de cuenta. |

## Defaults técnicos cerrados automáticamente

| ID | Decisión aprobada |
|---|---|
| D-67 | Argon2id para contraseñas, parámetros medidos en el VPS y rehash progresivo. |
| D-68 | ClamAV en contenedor; cuarentena antes de publicar documentos. |
| D-69 | MapLibre GL JS con MapTiler inicial; clave restringida y proveedor reemplazable por ambiente. |
| D-70 | Búsqueda PostgreSQL con `unaccent` y `pg_trgm`; sin Elasticsearch en el MVP. |
| D-71 | Permisos en capa de aplicación/repositorio con pruebas; RLS queda como defensa futura. |
| D-72 | Página/límite en listados y cursor monótono para sync y change log. |
| D-73 | Web Push mediante VAPID; notificación interna siempre como fallback. |
| D-74 | Objetivo mensual de disponibilidad 99,5 %, excluyendo mantenimiento anunciado. |
| D-75 | WCAG 2.2 AA en flujos críticos. |
| D-76 | Diseño inicial para 50 usuarios, 20 concurrentes, 100.000 cuentas y 20 GB de documentos; validar con carga. |
| D-77 | Sin analítica de marketing; únicamente logs, métricas operativas y auditoría. |
| D-78 | Versionado semántico, changelog, releases etiquetadas e imágenes de contenedor por SHA. |
| D-79 | Staging con datos ficticios o anonimizados; prohibida una copia de producción sin saneamiento. |
| D-80 | Piloto de una semana con proceso anterior disponible y decisión formal de salida. |

## Regla de cambio

Codex y los subagentes no pueden sustituir estas decisiones por preferencias
personales. Si durante la implementación aparece una contradicción material,
deben detener esa parte, registrar un ADR propuesto con opciones e impacto y
solicitar decisión explícita antes de modificar esta línea base.
