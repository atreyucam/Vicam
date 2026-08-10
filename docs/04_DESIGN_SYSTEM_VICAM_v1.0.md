# VICAM — Sistema de diseño

Versión 1.0 final  
Fecha: 21 de julio de 2026  
Estado: aprobado y obligatorio para el MVP

## 1. Propósito

Este documento es la fuente canónica de las decisiones visuales de VICAM. La
interfaz toma del estilo Notion el minimalismo cálido, la claridad y las
superficies suaves, pero adopta identidad propia para una aplicación comercial
operativa, responsive y PWA.

Si una maqueta, componente o sugerencia contradice este documento, prevalece
este documento. Las reglas funcionales por pantalla se encuentran en
`03_FRONTEND_TESTING_DESPLIEGUE_VICAM_v1.0.md`.

## 2. Principios

1. La siguiente acción debe resultar evidente.
2. La densidad se adapta al dispositivo: tablas y paneles en escritorio;
   tarjetas, listas y pasos cortos en móvil.
3. Offline, sincronización, datos obsoletos y conflictos nunca son invisibles.
4. El color complementa el texto; nunca comunica por sí solo.
5. Los componentes se reutilizan desde `packages/ui`; no se copian estilos en
   cada feature.
6. No se utilizan fotografías, imágenes decorativas, avatares fotográficos,
   carga de imágenes por usuarios ni fondos pesados. Se permiten únicamente los
   recursos técnicos de identidad necesarios para la aplicación (favicon,
   logotipo tipográfico, iconos PWA, maskable y apple-touch-icon), la iconografía
   Lucide y los recursos técnicos del mapa. Los documentos se muestran mediante
   icono y metadatos y ningún archivo se almacena en la cola offline.
7. La interfaz se redacta en español de Ecuador (`es-EC`) con lenguaje directo.
8. No se imita la interfaz de Notion literalmente ni se usa su tipografía
   privada.

## 3. Identidad visual

### 3.1 Tipografía

- Familia principal: `Inter`.
- Fallback: `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, sans-serif.
- No usar serif.
- Título de página: 28 px / 34 px, peso 650–700.
- Título de sección: 20 px / 28 px, peso 650.
- Título de tarjeta: 16 px / 24 px, peso 600.
- Cuerpo: 15–16 px / 22–24 px, peso 400.
- Metadata: 13–14 px / 18–20 px.
- Badge: 12 px / 16 px, peso 600.
- Números tabulares para importes, fechas comparables y KPIs.

### 3.2 Colores

Los valores se implementan como variables CSS semánticas. No se permiten
hexadecimales arbitrarios dentro de las pantallas.

| Token | Valor inicial | Uso |
|---|---:|---|
| `--color-primary` | `#0075DE` | CTA, enlace principal, selección |
| `--color-primary-hover` | `#005BAB` | Hover del primario |
| `--color-focus` | `#097FE8` | Foco visible |
| `--color-primary-soft` | `#F2F9FF` | Selección y superficie informativa |
| `--color-surface` | `#FFFFFF` | Fondo principal |
| `--color-surface-subtle` | `#F6F5F4` | Fondo alterno y paneles suaves |
| `--color-text` | `rgba(0,0,0,.95)` | Texto principal |
| `--color-text-muted` | `#615D59` | Metadata y ayuda |
| `--color-border` | `rgba(0,0,0,.10)` | Bordes y divisores |
| `--color-success` | verde AA | Éxito y completado |
| `--color-warning` | naranja AA | Advertencia y pendiente |
| `--color-danger` | rojo AA | Error y acción destructiva |

Éxito, advertencia y peligro necesitan icono o texto además del color. Sus
valores definitivos se validan contra WCAG 2.2 AA antes de congelar los tokens.

### 3.3 Espaciado, tamaño y forma

- Unidad base: 8 px.
- Escala: 4, 8, 12, 16, 24, 32, 40, 48 y 64 px.
- Altura de control escritorio: 40 px.
- Objetivo táctil mínimo: 44 × 44 px.
- Radio de inputs y botones: 4–6 px.
- Radio de tarjetas: 8–12 px.
- Estados compactos: pill completo.
- Borde estándar: 1 px.
- Sombras: solo dialogs, drawers, menús y paneles elevados; suaves y sin efecto
  flotante excesivo.
- Foco: ring de 2 px con separación de 2 px.

## 4. Layout responsive

### 4.1 Breakpoints de referencia

| Nombre | Ancho | Comportamiento |
|---|---:|---|
| Móvil compacto | 360–479 px | Una columna, acciones fijas cuando sea necesario |
| Móvil amplio | 480–767 px | Una columna y tarjetas más anchas |
| Tablet | 768–1023 px | Paneles adaptables, navegación según espacio |
| Escritorio | 1024–1439 px | Sidebar y contenido principal |
| Escritorio amplio | ≥1440 px | Contenido con ancho máximo y panel lateral |

La aplicación debe funcionar desde 360 px sin scroll horizontal accidental.

### 4.2 Shell

**Escritorio:** sidebar fija con Inicio, Agenda, Cuentas, Tareas, Documentos,
Reportes y Notificaciones. Manager además ve Usuarios, Catálogos, Auditoría y
Configuración. En el pie aparecen sincronización, perfil y versión.

**Móvil:** navegación inferior `Inicio | Agenda | Cuentas | Tareas | Más`.
`Más` contiene Documentos, Reportes, Notificaciones, Sync, Perfil y opciones de
Manager. No existe un FAB global: la acción primaria es contextual.

