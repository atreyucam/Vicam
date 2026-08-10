# Runbook: ClamAV local y staging

La imagen oficial se ejecuta como usuario `clamav` mediante
`/init-unprivileged`. El entrypoint normal `/init` intenta hacer `chown`
recursivo al volumen; combinado con `cap_drop: ALL`, root tampoco puede
atravesar el directorio `0700` ni cambiar propiedad y entra en reinicio. La
configuración VICAM evita esa ruta privilegiada en vez de añadir capacidades.

## Estado esperado

- Imagen fijada por digest.
- `user: clamav`, `entrypoint: /init-unprivileged`.
- `cap_drop: ALL`, `no-new-privileges`, root filesystem de solo lectura.
- Volumen persistente `/var/lib/clamav` propiedad de UID/GID de `clamav`.
- `/tmp` y `/var/log/clamav` efímeros, `noexec`, `nosuid`; puerto 3310 solo en
  la red privada.
- Red de salida `clamav_updates` dedicada para descargar firmas; no publica
  puertos ni conecta API, worker o PostgreSQL.
- API y worker dependen del healthcheck de ClamAV.

## Arranque y verificación

```sh
docker compose --env-file infra/env/local.env.example up -d clamav
docker compose --env-file infra/env/local.env.example ps clamav
docker compose --env-file infra/env/local.env.example logs --tail 100 clamav
COMPOSE_FILE=compose.yaml ENV_FILE=infra/env/local.env.example \
  sh infra/scripts/clamav-smoke.sh
```

El primer arranque de una imagen `_base` descarga firmas y puede tardar varios
minutos. No reduzca `start_period` sin medir. Las firmas persisten en
`clamav_data`.

Después del seed local o en staging con datos ficticios, pruebe también login,
carga, cuarentena, worker, rechazo y descarga denegada:

```sh
VICAM_SMOKE_BASE_URL=https://staging.app.vicamproduce.com \
VICAM_SMOKE_USERNAME=manager.smoke \
VICAM_SMOKE_PASSWORD='valor-protegido' \
node infra/scripts/document-antivirus-smoke.mjs
```

La contraseña se entrega únicamente por variable protegida y el script nunca
la imprime. El documento EICAR queda rechazado como evidencia operativa.

## Volumen heredado con permisos incorrectos

No elimine el volumen para corregir permisos. Detenga solo ClamAV, inspeccione
el UID/GID de la imagen y repare una vez con un contenedor efímero de la misma
imagen y solo `CHOWN`; registre la acción:

```sh
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml stop clamav
docker run --rm --user root --cap-drop ALL --cap-add CHOWN \
  -v vicam-staging_clamav_data:/var/lib/clamav \
  --entrypoint chown \
  clamav/clamav:1.4.5_base-debian@sha256:905e2fd40d121a808c62d35d5a6dce2f1c3850cb22559ac74a8ea5a18144be7e \
  -R clamav:clamav /var/lib/clamav
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml up -d --wait clamav
```

Resuelva primero el nombre exacto del volumen con `docker volume ls`; no copie
el ejemplo a ciegas. El contenedor permanente no recibe `CHOWN`.

## Fallo o firmas antiguas

Suspenda publicación de documentos y mantenga cuarentena. Revise DNS/salida
HTTPS, espacio, permisos y logs de FreshClam. No marque documentos como limpios
manualmente. Una vez recuperado, ejecute EICAR y procese la cola mediante el
flujo idempotente aprobado por backend.
