# Runbook: rollback

## Rollback de aplicación sin migración destructiva

1. Detenga la promoción y preserve logs, hora, `request_id` y digest fallido.
2. Verifique que la migración aplicada es compatible con la imagen anterior.
3. Sustituya en el archivo de entorno los cuatro `VICAM_*_IMAGE` por los digests previos registrados.
4. Ejecute `docker compose --env-file /srv/vicam/<ambiente>.env -f compose.<ambiente>.yaml up -d --wait`.
5. Compruebe health, readiness, logs JSON, estado de backup y conteos de cola
   antes del smoke mínimo.

No elimine `documents_data`, volúmenes de base, imágenes ni backups. No revierta
automáticamente una migración SQL que pueda perder datos: aplique forward-fix o
siga el runbook de restore. Volver la imagen no revierte archivos que un job ya
haya purgado.

`infra/scripts/release-state.sh` captura fuera del repositorio el entorno
protegido, commit y checksums de Compose/Caddy. `rollback` valida sin cambios por
defecto; `--apply` exige que el operador ya haya cambiado al commit capturado,
conserva el entorno actual y espera healthchecks. Ejecute smoke después.
Tanto `capture` como `rollback` rechazan cambios rastreados, staged o archivos
no rastreados: el estado solo puede vincularse a un candidato íntegramente
representado por un commit.

## Criterio para restore

Use restore ante corrupción, borrado o migración incompatible. Mantenga servicios de escritura detenidos y siga [backup-restore.md](backup-restore.md). RPO aproximado: 24 h; RTO objetivo: 4 h.
