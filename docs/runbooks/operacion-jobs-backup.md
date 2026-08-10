# Runbook: observabilidad de jobs y backup

Procedimiento de solo lectura para staging o producción. No muestra payloads,
documentos, tokens ni datos comerciales. Use el archivo de entorno protegido
del ambiente y no copie su contenido a tickets.

## Estado general

```sh
docker compose --env-file /srv/vicam/<ambiente>.env -f compose.<ambiente>.yaml ps
docker compose --env-file /srv/vicam/<ambiente>.env -f compose.<ambiente>.yaml logs --since 30m --tail 500 worker backup
docker compose --env-file /srv/vicam/<ambiente>.env -f compose.<ambiente>.yaml exec backup cat /backups/backup-status
```

Los logs deben ser JSON. Para worker se esperan `jobId`, tipo, duración y
resultado, nunca `job.data`. Para backup se esperan `backup_completed` con
duración/checksum o `backup_failed` sin credenciales.

## Cola pg-boss

La consulta es agregada y de solo lectura:

```sh
docker compose --env-file /srv/vicam/<ambiente>.env -f compose.<ambiente>.yaml exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "
   select name, state, count(*) as jobs,
          min(created_on) as oldest_created,
          min(start_after) filter (where state in ('\''created'\'','\''retry'\'')) as oldest_pending
   from pgboss.job
   group by name, state
   order by name, state;"'
```

Señales mínimas:

- readiness del worker distinta de 200;
- crecimiento sostenido de `created`/`retry`;
- cualquier `failed` que no se recupere según reintentos;
- trabajo pendiente cuya antigüedad supere el SLA operativo del tipo de job;
- documentos en cuarentena sin avance, reportes/importaciones atascados o
  recordatorios vencidos;
- backup en `failed` o estado correcto con más de
  `VICAM_BACKUP_HEALTH_MAX_AGE_MINUTES`;
- disco del VPS por encima de 80 %.

## Diagnóstico reversible

1. Registre UTC, ambiente, digest, cola/estado, conteo y job IDs necesarios; no
   registre payload.
2. Confirme PostgreSQL, ClamAV, espacio en disco y readiness antes de reiniciar.
3. Un reinicio único de worker es reversible; observe si la cola vuelve a
   avanzar. Evite ciclos de reinicio.
4. No ejecute `delete`, `update`, `truncate`, `pgboss` CLI destructivo ni
   reencolado manual durante diagnóstico.
5. Si se requiere replay, cancelación o limpieza, el dueño backend debe
   confirmar idempotencia, retención e impacto y dejar evidencia auditada.

## Backup fallido

1. Consulte `backup-status` y el evento JSON más reciente.
2. Verifique salud de PostgreSQL, permisos del volumen `backups_data` y espacio.
3. Tras corregir la causa, reinicie solo `backup`; su primera acción es un dump
   nuevo.
4. Verifique checksum y `pg_restore --list` según
   [backup-restore.md](backup-restore.md).
5. Escale antes de superar RPO 24 h. El dump no cubre `documents_data`; confirme
   también el mecanismo separado de snapshot/copia del volumen privado.
