# Guía paso a paso — VICAM con Codex App de escritorio

Esta guía no requiere usar Codex CLI. Las instrucciones escritas como prompts
se pegan directamente en el chat de la aplicación de escritorio.

## Paso 1 — Preparar la carpeta local

1. Descarga y descomprime el paquete `Codex_VICAM_Starter_v1.0.zip`.
2. Renombra la carpeta extraída a `vicam` si deseas un nombre corto.
3. Colócala en la ubicación donde guardarás el proyecto de forma permanente.
4. No borres las carpetas `.codex` o `docs`. En Windows, `.codex` puede verse
   oculta dependiendo de la configuración del Explorador.

Resultado esperado: la raíz contiene `AGENTS.md`, `PLANS.md`, `docs`, `.codex`,
esta guía y el prompt maestro.

## Paso 2 — Abrir la carpeta en Codex

1. Abre la aplicación de escritorio de ChatGPT/Codex.
2. Entra al espacio de trabajo de código.
3. Elige la opción para abrir o seleccionar una carpeta local.
4. Selecciona la carpeta `vicam`, no la carpeta superior ni solo `docs`.
5. Inicia un chat nuevo asociado a esa carpeta.

Resultado esperado: Codex puede ver `AGENTS.md` y los archivos del proyecto.

## Paso 3 — Configurar el turno

1. Selecciona modo **Plan** desde el selector del compositor.
2. Mantén permisos limitados al workspace para la primera ejecución.
3. Elige un nivel de razonamiento alto si está disponible.
4. No habilites acceso total al equipo ni despliegue externo para esta fase.

El archivo `.codex/config.toml` limita la coordinación a cuatro hilos: el agente
principal y hasta tres trabajos paralelos. Los subagentes no pueden crear una
segunda generación de agentes.

## Paso 4 — Ejecutar el análisis con subagentes

1. Abre `PROMPT_MAESTRO_CODEX_DESKTOP.md`.
2. Copia únicamente el bloque principal, desde “Actúa como agente coordinador”
   hasta “No implementes nada hasta que yo apruebe el plan”.
3. Pégalo en el chat y envíalo.
4. Confirma en la interfaz que aparecen tres subagentes: backend, frontend y
   platform.
5. Puedes abrir cada actividad para inspeccionarla, pero deja que el agente raíz
   espere y consolide los tres resultados.

Si Codex empieza a programar, envía inmediatamente:

```text
Detén la implementación. Esta ejecución es exclusivamente de análisis y
planificación. Mantén cualquier cambio propuesto sin aplicarlo y vuelve al
alcance del prompt maestro.
```

## Paso 5 — Revisar el plan antes de aceptarlo

Comprueba que el resultado incluya:

- las cinco fuentes documentales;
- decisiones D-01 a D-80;
- Fases 0 a 4;
- carpetas propietarias por agente;
- archivos compartidos reservados al coordinador;
- pruebas y criterio de aceptación por fase;
- diseño responsive, offline, seguridad y rollback;
- ausencia de despliegue a producción.

Si aparece una propuesta que cambia una decisión aprobada, responde:

```text
No apruebo el cambio de la decisión D-XX. Mantén la línea base del documento
05_DECISIONES_VICAM_D01_D80.md y adapta el plan sin reinterpretarla.
```

## Paso 6 — Guardar la planificación

Cuando estés conforme, pega el bloque “Prompt para aprobar la planificación”
del prompt maestro.

Codex debe modificar solamente `PLANS.md` y, si es necesario, crear un README.
Revisa el panel de cambios de la app. Acepta el diff únicamente si coincide con
lo conversado.

## Paso 7 — Ejecutar la Fase 0

1. Abre un turno nuevo dentro del mismo proyecto.
2. Cambia del modo Plan al modo de trabajo/código con escritura en el workspace.
3. Mantén deshabilitado cualquier despliegue de producción.
4. Pega el bloque “Prompt para ejecutar la Fase 0”.
5. Observa que el coordinador asigne carpetas antes de iniciar subagentes.
6. No envíes la Fase 1 mientras la Fase 0 sigue activa.

