# Checklist de preparación y salida a producción

Este documento prepara la aprobación; no autoriza ni ejecuta un despliegue.

## Propiedad y acceso

- [ ] Repositorio/GHCR, DNS, VPS, release, backup, seguridad y soporte tienen dueño.
- [ ] SSH con llave validado; root por contraseña deshabilitado después de probar acceso.
- [ ] UFW/Hostinger: 80/443 públicos, 22 restringido; DB/worker/ClamAV privados.
- [ ] Secretos únicos de producción almacenados fuera del repositorio.
- [ ] VAPID, MapTiler y CSP son exclusivos/restringidos al hostname productivo.

## Candidato

- [ ] Release SemVer etiquetada, changelog y commit aprobados.
- [ ] Imágenes API/worker/web/backup fijadas por digest y escaneadas.
- [ ] Misma imagen validada en staging; sin rebuild para producción.
- [ ] Migraciones SQL revisadas, expand/contract y forward-fix preparado.
- [ ] Imagen/config anterior capturada con `release-state.sh`.

## Recuperación y capacidad

- [ ] Backup Hostinger diario activo y snapshot pre-migración planificado.
- [ ] `pg_dump` reciente con checksum/listado correcto.
- [ ] Restore trimestral DB+documentos probado; RPO 24 h/RTO 4 h medidos.
- [ ] Digest anterior disponible y rollback compatible con esquema.
- [ ] Disco libre >20 % y reservas DB/documentos/backups verificadas.
- [ ] Riesgo de VPS único y ausencia de copia automática externa aceptados.
- [ ] Pico ClamAV medido; memoria total no excede margen seguro.

## Calidad y operación

- [ ] CI completo, E2E, PWA, Lighthouse, axe, teclado y dispositivos reales verdes.
- [ ] k6: CRUD/search/sync/error dentro de puertas con dataset D-76.
- [ ] Health/readiness, logs JSON redactados y rotación verificados.
- [ ] Monitor externo/TLS y alertas disco, backup, cola, ClamAV y 5xx probadas.
- [ ] Runbooks deploy, rollback, restore, incidente y jobs ensayados.
- [ ] Piloto de una semana aprobado; proceso anterior disponible durante transición.

## Ventana autorizada

- [ ] Aprobación humana explícita y responsables presentes.
- [ ] Ventana/comunicación y criterio de abortar definidos.
- [ ] Snapshot y backup confirmados inmediatamente antes.
- [ ] Migración one-shot; nunca `drizzle push`.
- [ ] `up -d --wait`, smoke autenticado y ClamAV controlado.
- [ ] Login, cuenta, agenda, documento, reporte, backup, cola y monitor verificados.
- [ ] Evidencia final y decisión de continuar o rollback registrada.
