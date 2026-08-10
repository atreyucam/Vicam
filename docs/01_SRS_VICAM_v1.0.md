% VICAM - Especificacion de Requisitos de Software
% Version 1.0 final | 21 de julio de 2026
% Aplicacion web responsive y PWA para gestion de cuentas comerciales

> **Estado:** aprobado para iniciar programacion. Este documento reemplaza el SRS v0.4. Las decisiones D-01 a D-66 fueron aprobadas en conversacion; las restantes se cerraron con los defaults tecnicos recomendados autorizados por VICAM.

[[PAGEBREAK]]

# 1. Proposito y resultado esperado

VICAM sera una aplicacion interna para organizar cuentas comerciales, contactos, visitas, tareas, recordatorios, documentos, ubicaciones, catalogos y reportes. Funcionara en escritorio y como PWA instalable en Android y iPhone desde `https://app.vicamproduce.com`.

El resultado esperado es que un Manager y uno o mas Supervisores puedan ejecutar el ciclo completo **cuenta -> visita -> cierre -> tarea -> seguimiento**, tanto online como con conectividad intermitente, sin duplicar ni perder datos. Las cuentas comerciales externas no tendran acceso.

La primera liberacion se considera un **monolito modular desplegado con Docker Compose en un unico VPS**. Se acepta que no existe alta disponibilidad: una falla total del VPS puede dejar el sistema fuera de servicio hasta restaurarlo.

# 2. Alcance

## 2.1 Incluido en el MVP

- Autenticacion, sesiones y recuperacion administrativa de acceso.
- Usuarios internos con roles Manager y Supervisor.
- Cuentas comerciales con responsable unico y multiples contactos.
- Catalogo de frutas y categorias de documentos.
- Agenda, visitas, reprogramacion, cancelacion y cierre.
- Tareas, prioridades, vencimientos y seguimiento.
- Notificaciones internas y push PWA.
- Documentos PDF, DOCX y XLSX; no se admiten imagenes ni fotos.
- GPS opcional y mapa basico.
- Dashboard por rol.
- Cinco grupos de reportes, con salida PDF y Excel.
- Importacion controlada desde XLSX/CSV.
- PWA offline para datos estructurados y centro de sincronizacion.
- Auditoria, configuracion y operacion en espanol.

## 2.2 Fuera del MVP

- Fotos, imagenes, camara, galeria, miniaturas y compresion de imagenes.
- Acceso de clientes o cuentas comerciales.
- WhatsApp, correo automatico, chat, firma electronica o videollamadas.
- Facturacion, inventario, pedidos, pagos, ERP o CRM de terceros.
- Aplicaciones nativas publicadas en App Store o Play Store.
- MFA, SSO y biometria.
- Geocodificacion avanzada, rutas y seguimiento en tiempo real.
- Ingles completo; se deja preparado para una fase posterior.

# 3. Actores, propiedad y permisos

## 3.1 Manager

Administra toda la informacion, asigna responsables, resuelve conflictos, gestiona usuarios y catalogos, consulta auditoria, configura reglas, importa datos y genera reportes globales.

## 3.2 Supervisor

Accede exclusivamente a las cuentas que tenga asignadas en ese momento. Puede crear y mantener sus visitas y tareas propias, trabajar offline con su subconjunto autorizado y generar reportes propios cuando la configuracion lo permita. Al reasignarse una cuenta pierde el acceso operativo; `created_by` queda solo como auditoria.

## 3.3 Matriz resumida

| Recurso | Manager | Supervisor |
|---|---|---|
| Usuarios, catalogos, configuracion y auditoria | Administrar | Sin acceso |
| Cuentas y contactos | Todas; crear, editar, asignar y archivar | Solo asignadas; crear y editar dentro de su alcance |
| Visitas | Todas; asignar a cualquier usuario activo | Solo propias y de cuentas asignadas |
| Tareas | Todas; asignar y reasignar | Solo propias y de cuentas asignadas |
| Documentos | Todos segun cuenta | Solo cuentas asignadas; carga unicamente online |
| Reportes | Globales y propios | Propios si la regla esta habilitada |
| Conflictos de sincronizacion | Resolver | Visualizar y solicitar resolucion |