Durante la ejecución puedes enviar una instrucción de corrección al turno
activo, por ejemplo:

```text
Mantén el azul primario #0075DE y los componentes en packages/ui. No aceptes
colores hardcodeados dentro de las rutas.
```

## Paso 8 — Revisar cada entrega

Antes de aceptar una fase, confirma:

1. El agente `reviewer` terminó su revisión independiente.
2. No existen hallazgos bloqueantes o altos pendientes.
3. Lint, typecheck y pruebas terminaron correctamente.
4. Las migraciones tienen SQL versionado y rollback documentado.
5. Las pantallas tienen evidencia en 360, 768 y 1440 px.
6. Se probaron teclado, foco, loading, vacío, error, permiso y offline.
7. No se añadieron fotografías, imágenes o subida offline de archivos.
8. El resumen indica decisiones D-xx cubiertas y riesgos residuales.

Usa el panel de cambios de la app para revisar el diff. Si algo no corresponde,
selecciona el cambio y explica la corrección en el chat antes de aceptarlo.

## Paso 9 — Registrar una versión segura

No necesitas abrir una terminal. Pide a Codex:

```text
Revisa el diff final de la Fase N. Si todas las pruebas siguen verdes, crea un
commit local con un mensaje convencional y descriptivo. No hagas push, no abras
un pull request y no despliegues.
```

Si todavía no existe un repositorio Git, durante la Fase 0 puedes pedir:

```text
Inicializa un repositorio Git local para esta carpeta, crea un .gitignore
adecuado para pnpm, Node, Vite, Docker, archivos de entorno y artefactos de
prueba. No agregues secretos y no configures ningún remoto todavía.
```

## Paso 10 — Repetir una fase a la vez

Para Fases 1–4 utiliza el “Prompt genérico para las fases siguientes”. Nunca
solicites dos fases grandes al mismo tiempo. El ciclo es:

1. comprobar fase anterior;
2. delegar trabajos independientes;
3. esperar a los subagentes;
4. integrar;
5. probar;
6. revisar con `reviewer`;
7. corregir bloqueantes;
8. revisar diff;
9. commit local;
10. aprobar manualmente la fase siguiente.

## Paso 11 — Staging

Cuando las Fases 0–3 estén aceptadas, pide primero un plan de staging, no un
despliegue automático:

```text
Prepara un plan de despliegue a staging basado en los runbooks y la arquitectura
aprobada. Usa datos ficticios, identifica variables y secretos que debo crear,
verifica backup/rollback y entrega un checklist. No te conectes al VPS y no
despliegues hasta mi autorización explícita.
```

Revisa especialmente dominio, TLS, firewall, usuario de despliegue, volúmenes,
backups, health checks y migraciones.

## Paso 12 — Producción

Producción se autoriza en un turno separado, únicamente después de staging,
restore probado, E2E completo, piloto y checklist firmado. No pegues
contraseñas, llaves SSH o tokens directamente en el chat o en el repositorio.

La autorización debe nombrar exactamente el ambiente y el release. Ejemplo:

```text
Autorizo desplegar el release previamente validado [versión/SHA] únicamente en
producción, siguiendo el runbook aprobado. Antes de migrar confirma backup,
espacio, health de servicios e imagen de rollback. Detente si cualquier
precondición falla y no sustituyas secretos ni decisiones por supuestos.
```

## Qué hacer si los subagentes se pisan

Detén la parte en conflicto y escribe:

```text
Detén las escrituras paralelas sobre [archivo]. Asigna un solo propietario. Los
demás agentes deben devolver propuestas sin editar ese archivo. El coordinador
integra el cambio después de recibir todos los resultados.
```

Los archivos raíz, `pnpm-workspace.yaml`, lockfile, contratos compartidos y
migraciones ordenadas deben tener un solo integrador por turno.
