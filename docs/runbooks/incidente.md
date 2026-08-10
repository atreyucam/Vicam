# Runbook: incidente operativo

## Primeros 15 minutos

1. Abra incidente y anote hora UTC, impacto, ambiente y responsable.
2. Consulte health/readiness, `docker compose ps`, métricas VPS y logs JSON por `request_id`. No incluya cookies, tokens, PIN ni documentos en el ticket.
3. Clasifique: disponibilidad, backup, disco, cola, ClamAV, certificado o seguridad. Preservar evidencia tiene prioridad sobre reinicios repetidos.
4. Si sospecha secreto comprometido, bloquee acceso y rote fuera del repositorio; no pegue secretos en consola ni ticket.

## Acciones por señal

- Readiness API/worker: revise PostgreSQL y logs; no publique tráfico nuevo si sigue fallando.
- Disco >80 %: detenga promociones y amplíe capacidad; no borre volumen PostgreSQL ni backups para liberar espacio.
- Backup fallido: valide conectividad, permisos de `/backups` y checksum; escale si se supera RPO.
- Cola atrasada: confirme readiness del worker y consulte conteos por cola/estado
  con [operacion-jobs-backup.md](operacion-jobs-backup.md). No edite tablas
  `pgboss` ni reencole manualmente sin identificar idempotencia e impacto.
- ClamAV no saludable o firmas antiguas: suspenda publicación de documentos y mantenga cuarentena hasta recuperación y revisión del dueño worker/API.
- Errores 5xx sostenidos o promoción fallida: aplique rollback compatible.

## Cierre

Registre línea temporal, impacto, `request_id`, digest, acciones reversibles, verificación y seguimiento. Restauración o secreto requieren revisión posterior.