### 4.3 Contenido

- Ancho útil recomendado en escritorio: 1200–1360 px.
- Encabezado de página: título, contexto, acción primaria y acciones secundarias.
- Formularios: máximo legible; secciones en escritorio y pasos en móvil.
- Filtros: barra visible en escritorio y bottom sheet con contador en móvil.
- Tablas: encabezados persistentes cuando aporte valor; en móvil se transforman
  en tarjetas semánticas, no en tablas comprimidas.

## 5. Componentes canónicos

Los componentes viven en `packages/ui` y exponen variantes tipadas.

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

Cada componente documenta: normal, hover, focus, active, disabled, loading,
error y offline cuando corresponda.

## 6. Patrones obligatorios

### 6.1 Botones y acciones

- Solo una acción primaria visual por región.
- Secundarias con estilo neutral; terciarias como texto o menú.
- Destructivas no dependen solo del rojo y siempre solicitan confirmación cuando
  el impacto no sea reversible.
- En formularios móviles largos, `StickyActionBar` mantiene Guardar/Cancelar.
- Los botones describen acciones: “Guardar cuenta”, “Completar visita”, no “OK”.

### 6.2 Formularios

- Label persistente encima del control; placeholder solo como ejemplo.
- Ayuda antes del error; error debajo y asociado con `aria-describedby`.
- Resumen de errores al enviar un formulario inválido.
- Campos obligatorios explícitos; no marcar todos y esconder excepciones.
- Cuenta en móvil: tres pasos — Identidad; Ubicación y contactos;
  Clasificación y revisión.
- GPS se solicita mediante una acción explícita con explicación previa.

### 6.3 Listados y filtros

- Loading mediante skeleton que imita la estructura real.
- Vacío inicial y “sin resultados” son estados diferentes.
- Filtros activos visibles, removibles y reflejados en la URL cuando sea útil.
- Paginación común por página; sincronización por cursor.
- Acciones por fila dependen del permiso, pero el backend siempre revalida.

### 6.4 Agenda

- Escritorio: semana/mes/lista y panel de detalle.
- Móvil: día/mes/lista con tira semanal fija.
- La vista mensual muestra el mes completo y permite navegar entre meses.
- Fechas muestran zona cuando pueda existir ambigüedad.

### 6.5 Offline y sincronización

- Banner offline persistente.
- Indicador con última sincronización y operaciones pendientes.
- Datos obsoletos muestran “Datos hasta [hora]”.
- Una operación pendiente no se presenta como confirmada por el servidor.
- Conflictos enlazan al centro de sincronización.
- No mostrar payloads técnicos, tokens ni información sensible.

### 6.6 Documentos

- Solo PDF, DOCX y XLSX; máximo 10 MB.
- No se admiten imágenes ni fotos.
- Carga únicamente online.
- Estados visibles: cargando, analizando, disponible y rechazado.
- No previsualizar contenido en cuarentena.
- Representación mediante icono de Lucide, nombre, categoría, tamaño y contexto.

## 7. Estados globales

Toda pantalla relevante debe diseñar y probar:

- loading;
- contenido disponible;
- vacío inicial;
- sin resultados;
- error recuperable;
- permiso insuficiente;
- offline;
- datos obsoletos;
- operación pendiente;
- sincronizando;
- conflicto;
- sesión vencida.

Los códigos 403, 404, 409, 422, 429 y 500 usan mensajes comprensibles. En 500
se muestra `requestId`, nunca stack trace.

## 8. Accesibilidad

- Objetivo WCAG 2.2 AA en flujos críticos.
- Navegación completa por teclado y skip link.
- Orden DOM coherente con el orden visual.
- Foco visible en cada control interactivo.
- Labels accesibles e instrucciones persistentes.
- `Dialog`, `Drawer` y `BottomSheet` administran foco, Escape y retorno de foco.
- `aria-live` para guardado, sincronización y jobs sin anuncios excesivos.
- Tablas con encabezados semánticos.
- Teclado y lector de pantalla en login, cuenta, visita, tarea y sync.

## 9. Tecnología de implementación

- Tailwind CSS 4 para tokens y utilidades.
- Radix UI para primitivas accesibles.
- Componentes propios con enfoque similar a shadcn, pero mantenidos por VICAM.
- Lucide para iconografía.
- React Hook Form y Zod para formularios.
- TanStack Query para estado de servidor.
- Zustand solo para estado efímero de interfaz.
- Dexie para datos offline autorizados.

## 10. Control de calidad visual

Antes de aceptar una pantalla:

1. Comparar con este documento y la especificación funcional de la ruta.
2. Verificar 360×800, 390×844, 768×1024, 1366×768 y 1440×900.
3. Confirmar ausencia de overflow horizontal.
4. Probar teclado, foco y contraste.
5. Probar loading, vacío, error, permiso y offline.
6. Confirmar que usa componentes de `packages/ui` y tokens semánticos.
7. Capturar evidencia Playwright de escritorio y móvil.
8. Ejecutar pruebas de componentes con React Testing Library y axe.

## 11. Cambios al sistema

Una modificación visual transversal requiere:

1. propuesta con problema y pantallas afectadas;
2. actualización de este documento y tokens;
3. migración del componente compartido;
4. pruebas y capturas responsive;
5. revisión del agente `reviewer`;
6. aprobación explícita antes de convertirla en nueva regla.
