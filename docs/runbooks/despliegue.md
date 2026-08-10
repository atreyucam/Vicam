# Runbook: despliegue controlado

Este procedimiento no ejecuta despliegues desde CI ni conecta a un VPS. Úselo solo por un operador autorizado. Producción requiere release etiquetada, aprobación manual y ventana comunicada (D-57).

## Antes de iniciar

- Confirme CI verde y copie del resumen las cuatro referencias GHCR por digest (`api`, `worker`, `web`, `backup`), no solo el tag `sha-<commit>`.
- Cree un archivo de entorno protegido, permisos `0600`, desde el ejemplo del ambiente. Use credenciales, secreto de autenticación, volúmenes y base distintos para staging y producción.
- Configure el trío VAPID completo por ambiente. La misma imagen web lee en
  runtime `VICAM_VAPID_PUBLIC_KEY`, `VICAM_MAPLIBRE_STYLE_URL`,
  `VICAM_MAPLIBRE_API_KEY` y `VICAM_OFFLINE_SYNC_ENABLED`;
  `runtime/config.js` se genera al iniciar en un `tmpfs` dedicado, se sirve con
  `Cache-Control: no-store` y queda fuera del precache PWA. El resto de la
  imagen permanece de solo lectura. No incorpore configuración de ambiente
  durante el build.
- Restrinja la clave MapTiler al hostname del ambiente y mantenga
  `VICAM_CSP_MAP_CONNECT_SRC`/`VICAM_CSP_MAP_IMG_SRC` en una allowlist de
  orígenes HTTPS exactos. Ampliar CSP requiere revisión.
- En staging, confirme que la semilla y cualquier restore contienen solo datos ficticios o anonimizados.
- Verifique espacio libre mayor de 20 %, worker/cola saludable, digest anterior disponible y backup reciente verificable.
- Para migración: tome el snapshot manual del proveedor y ejecute solo migraciones SQL versionadas; nunca `drizzle push`.

## Validar sin cambiar servicios

```sh
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml config --quiet
docker compose --env-file /srv/vicam/production.env -f compose.production.yaml config --quiet
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml config | grep -E 'documents_data|DOCUMENT_STORAGE_ROOT|CLAMD_HOST'
```

## Aplicar a staging

Actualice solo `VICAM_*_IMAGE` con digests de CI y ejecute:

```sh
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml pull
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml run --rm api node packages/db/dist/migrate-cli.js
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml up -d --wait
curl --fail --show-error https://staging.app.vicamproduce.com/health/live
curl --fail --show-error https://staging.app.vicamproduce.com/api/v1/health/ready
```

Ejecute E2E completo, offline, importación, reporte, prueba de ClamAV y restore programado. Registre resultado y referencia anterior antes de autorizar producción.
Compruebe además que API y worker montan el mismo `documents_data`, que Caddy
no lo monta y que el mapa no genera violaciones CSP en la consola.

## Aplicar a producción

Repita con `production.env` y `compose.production.yaml` tras aprobación manual. Después, haga smoke de login, cuenta, agenda, documento controlado, reporte y monitor externo. No exponga PostgreSQL, worker, ClamAV ni backup al host.

Si falla una migración, deténgase: no haga downgrade automático de esquema. Use rollback para código compatible o restore ante daño de datos.