# 4. Modelo funcional

## 4.1 Cuenta comercial

Representa una empresa, distribuidora, finca, persona, entidad u otro contacto comercial. Tiene exactamente un `owner_user_id` activo. `display_name` y `account_type` son obligatorios; `legal_name` es opcional. Se requiere pais, ciudad y al menos telefono o correo. Estado/provincia, direccion exacta y codigo postal son opcionales.

La ubicacion GPS es opcional y solo se captura mediante accion explicita. Se registra fuente manual, dispositivo o mapa, junto con actor y fecha. Una cuenta puede existir sin contactos y puede relacionarse con cero o mas frutas del catalogo.

## 4.2 Contacto comercial

Una cuenta admite multiples contactos. Cuando existe al menos uno debe haber exactamente un contacto principal. Cada contacto exige nombre y al menos telefono o correo. Cargo y notas son opcionales.

## 4.3 Visita

Es una cita o actividad con una cuenta. El Supervisor solo crea visitas para si mismo; el Manager puede asignarlas a cualquier usuario activo. Los estados persistidos son `PENDING`, `COMPLETED` y `CANCELLED`.

Reprogramar mantiene la visita en `PENDING`, registra historial, exige motivo e invalida los recordatorios anteriores. Completar exige observacion, fecha/hora efectiva y usuario que cierra. Las demas conclusiones son opcionales.

## 4.4 Tarea

Pertenece siempre a una cuenta y puede vincularse opcionalmente a una visita de esa misma cuenta. Requiere titulo, responsable y fecha de vencimiento; la hora es opcional. Estados: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. `OVERDUE` se deriva cuando la fecha vencio y el estado sigue abierto.

## 4.5 Documento

Todo documento pertenece a una cuenta. Puede vincularse adicionalmente a una visita o a una tarea, pero no a ambas; el contexto debe pertenecer a la misma cuenta. Formatos: PDF, DOCX y XLSX, maximo 10 MB. La carga requiere conexion y el archivo no se guarda en la cola offline.

## 4.6 Tiempo y localizacion

La interfaz del MVP usa `es-EC`, reloj de 24 horas y la zona fija `America/Guayaquil`. Los instantes se almacenan en UTC/TIMESTAMPTZ. Los usuarios no configuran zona; una cuenta internacional puede tener zona IANA opcional.

# 5. Requisitos funcionales

## 5.1 Autenticacion y sesiones

- **RF-AUT-001:** iniciar sesion con username y contrasena; el primer acceso siempre requiere internet.
- **RF-AUT-002:** emitir access token de 15 minutos y sesion renovable de hasta 7 dias.
- **RF-AUT-003:** listar y revocar sesiones por dispositivo.
- **RF-AUT-004:** cerrar sesion debe revocar la sesion y purgar IndexedDB, Cache Storage y credenciales locales.
- **RF-AUT-005:** despues de intentos repetidos se aplica espera progresiva y registro de seguridad.
- **RF-AUT-006:** el Manager restablece al Supervisor con contrasena temporal y cambio obligatorio; la recuperacion del Manager se realiza por administrador autorizado del VPS/CLI y queda auditada.
- **RF-AUT-007:** para reabrir offline se usa PIN local de seis digitos, maximo 72 horas desde la ultima validacion online; cinco fallos eliminan la cache local.

## 5.2 Usuarios

- **RF-USR-001:** el Manager crea, edita, desactiva y consulta usuarios.
- **RF-USR-002:** username unico sin distinguir mayusculas; nombre completo, rol y estado obligatorios.
- **RF-USR-003:** los usuarios se desactivan; no se eliminan fisicamente.
- **RF-USR-004:** una desactivacion revoca sesiones, bloquea nuevas asignaciones y conserva historial.

## 5.3 Cuentas, contactos y notas

- **RF-CTA-001:** crear, consultar, buscar, filtrar, editar, asignar y archivar cuentas segun permisos.
- **RF-CTA-002:** validar al menos telefono o correo y pais/ciudad obligatorios.
- **RF-CTA-003:** gestionar multiples contactos y un principal cuando existan contactos.
- **RF-CTA-004:** asignar cero o mas frutas activas del catalogo.
- **RF-CTA-005:** capturar GPS solo tras consentimiento/accion explicita y mostrarlo en mapa.
- **RF-CTA-006:** mantener notas internas con autor y fecha, visibles solo para personal autorizado.
- **RF-CTA-007:** mostrar linea de tiempo de visitas, tareas, documentos y cambios relevantes.

