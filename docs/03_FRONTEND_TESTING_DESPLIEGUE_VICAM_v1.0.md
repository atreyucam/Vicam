% VICAM - Frontend, UX/UI, Testing y Puesta en Produccion
% Version 1.0 final | 21 de julio de 2026
% Especificacion por pantalla lista para diseno y programacion

> **Objetivo:** convertir los requisitos en rutas, pantallas, componentes, estados, pruebas y criterios de salida. La interfaz adopta minimalismo calido inspirado en Notion, pero optimizado para trabajo operativo y sin imagenes decorativas ni carga de fotos.

[[PAGEBREAK]]

# 1. Principios de experiencia

1. La accion siguiente debe ser evidente: agendar, completar, crear tarea o sincronizar.
2. Offline nunca es invisible: banner, indicador, pendientes y conflictos accesibles.
3. La seguridad no depende de ocultar botones; el backend vuelve a validar todo.
4. Escritorio privilegia tablas y paneles; movil privilegia listas, pasos cortos y barras fijas.
5. No usar calendarios mensuales comprimidos como vista principal movil.
6. No solicitar GPS o push al iniciar; explicar valor justo antes de usarlos.
7. No hay imagenes, fotos, avatares fotograficos ni ilustraciones pesadas. Los documentos se representan por icono y metadata.
8. Cada lista y formulario incluye loading, vacio, error, permiso, offline y datos obsoletos.

# 2. Sistema visual VICAM

## 2.1 Tokens

| Rol | Valor |
|---|---|
| Primario | `#0075DE` |
| Hover primario | `#005BAB` |
| Foco | `#097FE8` con ring 2 px y separacion 2 px |
| Superficie azul suave | `#F2F9FF` |
| Fondo | `#FFFFFF` |
| Fondo alterno | `#F6F5F4` |
| Texto principal | `rgba(0,0,0,.95)` |
| Texto secundario | `#615D59` |
| Borde | `rgba(0,0,0,.10)` |
| Exito | verde accesible; fondo verde suave |
| Advertencia | naranja accesible; fondo naranja suave |
| Error | rojo accesible; fondo rojo suave |

Fuente: Inter con fallback del sistema. Tamanos: titulo de pagina 28 px, seccion 20 px, tarjeta 16 px, cuerpo 15-16 px, metadata 13-14 px y badges 12 px. No se usa serif ni la fuente privada NotionInter.

Espaciado base 8 px; controles 40 px desktop y minimo 44 px tactil; radios 4 px en inputs/botones, 8-12 px en tarjetas y pill para estados. Sombras muy suaves solo para dialogs, drawers y paneles elevados.

## 2.2 Accesibilidad

- Contraste WCAG 2.2 AA; no comunicar estado solo con color.
- Foco visible, orden DOM logico, skip link y labels persistentes.
- Dialog/Drawer/BottomSheet con focus trap, Escape y retorno de foco.
- Errores vinculados con `aria-describedby`; resumen al enviar formularios invalidos.
- Tablas con encabezados; en movil se transforman en tarjetas semanticas.
- Anuncios `aria-live` para sync, guardado y jobs, sin interrumpir innecesariamente.

# 3. Navegacion y rutas

## 3.1 Desktop

Sidebar fija: Inicio, Agenda, Cuentas, Tareas, Documentos, Reportes, Notificaciones. Para Manager: Usuarios, Catalogos, Auditoria y Configuracion. Pie: estado sync, perfil y version.

## 3.2 Movil

Bottom nav: **Inicio | Agenda | Cuentas | Tareas | Mas**. “Mas” contiene Documentos, Reportes, Notificaciones, Sync, Perfil y modulos Manager. La accion primaria es contextual; no existe un boton flotante global.

## 3.3 Mapa de rutas

```text
/login
/app
/app/agenda
/app/accounts                  /app/accounts/new
/app/accounts/:id             /app/accounts/:id/edit
/app/accounts/:id/contacts
/app/visits/new               /app/visits/:id
/app/visits/:id/complete
/app/tasks                    /app/tasks/new
/app/documents
/app/notifications
/app/sync                    /app/sync/conflicts/:id
/app/reports                 /app/reports/exports
/app/users                   /app/catalogs/fruits
/app/catalogs/document-categories
/app/imports                 /app/audit
/app/settings                /app/profile
```

