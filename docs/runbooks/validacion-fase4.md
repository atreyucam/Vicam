# Runbook: validación reproducible de Fase 4

Este runbook genera evidencia local o de staging sin desplegar producción.
Staging debe contener únicamente datos ficticios o anonimizados. Cada ejecución
registra UTC, commit, digests, ambiente, operador, comandos, duración y
resultado; no registra credenciales, tokens, PIN, documentos ni payloads.

## Puerta previa

```sh
git status --short
docker compose --env-file infra/env/local.env.example -f compose.yaml config --quiet
node --check infra/scripts/smoke.mjs
node --check infra/scripts/monitor.mjs
sh -n infra/scripts/backup-restore-test.sh
sh -n infra/scripts/clamav-smoke.sh
sh -n infra/scripts/release-state.sh
```

Compruebe que las imágenes de staging usan referencias
`ghcr.io/...@sha256:<64 hex>`, que el digest anterior sigue disponible y que
ningún puerto interno está publicado.

## Smoke local o staging

Smoke no autenticado local:

```sh
VICAM_SMOKE_BASE_URL=http://127.0.0.1:8080 node infra/scripts/smoke.mjs
```

Smoke autenticado en staging, con un usuario ficticio dedicado:

```sh
export VICAM_SMOKE_BASE_URL=https://staging.app.vicamproduce.com
export VICAM_SMOKE_USERNAME=smoke.manager
export VICAM_SMOKE_PASSWORD='leer-desde-gestor-no-desde-shell-history'
node infra/scripts/smoke.mjs
unset VICAM_SMOKE_PASSWORD
```

El script valida gateway live, API live/readiness, home y headers; si recibe
credenciales, valida páginas de cuentas, visitas y tareas y revoca la sesión al
final. Use un método que no deje la contraseña en historial, por ejemplo una
variable inyectada por CI o un prompt del gestor aprobado.

## ClamAV

```sh
COMPOSE_FILE=compose.yaml \
ENV_FILE=infra/env/local.env.example \
sh infra/scripts/clamav-smoke.sh
```

Se exige contenedor saludable, respuesta `PONG` y detección de EICAR por
stream. EICAR es una cadena estándar de prueba y no se guarda como documento.
Revise además:

```sh
docker compose --env-file infra/env/local.env.example exec -T clamav id
docker compose --env-file infra/env/local.env.example inspect clamav
```

El proceso debe ser `clamav`, con `CapDrop=ALL`, root filesystem de solo
lectura y escritura solo en `/var/lib/clamav` y el `tmpfs` de `/tmp`.

## Restore a base temporal

Con `postgres` y `backup` saludables:

```sh
COMPOSE_FILE=compose.yaml \
ENV_FILE=infra/env/local.env.example \
sh infra/scripts/backup-restore-test.sh
```

El script verifica checksum y catálogo, crea una base `vicam_restore_*`,
restaura con `--exit-on-error`, comprueba tablas, extensiones, conteos y
migraciones, y cruza cada documento activo con el archivo y checksum del tar.
Elimina la base temporal mediante `trap` y rechaza producción. Capture el par
con escritores detenidos según [backup-restore.md](backup-restore.md).

## Carga con dataset sintético

Ejecute solo contra una base temporal de carga que pueda destruirse completa.
No inyecte el dataset en producción ni en un staging compartido con un piloto
activo.

1. Restaure una base limpia temporal y cree un Manager ficticio dedicado
   `manager.load`.
2. Cargue el objetivo D-76:

```sh
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml \
  exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 \
    -v confirm_synthetic_load=YES \
    -v owner_username=manager.load \
    -v account_count=100000 \
    -v visit_count=500000 \
    -v task_count=500000 \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < infra/k6/synthetic-dataset.sql
```

3. Ejecute 20 usuarios concurrentes. La imagen k6 está fijada por digest:

```sh
docker run --rm --network host \
  -e K6_BASE_URL=https://staging.app.vicamproduce.com \
  -e K6_USERNAME=manager.load \
  -e K6_PASSWORD \
  -e VICAM_LOAD_VUS=20 \
  -e VICAM_LOAD_DURATION=5m \
  -e VICAM_LOAD_THINK_TIME_SECONDS=1.5 \
  -v "$PWD/infra/k6:/scripts:ro" \
  grafana/k6@sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c \
  run /scripts/vicam-load.js
```

4. Para la puerta de 100 operaciones sync, repita con
   `K6_MUTATING_SYNC=true`. Crea 100 cuentas sintéticas vía protocolo real y
   exige menos de 30 segundos; reenvía las mismas claves, exige 100 resultados
   `DUPLICATE` y consulta que existan exactamente 100 efectos persistidos. Use
   exclusivamente la DB temporal. Cuando k6 corre en Docker y el origen público
   difiere de la URL de transporte, defina `K6_ORIGIN`.
5. El tiempo de interacción representa lectura y navegación humana; no lo
   reduzca para aparentar mayor concurrencia. Para stress sostenido use un
   escenario separado con tasa constante y puertas aprobadas.
6. Registre p50/p95/p99, error rate, CPU/RAM/disco, conexiones PostgreSQL,
   crecimiento WAL, cola y duración. Las puertas son CRUD p95 `<400 ms`,
   búsqueda p95 `<700 ms`, sync 100 `<30 s` y error `<1 %`.
7. Destruya la DB temporal completa; no intente limpiar millones de filas con
   `DELETE` en el staging compartido.

## Rollback de imagen y configuración

Antes de una promoción autorizada capture el estado fuera del repositorio:

```sh
sh infra/scripts/release-state.sh capture \
  /srv/vicam/staging.env compose.staging.yaml \
  /srv/vicam/release-state/2026-07-24T220000Z
```

El directorio protegido contiene el entorno, por lo que debe tener backup
privado y permisos `0700/0600`. Para ensayar rollback:

```sh
sh infra/scripts/release-state.sh rollback \
  /srv/vicam/staging.env compose.staging.yaml \
  /srv/vicam/release-state/2026-07-24T220000Z
```

La primera ejecución solo valida digests, commit y checksums. Cambie
manualmente al commit registrado y use `--apply` únicamente en una ventana
autorizada. El script conserva el entorno reemplazado como
`.pre-rollback.<UTC>`, aplica Compose y espera healthchecks. Después ejecute
smoke. `capture` y `rollback` rechazan un árbol Git con cambios rastreados,
staged o no rastreados. Nunca revierte migraciones SQL automáticamente.

## Evidencia mínima de cierre

- Commit y cuatro digests del candidato/anterior.
- Compose y Caddy validados.
- Smoke local/staging y ClamAV/EICAR.
- Restore temporal y duración comparada con RTO 4 h.
- Resultado k6 y métricas del VPS.
- Evidencia Playwright/Lighthouse/axe/dispositivos del equipo correspondiente.
- Resultado del monitor externo.
- Incidencias con severidad, responsable y fecha.
- Aprobación o rechazo humano de piloto y producción.