## 5.4 Agenda y visitas

- **RF-VIS-001:** consultar agenda por dia, semana, mes o lista, responsable, estado y rango.
- **RF-VIS-002:** crear visita con cuenta, responsable, fecha/hora, zona, motivo, prioridad y notas.
- **RF-VIS-003:** reprogramar con motivo obligatorio e historial inmutable.
- **RF-VIS-004:** cancelar con motivo obligatorio y cancelacion de recordatorios pendientes.
- **RF-VIS-005:** completar con observacion obligatoria, tiempo efectivo y actor.
- **RF-VIS-006:** crear tareas de seguimiento durante o despues del cierre.
- **RF-VIS-007:** crear, editar, reprogramar, cancelar y completar visitas offline cuando el permiso cacheado siga vigente.

## 5.5 Tareas

- **RF-TAR-001:** crear, consultar, filtrar, editar, completar y cancelar tareas.
- **RF-TAR-002:** requerir fecha de vencimiento, responsable y cuenta.
- **RF-TAR-003:** agrupar visualmente vencidas, de hoy y proximas sin guardar `OVERDUE`.
- **RF-TAR-004:** el Supervisor solo se asigna a si mismo; el Manager asigna o reasigna.
- **RF-TAR-005:** permitir trabajo offline con idempotencia y versionado optimista.

## 5.6 Recordatorios y notificaciones

- **RF-NOT-001:** recordatorios de visita 1 dia y 1 hora antes.
- **RF-NOT-002:** recordatorios de tarea 1 dia antes y al vencimiento.
- **RF-NOT-003:** entregar notificacion interna y push PWA cuando exista suscripcion valida.
- **RF-NOT-004:** solicitar permiso push solo despues de explicar su utilidad.
- **RF-NOT-005:** editar, reprogramar, completar o cancelar el recurso invalida jobs anteriores dentro de la misma transaccion logica.
- **RF-NOT-006:** listar no leidas/todas, marcar una o todas como leidas y navegar al recurso.
- **RF-NOT-007:** paginar el centro de notificaciones en bloques de 15 y eliminar notificaciones con mas de 30 dias.

## 5.7 Documentos

- **RF-DOC-001:** cargar, listar, descargar, categorizar, archivar y restaurar documentos segun cuenta y permisos.
- **RF-DOC-002:** validar extension, MIME, firma, tamano y checksum; escanear antes de publicar.
- **RF-DOC-003:** mantener el archivo en cuarentena hasta resultado limpio.
- **RF-DOC-004:** servir descargas solo mediante API autorizada; nunca exponer una ruta del volumen.
- **RF-DOC-005:** papelera de 30 dias y eliminacion fisica posterior.
- **RF-DOC-006:** no cachear cuerpos de documentos para uso offline.

## 5.8 Catalogos y configuracion

- **RF-CAT-001:** el Manager administra frutas y categorias; elementos usados se desactivan, no se eliminan.
- **RF-CAT-002:** impedir duplicados normalizados sin distinguir mayusculas o acentos.
- **RF-CFG-001:** configurar ventana offline, recordatorios, permiso de reportes propios, limites e idioma/zona por defecto.
- **RF-CFG-002:** auditar cada cambio sensible de configuracion.

## 5.9 Importacion

- **RF-IMP-001:** el Manager importa cuentas, contactos y frutas relacionadas mediante plantilla XLSX/CSV.
- **RF-IMP-002:** mostrar vista previa, errores por fila, posibles duplicados y resumen antes de confirmar.
- **RF-IMP-003:** la confirmacion es idempotente y registra lote, usuario, totales y archivo de errores.
- **RF-IMP-004:** ninguna fila invalida debe guardarse silenciosamente.

## 5.10 Reportes y exportaciones