# 4. Componentes antes de pantallas

| Grupo | Componentes |
|---|---|
| Shell | `AppShell`, `Sidebar`, `MobileNav`, `TopBar`, `PageHeader`, `Breadcrumbs` |
| Acciones | `Button`, `IconButton`, `SplitButton`, `ActionMenu`, `ConfirmDialog` |
| Formularios | `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `PhoneInput`, `DateTimeTimezonePicker`, `FormSection`, `FieldError` |
| Datos | `DataTable`, `MobileEntityCard`, `FilterBar`, `FilterSheet`, `Pagination`, `StatusBadge`, `PriorityBadge`, `StatCard` |
| Superficies | `Tabs`, `Drawer`, `Dialog`, `BottomSheet`, `Toast`, `StickyActionBar` |
| Dominio | `AccountPicker`, `ContactCard`, `VisitCard`, `TaskCard`, `Timeline`, `DocumentRow`, `MapField` |
| Offline | `OfflineBanner`, `SyncIndicator`, `PendingOperation`, `ConflictCard`, `StaleDataNotice` |
| Estados | `Skeleton`, `EmptyState`, `ErrorState`, `PermissionState`, `UnsavedChangesGuard` |

Cada componente define normal, hover, focus, active, disabled, loading, error y offline cuando corresponda. Los tokens viven como CSS variables y se exponen a Tailwind.

# 5. Especificacion por pantalla

## 5.1 Login - `/login`

**Objetivo:** entrada segura y clara. **Contenido:** marca VICAM tipografica, username, contrasena, mostrar/ocultar, iniciar sesion, version y aviso “el primer acceso requiere conexion”. No hay enlace de correo para recuperar.

Desktop usa tarjeta centrada de 400-440 px; movil una columna con padding 20 px y boton ancho completo. Estados: credenciales invalidas sin revelar usuario, espera progresiva, usuario inactivo, sin red, sesion expirada y cambio obligatorio de contrasena.

## 5.2 Inicio Manager - `/app`

Cuatro KPIs: visitas hoy, tareas vencidas, cuentas sin visita reciente y conflictos/pendientes de sync. Debajo: agenda inmediata, actividad por Supervisor y accesos “Nueva cuenta”, “Agendar visita”, “Importar”.

Desktop: KPIs en fila o 2x2, agenda principal y panel lateral. Movil: 2x2, siguiente accion y lista cronologica; no mostrar graficos sin accion asociada.

## 5.3 Inicio Supervisor - `/app`

Primero proxima visita con CTA “Ver/Completar”, despues agenda del dia, tareas vencidas/proximas, estado sync y accesos rapidos. Si esta offline, las cifras indican “datos hasta [hora]”.

## 5.4 Cuentas - `/app/accounts`

Busqueda tolerante a acentos y filtros por estado, tipo, pais, ciudad, fruta, responsable y ultima visita. Columnas desktop: nombre, ciudad, contacto principal, frutas, responsable, ultima/proxima visita y estado. Acciones por fila segun rol.

Movil: tarjetas con nombre, ciudad, contacto, ultima visita y badge; filtros en bottom sheet con contador. Vacio diferencia “sin cuentas” de “sin resultados”. Offline limita a cache autorizada y lo declara.

## 5.5 Nueva/editar cuenta - `/app/accounts/new|:id/edit`

Desktop en secciones de dos columnas: Identidad, Comunicacion, Ubicacion, Contactos, Clasificacion, Observaciones. Movil usa tres pasos: **Identidad**, **Ubicacion y contactos**, **Clasificacion y revision**. Barra fija Guardar/Cancelar.

Validar `displayName`, tipo, pais, ciudad y telefono o correo. GPS es boton “Usar mi ubicacion” con explicacion; nunca automatico. El borrador se guarda localmente. Una edicion offline muestra version base y estado pendiente.

## 5.6 Detalle de cuenta - `/app/accounts/:id`

Cabecera: nombre, tipo, estado, responsable, ciudad, sincronizacion y acciones. CTA principal “Agendar visita”. Tabs: Resumen, Contactos, Visitas, Tareas, Documentos y Actividad.

Resumen muestra datos clave, contacto principal, frutas, proxima visita, tareas abiertas, mapa y notas recientes. Movil usa tabs horizontales y menu de acciones. Al perder asignacion, la pantalla se cierra y purga el contenido local.

## 5.7 Contactos - tab o `/contacts`

Lista con principal destacado, cargo y canales disponibles. Crear/editar en drawer desktop y pantalla completa movil. Cambiar principal es una operacion atomica. Si se elimina/archiva el principal, se exige seleccionar otro cuando queden contactos.

## 5.8 Agenda - `/app/agenda`

Desktop: switch semana/mes/lista, filtros y panel lateral de detalle. Movil: dia/mes/lista con tira semanal fija. La vista mensual muestra el mes completo y permite navegar entre meses. Tarjetas muestran hora local, cuenta, ciudad, responsable, estado y prioridad.

Offline permite abrir las visitas cacheadas y ejecutar acciones autorizadas; aparece banner persistente. Un cambio de zona muestra explicitamente hora del usuario y, si aplica, de la cuenta.

## 5.9 Nueva visita - `/app/visits/new`

Campos: cuenta, responsable, fecha/hora, zona, motivo, prioridad, recordatorios y notas. Supervisor queda preseleccionado y bloqueado; Manager elige usuario activo. Resumen previo muestra fecha completa y recordatorios.

Movil una columna y barra fija. Puede guardarse offline si la cuenta esta en cache y el grant sigue vigente.

## 5.10 Detalle de visita - `/app/visits/:id`

Estado, cuenta, fecha/zona, responsable, motivo, notas, GPS/mapa, tareas vinculadas, documentos y linea de tiempo. CTA contextual: Completar, Reprogramar o Cancelar. Acciones destructivas requieren confirmacion y motivo.

## 5.11 Completar visita - `/app/visits/:id/complete`

Observacion obligatoria; inicio/fin real autocompletado pero ajustable; contacto/persona, temas, acuerdos, problemas, proximos pasos y GPS opcionales. Permite crear tareas en el mismo flujo. No ofrece fotos ni carga de documentos offline.

Movil prioriza captura rapida con barra “Guardar visita”. Si queda pendiente de sync, el detalle muestra badge y no permite una segunda finalizacion contradictoria.

## 5.12 Reprogramar visita

Dialog desktop o pantalla completa movil. Presenta fecha actual, nueva fecha/zona, motivo obligatorio y recordatorios resultantes. Antes de confirmar se muestran ambas horas. El resultado sigue `PENDING` y el historial agrega evento.

## 5.13 Cancelar visita

Confirmacion con cuenta/fecha, motivo obligatorio y aviso de recordatorios cancelados. No depender solo de rojo. Offline crea operacion pendiente y bloquea acciones incompatibles hasta resolver.

## 5.14 Tareas - `/app/tasks`

Manager: tabs “Mis tareas” y “Todas”; Supervisor: “Mis tareas”. Agrupar Hoy, Vencidas, Proximas y Sin hora. Filtros por responsable, cuenta, visita, estado, prioridad y rango. Desktop tabla/lista; movil tarjetas con boton visible Completar.

Kanban no es parte del MVP inicial; puede anadirse si el piloto demuestra valor.

## 5.15 Crear/editar tarea - `/app/tasks/new`

Formulario corto: cuenta, visita opcional filtrada por cuenta, titulo, descripcion, responsable, vencimiento, prioridad y recordatorios. Fecha requerida, hora opcional y zona visible. Supervisor no cambia responsable.

## 5.16 Documentos - `/app/documents` y tab de cuenta

Catalogo por cuenta, categoria, fecha, formato y autor. Fila/tarjeta: icono de formato, titulo, categoria, tamano, contexto, estado de escaneo y acciones. Carga solo online con PDF/DOCX/XLSX maximo 10 MB.

El uploader explica validacion y cuarentena; muestra `Analizando`, `Disponible` o `Rechazado`. Nunca previsualiza contenido potencialmente inseguro en la pagina. Papelera y restauracion solo segun permiso.

## 5.17 Notificaciones - `/app/notifications`

Tabs No leidas/Todas, agrupadas por fecha y paginadas de 15 en 15. Cada item enlaza al recurso; acciones marcar leida y marcar todas. El prompt push se muestra desde una tarjeta educativa, no al cargar la app. Las notificaciones se eliminan automaticamente al cumplir 30 dias.

## 5.18 Centro de sincronizacion - `/app/sync`

Estado de conexion, ultima sync, version local, vigencia offline, pendientes, fallidas, conflictos y almacenamiento usado. Cada operacion muestra entidad, hora, intentos y accion. “Sincronizar ahora” siempre visible si hay red.

Supervisor puede reintentar o descartar solo borradores no aceptados sin dependencias; conflictos requieren Manager. La interfaz no muestra payloads tecnicos sensibles.

## 5.19 Resolver conflicto - `/app/sync/conflicts/:id`

Manager compara Base, Servidor y Dispositivo. Desktop: columnas por campo; movil: tarjetas apiladas. Puede elegir por campo cuando es seguro o una version completa; ve impacto y actor. Confirmar crea nueva version, auditoria y notificacion al usuario afectado.

## 5.20 Reportes - `/app/reports`

Cinco grupos con tarjetas descriptivas. Flujo: seleccionar plantilla -> filtros -> vista previa -> exportar PDF/XLSX -> seguimiento del job. Manager ve alcance global; Supervisor solo propio si habilitado.

La vista previa muestra zona, periodo, filtros y columnas. Exportaciones tiene estados queued/processing/ready/failed/expired y fecha de expiracion.

## 5.21 Importaciones - `/app/imports`

Solo Manager. Paso 1 descargar plantilla; 2 cargar XLSX/CSV; 3 mapear/validar; 4 revisar errores y duplicados; 5 confirmar; 6 resultado. Las filas se clasifican Crear, Actualizar, Omitir o Error. Repetir confirmacion no duplica.

## 5.22 Usuarios - `/app/users`

Tabla/tarjetas con nombre, username, rol, estado, ultimo acceso y sesiones. Crear/editar, reset temporal, revocar sesiones y desactivar. Antes de desactivar se muestra cuentas/visitas/tareas asignadas y se exige reasignacion cuando corresponda.

## 5.23 Catalogos - `/app/catalogs/*`

Frutas y categorias comparten patron: lista, busqueda, estado, uso y formulario. No se elimina un elemento usado; se desactiva. Duplicados normalizados muestran conflicto claro.

## 5.24 Auditoria - `/app/audit`

Solo Manager. Filtros fecha, usuario, modulo, accion, entidad y request ID. Desktop tabla con panel de detalle; movil lista resumida y pantalla detalle. Antes/despues ocultan secretos y campos sensibles.

## 5.25 Configuracion - `/app/settings`

Secciones: recordatorios, ventana offline, reportes Supervisor, limites de documentos, zona por defecto y retenciones no legales. Cambios sensibles muestran resumen y quedan auditados. No permitir claves arbitrarias; formulario basado en schema.

## 5.26 Perfil y sesiones - `/app/profile`

Nombre, preferencias de notificacion, sesiones/dispositivos, cambio de contrasena, PIN local y cerrar sesion. Al cerrar se confirma que los datos offline seran eliminados. Revocar el dispositivo actual ejecuta el mismo purge.

## 5.27 Estados globales

- 403: explicar falta de permiso sin filtrar metadata.
- 404: recurso no disponible y retorno seguro.
- 409: version/conflicto con accion al centro de sync.
- 422: errores por campo y resumen.
- 429: tiempo de espera; no reintento agresivo.
- 500: request ID, reintentar y soporte; sin stack trace.
- Actualizacion PWA: banner “Nueva version lista”, aplicar cuando no haya sync activa.

# 6. Arquitectura frontend

```text
src/
  app/             router, providers, shell
  routes/          composicion por ruta
  features/        accounts, visits, tasks, sync...
  entities/        modelos de presentacion
  components/      UI transversal
  offline/         Dexie, crypto, queue, pull/push
  api/             cliente generado y query keys
  styles/          tokens y Tailwind
  test/            fixtures y helpers
```

TanStack Query controla servidor, invalidacion y cache online; Dexie controla datos autorizados offline; no se duplican responsabilidades. Zustand solo guarda estado efimero como filtros UI y banners. React Hook Form usa schemas compartidos Zod. Rutas cargan por feature y boundaries de error.

# 7. Estrategia de pruebas

## 7.1 Niveles

| Nivel | Herramienta | Alcance |
|---|---|---|
| Estatico | TypeScript, ESLint, Prettier, secret/dependency scan | contratos, estilo, secretos y supply chain |
| Unitario | Vitest | reglas, fechas, permisos, estados, merge y reportes |
| Componentes | React Testing Library + axe | formularios, foco, accesibilidad y estados |
| DB | Testcontainers PostgreSQL 18 | constraints, indices, migraciones, versionado y concurrencia |
| API | Supertest | auth, RBAC/ownership, errores, uploads, idempotencia |
| E2E | Playwright | flujos Manager/Supervisor, responsive y navegadores |
| PWA | Playwright + dispositivos reales | SW, IndexedDB, offline, update y sync |
| Carga | k6 | CRUD, busqueda, sync y jobs |
| Recuperacion | runbooks en staging | dump/restore, rollout y rollback |

Objetivo: 100 % de reglas criticas de permisos, sincronizacion y estados; al menos 80 % de servicios de dominio como guia, sin perseguir una cifra global que incentive pruebas sin valor.

## 7.2 Casos criticos

1. Supervisor no lee ni modifica una cuenta ajena cambiando URL o ID de API.
2. Reasignar cuenta cambia acceso y purga cache al siguiente pull.
3. `clientOperationId` repetido produce un solo efecto.
4. Dos updates con `baseVersion` igual: uno gana; el otro se fusiona o crea 409.
5. Reiniciar durante sync no duplica ni pierde operaciones dependientes.
6. Visita offline cerrada y tarea creada conservan relaciones al reconectar.
7. Documento nunca entra en cola offline y solo se descarga con permiso vigente.
8. Extension falsa, MIME/firma invalida, malware o >10 MB se rechaza.
9. Reprogramar/cancelar elimina recordatorios previos y genera los nuevos correctos.
10. Fechas funcionan en `America/Guayaquil` y una zona de EE. UU. con DST.
11. Logout, expiracion de 72 h y cinco PIN fallidos purgan datos.
12. Exportacion respeta alcance, filtros y coincide PDF/XLSX.
13. Importacion repetida es idempotente y conserva errores por fila.
14. Migracion nueva inicia desde base vacia y actualiza una version anterior en staging.
15. Backup restaura DB y documentos coherentes; archivo borrado fisico no reaparece sin politica.

## 7.3 Matriz de navegadores/dispositivos

- Chrome y Edge escritorio: ultimas dos versiones mayores.
- Chrome Android/PWA: ultima y anterior en al menos un telefono real objetivo.
- Safari iPhone/PWA: ultima y anterior cuando el hardware disponible lo permita.
- Viewports: 360x800, 390x844, 768x1024, 1366x768 y 1440x900.
- Teclado completo y lector de pantalla en login, cuenta, visita, tarea y sync.

## 7.4 Objetivos de carga

Dataset sintetico: 100 000 cuentas, 1 000 000 de actividades, 50 usuarios y 20 concurrentes. Puertas iniciales: CRUD p95 <400 ms; busqueda p95 <700 ms; 100 operaciones sync <30 s; tasa de error <1 % excluyendo validaciones; memoria sin crecimiento sostenido.

# 8. CI/CD y puertas

## 8.1 Pull request

1. instalacion `pnpm --frozen-lockfile`;
2. formato, lint y typecheck;
3. unitarias/componentes y accesibilidad automatizada;
4. Testcontainers y Supertest;
5. build web/api/worker;
6. validacion OpenAPI y migraciones;
7. escaneo de dependencias, secretos e imagen;
8. E2E smoke en entorno efimero.

No se fusiona con pruebas rojas, `only`, cambios de migracion sin revision o contratos incompatibles no versionados.

## 8.2 Staging

Despliegue automatico o aprobado despues de `main`; datos ficticios. Ejecutar E2E completo, offline, importacion, reportes, ClamAV, Lighthouse/PWA y restauracion programada. Staging usa las mismas imagenes que produccion.

## 8.3 Produccion

Release etiquetada y aprobacion manual. Checklist: backup reciente, espacio >20 %, worker/cola saludable, migracion revisada, imagen anterior disponible, responsables presentes y ventana comunicada. Despues: health, login, cuenta de smoke, agenda, documento controlado, job de reporte y monitor externo.

# 9. Plan de implementacion

## Fase 0 - cimientos

Monorepo, CI, Docker local, contratos, Drizzle, auth base, shell responsive, tokens, componentes, ADR y datos seed.

## Fase 1 - flujo vertical online

Usuarios/permisos -> cuenta/contacto -> visita/cierre -> tarea -> auditoria. E2E completo antes de ampliar.

## Fase 2 - PWA y offline

Manifest, Workbox, Dexie, grant/PIN, cola, push/pull, conflictos y centro sync. Se considera parte del MVP, no mejora posterior.

## Fase 3 - operacion completa

Dashboard, push, documentos/ClamAV, importador, reportes, catalogos, mapa, observabilidad y hardening.

## Fase 4 - validacion

Carga, dispositivos reales, accesibilidad, seguridad, restore/rollback, manuales, capacitacion y piloto de una semana.

# 10. Piloto y aceptacion

Participan al menos un Manager y un Supervisor con el proceso anterior disponible. Durante una semana se observan errores, tiempos de formulario, uso offline, recordatorios, reportes y dudas. Cada hallazgo tiene severidad, responsable y fecha.

Salida permitida cuando no hay defectos bloqueantes/criticos; permisos y datos son correctos; sync no pierde ni duplica; restore fue probado; usuarios completan los escenarios; y se firma aceptacion o lista de correcciones no bloqueantes.

# 11. Entregables de programacion

- Repositorio y README de desarrollo.
- ADR, OpenAPI 3.1, ERD y diccionario de datos.
- Tokens/componentes Storybook o catalogo equivalente.
- Rutas y pantallas aqui definidas con estados responsive/offline.
- Migraciones y seeds.
- Suite automatizada y reporte de pruebas.
- Compose dev/staging/prod, Caddyfile y variables documentadas sin secretos.
- Runbooks de deploy, rollback, backup/restore, incidente y alta/baja de usuario.
- Manual corto Manager/Supervisor e instalacion PWA.
- Changelog, inventario de responsables y evidencia del piloto.

# 12. Resultado final verificable

Al finalizar, `app.vicamproduce.com` entrega una PWA instalable, rapida y coherente; la API y PostgreSQL permanecen privados; Manager y Supervisor ven solo lo autorizado; el ciclo comercial funciona con conectividad intermitente; documentos estan protegidos; reportes e importaciones se procesan en background; y cada release puede probarse, desplegarse, observarse y recuperarse mediante procedimientos repetibles.

# 13. Referencias oficiales

- React: https://react.dev/
- Tailwind con Vite: https://tailwindcss.com/docs
- Workbox: https://developer.chrome.com/docs/workbox
- Dexie: https://dexie.org/docs
- Vitest: https://vitest.dev/guide/
- Playwright Service Workers: https://playwright.dev/docs/service-workers
- Testcontainers PostgreSQL: https://node.testcontainers.org/modules/postgresql/
- GitHub Actions y Docker: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
