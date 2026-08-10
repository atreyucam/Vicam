# Runbook de desarrollo local

Este procedimiento levanta el entorno local sin tocar VPS, DNS, staging ni
producción, y no publica imágenes. Incluye ClamAV para validar su disponibilidad
operativa, aunque el flujo API/worker que envía documentos a escanear pertenece
al equipo dueño de esos servicios.

## Requisitos

- Docker Desktop con Compose v2 y el motor Linux iniciado.
- PowerShell 7 o Windows PowerShell 5.1.
- Puertos locales `8080` y `5432` libres, o valores alternativos documentados
  en un archivo de entorno local.
- `pnpm-lock.yaml` generado por el coordinador. Los Dockerfiles y CI usan
  instalación congelada y no modifican el lockfile.

## Variables locales

`infra/env/local.env.example` contiene valores ficticios seguros solo para una
máquina de desarrollo:

| Variable                              | Valor ficticio por defecto   | Uso                                         |
| ------------------------------------- | ---------------------------- | ------------------------------------------- |
| `VICAM_POSTGRES_DB`                   | `vicam_local`                | Base local                                  |
| `VICAM_POSTGRES_USER`                 | `vicam_local`                | Usuario local                               |
| `VICAM_POSTGRES_PASSWORD`             | `vicam_local_only_change_me` | Contraseña local no secreta                 |
| `VICAM_POSTGRES_PORT`                 | `5432`                       | Puerto PostgreSQL ligado a `127.0.0.1`      |
| `VICAM_HTTP_PORT`                     | `8080`                       | Entrada same-origin de Caddy en `127.0.0.1` |
| `VICAM_LOG_LEVEL`                     | `info`                       | Nivel de logs JSON de API/worker            |
| `VICAM_OFFLINE_SYNC_ENABLED`          | `true`                       | Feature flag de sincronización offline      |
| `VICAM_CLAMD_HOST`                    | `clamav`                     | DNS privado de ClamAV                       |
| `VICAM_CLAMD_PORT`                    | `3310`                       | Puerto privado de `clamd`                   |
| `VICAM_MAPLIBRE_STYLE_URL`            | vacío                        | Style JSON opcional para el build local     |
| `VICAM_MAPLIBRE_API_KEY`              | vacío                        | Clave pública de navegador, restringida     |
| `VICAM_CSP_MAP_CONNECT_SRC`           | allowlist MapTiler           | Orígenes de red permitidos por CSP          |
| `VICAM_CSP_MAP_IMG_SRC`               | allowlist MapTiler           | Orígenes de imagen técnica permitidos       |
| `VICAM_BACKUP_RETENTION_DAYS`         | `3`                          | Retención de dumps locales verificables     |
| `VICAM_BACKUP_INTERVAL_SECONDS`       | `86400`                      | Intervalo de `pg_dump` local                |
| `VICAM_BACKUP_HEALTH_MAX_AGE_MINUTES` | `1500`                       | Edad máxima del último backup correcto      |

Para personalizar valores, copie el ejemplo a una ruta ignorada, por ejemplo
`.env.local`, y pase `-EnvFile .env.local`. No reutilice estas credenciales en
ningún ambiente compartido.

## Validar y arrancar

Desde la raíz del repositorio:

```powershell
docker compose --env-file infra/env/local.env.example config --quiet
./infra/scripts/local-up.ps1
```

El script construye las imágenes Node 24 y de backup, espera los healthchecks,
incluido ClamAV, y consulta Caddy y API. La aplicación queda en
`http://127.0.0.1:8080`; Caddy
sirve la web y reenvía `/api/v1` a la API sin CORS.

Para observar logs estructurados:

```powershell
docker compose --env-file infra/env/local.env.example logs --follow caddy api worker
```

Docker rota cada log local a tres archivos de 10 MB. No deben aparecer
contraseñas, tokens, PIN ni contenido documental.

## Migraciones

Con PostgreSQL disponible, ejecute únicamente las migraciones versionadas de
`packages/db`:

```powershell
./infra/scripts/local-migrate.ps1
```

El script ejecuta el migrador compilado dentro de un contenedor API temporal.
Nunca usa `drizzle push`.

## Datos ficticios opcionales

Después de migrar se puede cargar un conjunto idempotente de demostración:

```powershell
./infra/scripts/local-seed.ps1
```

Los usuarios `manager.demo` y `supervisor.demo` quedan inactivos y no tienen
una contraseña utilizable. El seed no contiene credenciales reales.

## Salud y readiness

```powershell
./infra/scripts/local-health.ps1
docker compose --env-file infra/env/local.env.example ps
```

Se esperan respuestas HTTP 200 de:

- `/health/live` para Caddy;
- `/api/v1/health/live` para proceso API;
- `/api/v1/health/ready` para API y PostgreSQL.

El worker tiene healthcheck interno en el puerto `3001`; no se expone al host.
PostgreSQL solo se liga a loopback para herramientas locales.
ClamAV tampoco se expone al host; sus firmas se mantienen en un volumen local.
Se ejecuta como usuario `clamav` con `/init-unprivileged`, root filesystem de
solo lectura y todas las capabilities eliminadas. Esto evita el `chown` del
entrypoint privilegiado que falla con `cap_drop: ALL`.
API y worker comparten el volumen privado `documents_data` montado en
`/srv/vicam`; Caddy y web no lo montan y nunca sirven sus rutas directamente.
El servicio `backup` crea un dump verificable, también privado, al arrancar y
después cada 24 horas.

Prueba funcional de ClamAV:

```sh
COMPOSE_FILE=compose.yaml ENV_FILE=infra/env/local.env.example \
  sh infra/scripts/clamav-smoke.sh
```

Consulte [clamav.md](clamav.md) si un volumen heredado tiene propiedad
incorrecta; no elimine el volumen como primera respuesta.

Push VAPID queda deshabilitado en Compose local para evitar claves ficticias
inválidas; las notificaciones internas siguen disponibles. Para probar push se
debe usar staging con las tres variables VAPID coherentes y una imagen web
construida con la clave pública correspondiente.

## Parada y rollback local

La parada normal es reversible y conserva el volumen PostgreSQL:

```powershell
./infra/scripts/local-down.ps1
```

Para volver a una versión anterior, detenga Compose, cambie al commit anterior
y vuelva a construir. Las migraciones aplicadas no se revierten
automáticamente; use un forward-fix compatible o restaure un dump local.

Solo si se acepta perder todos los datos locales, una persona puede eliminar
el volumen explícitamente con `docker compose down --volumes`. Esta acción no
forma parte de los scripts por ser destructiva.

## Diagnóstico breve

```powershell
docker compose --env-file infra/env/local.env.example ps
docker compose --env-file infra/env/local.env.example logs --tail 200 api worker postgres caddy
docker compose --env-file infra/env/local.env.example config
```

Si `up --wait` falla, revise primero el healthcheck afectado. Un puerto ocupado
se corrige cambiando `VICAM_HTTP_PORT` o `VICAM_POSTGRES_PORT` en el archivo
local. Si falta el lockfile, espere la integración del coordinador; no ejecute
una instalación que lo regenere desde este alcance.