- **RF-REP-001:** agrupar reportes en Visitas, Tareas, Cuentas, Documentos y Resumen gerencial.
- **RF-REP-002:** aplicar filtros, propiedad, zona horaria y alcance del usuario.
- **RF-REP-003:** mostrar vista previa paginada antes de exportar.
- **RF-REP-004:** generar PDF y XLSX en worker, concurrencia PDF maxima 1.
- **RF-REP-005:** notificar al terminar y eliminar el archivo exportado tras 7 dias.

## 5.11 Auditoria

- **RF-AUD-001:** registrar actor, accion, entidad, identificador, valores cambiados seguros, IP, dispositivo, fecha y `request_id`.
- **RF-AUD-002:** impedir edicion desde la aplicacion y permitir consulta solo al Manager.
- **RF-AUD-003:** conservar auditoria funcional 5 anos y eventos de acceso/seguridad 1 ano.
- **RF-AUD-004:** no registrar contrasenas, tokens, PIN, contenido de documentos ni datos completos innecesarios.

## 5.12 PWA y sincronizacion

- **RF-SYN-001:** instalar la PWA y cachear el shell necesario para abrirla sin conexion.
- **RF-SYN-002:** Supervisor cachea cuentas asignadas activas, contactos, catalogos, visitas operativas y tareas abiertas; Manager cachea datos operativos activos, no toda la historia.
- **RF-SYN-003:** registrar cada mutacion con UUID, dispositivo, secuencia, `client_operation_id`, entidad, `base_version`, dependencias y fecha local.
- **RF-SYN-004:** sincronizar al reconectar, abrir, volver a primer plano, periodo permitido y al usar “Sincronizar ahora”.
- **RF-SYN-005:** reintentar una operacion no crea duplicados.
- **RF-SYN-006:** fusionar automaticamente campos distintos; un choque sobre el mismo campo o estado crea conflicto para Manager.
- **RF-SYN-007:** mostrar pendientes, fallos, conflictos, ultima sincronizacion y acciones de reintento.
- **RF-SYN-008:** cerrar sesion, vencer la autorizacion o exceder intentos del PIN purga datos locales.

# 6. Reportes aprobados

| Grupo | Variantes principales | Filtros y contenido minimo |
|---|---|---|
| Visitas | Agenda, realizadas, canceladas/reprogramadas, productividad | rango, responsable, cuenta, ciudad, estado, prioridad; fecha programada/real, resultado y proxima accion |
| Tareas | Abiertas, vencidas, completadas, carga por responsable | rango, responsable, cuenta, estado, prioridad; vencimiento, antiguedad y origen |
| Cuentas | Directorio, sin visita reciente, por fruta/ubicacion/responsable | estado, tipo, pais, ciudad, fruta, responsable; contacto principal, ultima/proxima visita |
| Documentos | Inventario, por categoria, proximos a revision | cuenta, categoria, fecha, autor; nombre, formato, tamano y contexto |
| Resumen gerencial | KPIs y actividad del periodo | visitas, cumplimiento, tareas, cuentas activas/sin seguimiento, actividad por Supervisor |

Los calculos y columnas exactas se versionan como plantillas de reporte. PDF y Excel deben representar el mismo conjunto de datos y filtros.

# 7. Requisitos no funcionales

- **RNF-SEG-001:** HTTPS obligatorio, HSTS, CSP, proteccion CSRF, rate limit, validacion Zod y consultas parametrizadas.
- **RNF-SEG-002:** contrasenas hasheadas con Argon2id; nunca cifradas reversiblemente.
- **RNF-SEG-003:** refresh tokens rotatorios como hash; cookie `HttpOnly`, `Secure`, `SameSite`; access token solo en memoria.
- **RNF-SEG-004:** autorizacion verificada en backend por rol y propiedad para cada endpoint.
- **RNF-PER-001:** p95 menor a 400 ms en CRUD comun con datos de prueba; reportes y escaneo quedan en background.
- **RNF-PER-002:** shell operativo usable en menos de 3 segundos sobre perfil movil de prueba despues de la primera instalacion.
- **RNF-PER-003:** sincronizar 100 operaciones estructuradas en menos de 30 segundos con red estable de prueba.
- **RNF-DIS-001:** objetivo mensual 99.5 %, excluyendo mantenimiento anunciado; VPS unico sin alta disponibilidad.
- **RNF-REC-001:** RPO aproximado 24 h y RTO objetivo 4 h, sujetos a disponibilidad de Hostinger.
- **RNF-REC-002:** `pg_dump` diario, backup diario de Hostinger, snapshot manual previo a migraciones y restauracion trimestral.
- **RNF-ACC-001:** WCAG 2.2 AA en flujos criticos; teclado, foco visible, lectores de pantalla, contraste y objetivos tactiles.
- **RNF-COM-001:** ultimas dos versiones mayores de Chrome y Edge en escritorio, Chrome/PWA Android y Safari/PWA iPhone; ancho minimo 360 px.
- **RNF-LOC-001:** UTC en persistencia y zonas IANA para presentacion.
- **RNF-OBS-001:** logs JSON con `request_id`, health/readiness, rotacion y monitor externo.
- **RNF-MAN-001:** TypeScript estricto, arquitectura modular, migraciones versionadas, OpenAPI y pruebas automatizadas.
- **RNF-PRI-001:** sin analitica publicitaria ni rastreo de terceros; telemetria limitada a operacion y seguridad.

