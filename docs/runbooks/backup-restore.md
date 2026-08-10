# Runbook: backup y restauración

El servicio `backup` ejecuta `pg_dump --format=custom` y crea un tar del volumen
documental al iniciar y cada 24 h. Antes de publicar crea SHA-256, ejecuta
`pg_restore --list` y valida el tar; un par incompleto o con checksum fallido no
es recuperable. Retención local predeterminada: 14 días. También publica
`/backups/backup-status`; cualquier fallo cambia el estado a `failed` y vuelve
no saludable el contenedor. Complementa, no reemplaza, backup diario y snapshot
pre-migración del proveedor (D-24/D-42).

## Verificar backup

```sh
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml logs --tail 100 backup
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml exec backup cat /backups/backup-status
docker compose --env-file /srv/vicam/staging.env -f compose.staging.yaml exec backup sh -c 'cd /backups && sha256sum -c vicam-AAAAmmddTHHMMSSZ.dump.sha256 && pg_restore --list vicam-AAAAmmddTHHMMSSZ.dump >/dev/null'
```

Seleccione el dump y el tar indicados por el mismo `backup-status`. No copie
backups al repositorio. La captura secuencial no es un snapshot atómico:
detenga temporalmente API y worker antes de reiniciar `backup`, o use una
capacidad de snapshot coherente del proveedor. Solo vuelva a habilitar
escrituras cuando ambos archivos y sus checksums estén publicados. Un
`pg_dump` correcto por sí solo no cumple la restauración integral.

## Ensayo trimestral en staging

1. Confirme que es staging con datos ficticios.
2. Pare `api` y `worker`; preserve el volumen actual como evidencia.
3. Cree base temporal vacía y restaure mediante `pg_restore --clean --if-exists --no-owner` usando dump validado.
4. Arranque servicios, consulte readiness y ejecute smoke/E2E de login, agenda y documento.
5. Registre duración, dump, checksum, resultado y desvíos de RPO/RTO.

Después del restore, verifique al menos un documento `AVAILABLE`, una
exportación y un archivo de importación contra su metadata; no exponga nombres
ni contenido en el registro del ensayo.

Restaurar producción exige autorización de incidente, ventana y comunicación. Nunca restaure un dump de producción en staging sin saneamiento.

Para automatizar la validación use `infra/scripts/backup-restore-test.sh`. El
script restaura a una DB temporal, valida migraciones, extensiones y conteos,
extrae el tar, y compara existencia y SHA-256 de cada documento activo contra
su metadata restaurada. Rechaza producción y elimina la base temporal al salir.
Detecta pares incoherentes, pero no vuelve atómica una captura con escritores
activos.
