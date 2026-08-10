# Runbook: monitor externo

El workflow `External monitor` consulta cada cinco minutos gateway live,
readiness API y expiración TLS desde infraestructura de GitHub, externa al VPS.
No sustituye métricas Hostinger ni alertas de disco, cola, backup o firmas.

## Configuración

Defina variables del repositorio:

- `VICAM_MONITOR_URL`: URL base de staging o producción.
- `VICAM_MONITOR_TIMEOUT_MS`: recomendado `10000`.
- `VICAM_MONITOR_MIN_CERT_DAYS`: recomendado `14`.

Defina el secret opcional `VICAM_MONITOR_WEBHOOK_URL` para alertas. El payload
solo contiene evento, objetivo, hora y error técnico; no incluye datos de
negocio. Si `VICAM_MONITOR_URL` no está configurada, el job programado queda
omitido deliberadamente.

## Validación local

```sh
VICAM_MONITOR_URL=https://staging.app.vicamproduce.com \
VICAM_MONITOR_MIN_CERT_DAYS=14 \
node infra/scripts/monitor.mjs
```

Ejecute también `workflow_dispatch`, provoque una URL inválida temporal y
confirme recepción de alerta y escalamiento. Después restaure la URL y confirme
recuperación. Para producción se requiere un canal con responsable y guardia
documentados; GitHub Actions no ofrece SLA de ejecución exacta, por lo que se
recomienda un segundo monitor independiente antes de salida.