# 8. Politicas de ciclo de vida

- Usuarios: desactivacion permanente con historial conservado.
- Cuentas y contactos con actividad: archivo reversible, sin borrado fisico ordinario.
- Registros erroneos sin dependencias: papelera 30 dias y posterior purga por Manager.
- Documentos: papelera 30 dias y eliminacion fisica.
- Exportaciones: 7 dias.
- Jobs: 90 dias para trazas funcionales; limpieza periodica de pg-boss segun politica.
- Logs tecnicos: rotacion por tamano y conservacion aproximada de 30 dias.
- Notificaciones internas: 30 dias.

# 9. Criterios de aceptacion del MVP

1. Manager y Supervisor completan sus flujos sin acceder a datos ajenos.
2. Cuenta, visita, cierre y tarea funcionan online y offline con datos estructurados.
3. Reintentos de sync no duplican; conflictos nunca sobreescriben silenciosamente.
4. Logout y bloqueo local eliminan los datos cacheados.
5. Documentos falsos, infectados, fuera de formato o de otra cuenta se rechazan.
6. Recordatorios se reprograman o cancelan coherentemente.
7. Fechas se muestran correctamente en Ecuador y una zona con cambio estacional.
8. Reportes respetan filtros, permisos y zona; PDF y Excel coinciden.
9. Importacion informa cada error y no produce duplicados al repetirse.
10. CI, E2E, permisos, offline, accesibilidad y smoke de produccion estan aprobados.
11. Backup y restauracion se ejecutaron en staging; rollback de aplicacion fue probado.
12. DNS, VPS, repositorio, secretos y responsabilidades tienen propietarios documentados.

# 10. Trazabilidad de alto nivel

| Flujo | Pantallas | API principal | Datos | Pruebas obligatorias |
|---|---|---|---|---|
| Login y sesion | Login, Perfil/Sesiones | `/auth/*` | users, user_sessions, devices | rate limit, revocacion, logout/purga |
| Cuenta y contacto | Lista, Formulario, Detalle, Contactos | `/commercial-accounts/*` | accounts, contacts, fruits, notes | propiedad, validacion, reasignacion |
| Visita | Agenda, Formulario, Detalle, Cierre | `/visits/*` | visits, reschedules, reminders | estados, fechas, offline, recordatorios |
| Tarea | Lista, Formulario | `/tasks/*` | tasks, reminders | vencida derivada, permisos, sync |
| Documento | Pestana documentos | `/documents/*` | documents, categories | MIME/firma/scan, descarga autorizada |
| Reporte | Catalogo, filtros, exportaciones | `/reports/*` | report_exports, pg-boss | filtros, permisos, PDF/XLSX |
| Sincronizacion | Banner, Centro, Conflicto | `/sync/*` | sync_operations, change_log, conflicts | idempotencia, concurrencia, reinicio |

# 11. Definition of Done

Una historia esta terminada cuando el requisito y regla asociados estan implementados en UI, API y base de datos; tiene validacion y permisos de backend; estados loading/vacio/error/offline; auditoria cuando corresponde; pruebas unitarias/integracion/E2E; documentacion OpenAPI; migracion reversible o compatible; y pasa CI.

