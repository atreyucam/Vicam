# AGENTS.md — Proyecto VICAM

## Fuentes de verdad

Antes de planificar o modificar código, leer en este orden:

1. `docs/01_SRS_VICAM_v1.0.md`
2. `docs/02_ARQUITECTURA_BD_API_VICAM_v2.0.md`
3. `docs/03_FRONTEND_TESTING_DESPLIEGUE_VICAM_v1.0.md`
4. `docs/04_DESIGN_SYSTEM_VICAM_v1.0.md`
5. `docs/05_DECISIONES_VICAM_D01_D80.md`

Las decisiones D-01 a D-80 están aprobadas. No se reinterpretan ni cambian sin
autorización explícita. Si existe contradicción material, detener únicamente la
parte afectada, registrar opciones e impacto y solicitar decisión.

## Arquitectura obligatoria

- Monorepo pnpm con TypeScript strict.
- `apps/web`: React 19, Vite y PWA.
- `apps/api`: Node.js 24 y Express 5.
- `apps/worker`: pg-boss.
- `packages/db`: PostgreSQL 18 y Drizzle.
- `packages/contracts`: Zod, OpenAPI 3.1 y cliente TypeScript generado.
- `packages/ui`: tokens y componentes compartidos.
- Docker Compose y Caddy.
- No Redis en el MVP.

## Sistema de diseño obligatorio

`docs/04_DESIGN_SYSTEM_VICAM_v1.0.md` es la fuente visual canónica.

- Inter; no serif.
- Primario `#0075DE`.
- Minimalismo cálido y superficies suaves.
- Tailwind CSS 4, Radix UI, componentes propios y Lucide.
- No usar colores arbitrarios fuera de tokens.
- No duplicar componentes fuera de `packages/ui`.
- Sidebar en escritorio y navegación inferior en móvil.
- CTA contextual; barra fija para formularios móviles largos.
- Cuenta en tres pasos en móvil.
- Agenda semana/lista en escritorio y día/lista en móvil.
- WCAG 2.2 AA y ancho mínimo 360 px.
- No fotografías, imágenes decorativas, avatares fotográficos, carga de imágenes
  por usuarios ni fondos pesados. Se permiten únicamente recursos técnicos de
  identidad (favicon, logotipo tipográfico, iconos PWA, maskable y
  apple-touch-icon), iconografía Lucide y recursos técnicos del mapa.
- Diseñar loading, vacío, sin resultados, error, permiso, offline, datos
  obsoletos, pendiente, sincronizando y conflicto.

## Seguridad y datos

- La autorización se valida en backend por rol, asignación y propiedad.
- Nunca registrar contraseñas, tokens, PIN o contenido documental.
- Argon2id para contraseñas.
- Access token en memoria; refresh rotatorio en cookie HttpOnly y hash servidor.
- Documentos PDF, DOCX o XLSX, máximo 10 MB, solo online y con ClamAV.
- Ninguna imagen o documento se guarda en la cola offline.
- Migraciones SQL versionadas; nunca `drizzle push` en producción.
- Staging usa datos ficticios o anonimizados.

## Trabajo con subagentes

- El agente raíz es coordinador e integrador.
- Delegar solo tareas independientes y acotadas.
- Cada subagente tiene propiedad exclusiva sobre las carpetas indicadas en su
  archivo `.toml`.
- No permitir dos escritores simultáneos sobre un archivo compartido.
- Cambios en contratos, workspace, lockfile o configuración raíz los integra el
  coordinador.
- Empezar con exploración de solo lectura; implementar después de consolidar el
  plan.
- Esperar todos los resultados antes de integrar una fase.
- `reviewer` revisa; no implementa silenciosamente.

## Definición de terminado

Antes de declarar una tarea o fase terminada:

1. Cumplir requisitos y decisiones asociados.
2. Ejecutar formato, lint y typecheck.
3. Ejecutar pruebas unitarias y de componentes afectadas.
4. Ejecutar integración API/DB si corresponde.
5. Ejecutar Playwright para el flujo modificado.
6. Revisar 360, 768 y 1440 px cuando exista UI.
7. Revisar teclado, foco y accesibilidad.
8. Revisar diff, migraciones, logs y exposición de secretos.
9. Actualizar documentación, ADR y changelog cuando corresponda.
10. Informar comandos ejecutados, resultados y riesgos pendientes.

No desplegar producción sin autorización explícita del usuario.
