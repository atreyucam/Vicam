# Prompt maestro — Codex App de escritorio

Pegar este prompt en un chat nuevo de Codex después de abrir la carpeta local
del proyecto VICAM. Usar modo **Plan** y permisos limitados al workspace.

---

Actúa como agente coordinador técnico del sistema VICAM.

El objetivo general es implementar la aplicación web responsive y PWA definida
en los documentos de `docs`, para producción futura en
`https://app.vicamproduce.com` mediante Docker Compose sobre el VPS Hostinger.

Antes de hacer cualquier cosa:

1. Lee `AGENTS.md` completo.
2. Lee los cinco documentos de `docs` en el orden indicado por `AGENTS.md`.
3. Lee `PLANS.md`.
4. Verifica que están disponibles los agentes de proyecto `backend`,
   `frontend`, `platform` y `reviewer`.

Las decisiones D-01 a D-80 están aprobadas y no pueden reinterpretarse.
`docs/04_DESIGN_SYSTEM_VICAM_v1.0.md` es la única fuente de verdad visual.
No se permiten imágenes ni fotografías dentro del producto.

## Trabajo solicitado en esta ejecución

Realiza únicamente análisis y planificación. No escribas código productivo, no
instales dependencias, no despliegues y no modifiques los documentos aprobados.

Usa subagentes explícitamente y en paralelo:

1. Delega al agente `backend` una revisión de solo lectura de arquitectura,
   modelo de datos, contratos, seguridad, jobs, documentos y sincronización.
2. Delega al agente `frontend` una revisión de solo lectura de rutas,
   componentes, pantallas, estados responsive/PWA y cumplimiento del sistema de
   diseño.
3. Delega al agente `platform` una revisión de solo lectura de Docker, VPS,
   CI/CD, backups, observabilidad, testing y riesgos operativos.

Cada agente debe devolver:

- alcance revisado;
- requisitos y decisiones implicadas;
- dependencias;
- riesgos o contradicciones;
- propuesta de tareas verificables;
- archivos o carpetas que necesitaría modificar;
- pruebas y evidencia de terminado.

Espera a los tres agentes. No avances con resultados parciales.

Después consolida el resultado en una propuesta para `PLANS.md` que incluya:

- fases y orden de dependencias;
- entregable demostrable de cada fase;
- requisitos y decisiones D-xx cubiertas;
- propiedad exclusiva de carpetas por agente;
- archivos compartidos reservados al coordinador;
- migraciones y contratos previstos;
- pruebas, evidencia y puertas de calidad;
- riesgos, rollback y puntos que necesitan aprobación humana.

Al finalizar, presenta:

1. resumen ejecutivo;
2. plan por fases;
3. contradicciones encontradas;
4. decisiones humanas realmente pendientes;
5. propuesta exacta de modificación de `PLANS.md`.

No implementes nada hasta que yo apruebe el plan.

---

## Prompt para aprobar la planificación

Pegar solo después de revisar el plan:

```text
Apruebo la planificación consolidada.

Actualiza únicamente PLANS.md con el plan aprobado y crea, si hace falta, un
README de desarrollo inicial. No implementes todavía la Fase 0.

Antes de terminar, verifica que cada fase tiene resultado demostrable,
decisiones D-xx, agente propietario, pruebas y criterio de aceptación.
Muéstrame el diff y espera mi aprobación.
```

## Prompt para ejecutar la Fase 0

```text
Ejecuta solamente la Fase 0 aprobada en PLANS.md.

Actúa como coordinador y usa los subagentes backend, frontend y platform solo
para tareas independientes. Antes de delegar, asigna carpetas exclusivas y
reserva al coordinador los archivos raíz, contratos compartidos, workspace y
lockfile. Evita que dos agentes editen el mismo archivo.

Espera a todos los subagentes, integra los resultados, ejecuta todas las
verificaciones de AGENTS.md y solicita al agente reviewer una revisión final de
solo lectura.

Corrige únicamente hallazgos bloqueantes o altos dentro del alcance de la Fase
0 y vuelve a verificar. No avances a Fase 1 y no despliegues producción.

Entrega un resumen con archivos modificados, decisiones cubiertas, comandos y
pruebas ejecutadas, resultados, capturas si existe UI, riesgos residuales y
estado del criterio de aceptación.
```

## Prompt genérico para las fases siguientes

Cambiar `N` por el número de fase:

```text
Revisa el estado real del repositorio y ejecuta solamente la Fase N aprobada en
PLANS.md.

Primero confirma que la fase anterior está aceptada y que no existen pruebas
rojas o hallazgos bloqueantes. Usa subagentes solo para trabajos independientes,
con carpetas exclusivas. Espera a todos, integra y ejecuta las puertas de calidad
de AGENTS.md.

Solicita después una revisión de solo lectura al agente reviewer contra los
cinco documentos, las decisiones D-01 a D-80, seguridad, diseño, accesibilidad,
responsive y pruebas.

No avances de fase y no despliegues producción. Presenta evidencia verificable
y el diff final para revisión humana.
```