El MVP esta terminado cuando todos los criterios de la seccion 9 tienen evidencia, el piloto de una semana termina sin defectos bloqueantes y Manager/Supervisor firman aceptacion o una lista de correcciones fechada.

# 12. Registro consolidado de decisiones

Las decisiones D-01 a D-66 corresponden a las respuestas aprobadas durante la revision. Los defaults D-67 a D-80 fueron cerrados automaticamente bajo la autorizacion final.

| ID | Decision final |
|---|---|
| D-01 a D-09 | Responsable unico; acceso por asignacion; multiples contactos; telefono o correo; cuenta sin contactos; identidad/tipos; ubicacion; GPS explicito; frutas opcionales |
| D-10 a D-15 | Asignacion de visitas/tareas por rol; reprogramacion como historial; vencida derivada; cierre con observacion; recordatorios internos y push |
| D-16 a D-21 | Offline solo datos estructurados; autorizacion 72 h; cache minima por rol; conflictos por campo; sync automatica/manual; documentos solo online |
| D-22 a D-30 | `app.vicamproduce.com`; Docker Compose; backup Hostinger; recuperacion administrativa; sin MFA; PDF/DOCX/XLSX 10 MB; sesion 7 dias; contrasena minima aprobada; volumen privado sin imagenes |
| D-31 a D-39 | Exportaciones background; 5 grupos de reportes; dashboard accionable; navegacion responsive; formulario cuenta 3 pasos movil; agenda dia/semana/mes; Inter; azul `#0075DE`; accion contextual |
| D-40 a D-48 | MapLibre; sin correo; backup Hostinger diario; navegadores objetivo; dev/staging/prod; piloto; monorepo pnpm; Drizzle+migraciones; pg-boss sin Redis |
| D-49 a D-57 | Node 24/Express 5/PostgreSQL 18; Caddy; Workbox+Dexie; REST/Zod/OpenAPI; tokens seguros; PIN offline; testing completo; GitHub CI/GHCR; despliegue controlado |
| D-58 a D-66 | React/Vite; Tailwind/Radix/Lucide; Query/RHF/Zod/Zustand/Dexie; observabilidad; retenciones; eliminacion; documentos centrados en cuenta; importador; `es-EC` y UTC |
| D-67 | Argon2id para contrasenas, con parametros medidos en el VPS y rehash progresivo |
| D-68 | ClamAV en contenedor; cuarentena y firma limpia antes de publicar documentos |
| D-69 | MapLibre GL JS con MapTiler como proveedor inicial; clave restringida y reemplazable por ambiente |
| D-70 | Busqueda PostgreSQL con `unaccent` y `pg_trgm`; no Elasticsearch en el MVP |
| D-71 | Permisos en capa de aplicacion/repositorio con pruebas; RLS queda como defensa futura |
| D-72 | Paginacion por pagina/limite para listados y cursor monotono para sync/change log |
| D-73 | Web Push con VAPID; notificacion interna siempre como fallback |
| D-74 | Objetivo de disponibilidad 99.5 % y monitoreo externo del endpoint de salud |
| D-75 | Accesibilidad WCAG 2.2 AA en flujos criticos |
| D-76 | Capacidad de diseno inicial: 50 usuarios registrados, 20 concurrentes, 100 000 cuentas y 20 GB de documentos; validar con carga |
| D-77 | Sin analitica de marketing; solo logs, metricas operativas y auditoria |
| D-78 | Versionado semantico, changelog y releases etiquetadas; imagenes por SHA |
| D-79 | Datos de staging ficticios o anonimizados; prohibido copiar produccion sin saneamiento |
| D-80 | Piloto de una semana con proceso anterior disponible y decision formal de salida |

# 13. Referencias tecnicas

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- ClamAV en Docker: https://docs.clamav.net/manual/Installing/Docker.html
- MapLibre con MapTiler: https://docs.maptiler.com/maplibre/
- PostgreSQL `pg_trgm`: https://www.postgresql.org/docs/current/pgtrgm.html
- PostgreSQL `unaccent`: https://www.postgresql.org/docs/current/unaccent.html
- Backups de VPS Hostinger: https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps-at-hostinger/
