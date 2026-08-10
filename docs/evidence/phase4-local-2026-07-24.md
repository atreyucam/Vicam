# Evidencia local de Fase 4

Fecha de ejecución: 2026-07-24/25, zona `America/Guayaquil`.

Esta evidencia valida el candidato en infraestructura local. No representa un
despliegue a staging o producción ni sustituye el piloto y las aprobaciones
humanas.

## Calidad y seguridad

- `pnpm format`: correcto.
- `pnpm lint`: correcto, cero advertencias.
- `pnpm typecheck`: correcto.
- `pnpm test`: correcto.
  - contratos: 2/2;
  - DB unitarias: 18/18, 8 de integración omitidas en esta orden;
  - UI: 6/6;
  - web: 63/63;
  - worker: 11/11;
  - API unitarias: 28/28, 24 de integración omitidas en esta orden.
- migraciones PostgreSQL 18 con Testcontainers: 4/4.
- integración API/DB de Fases 1 a 4: 24/24, serializada por archivo para no
  competir por recursos entre cuatro PostgreSQL Testcontainers. El escenario
  interno de Fase 4 conserva 12 solicitudes concurrentes.
- `pnpm build`: correcto. El JavaScript inicial mide 249,80 kB (77,42 kB gzip).
  MapLibre queda bajo demanda en un chunk de 949,15 kB y conserva la
  advertencia de tamaño mayor a 500 kB.
- `pnpm audit --prod`: cero vulnerabilidades conocidas.

## Web, PWA y accesibilidad

- corrida Playwright completa: 125/125 en 4,6 minutos.
- suite adicional contra Compose, Caddy, API, PostgreSQL, worker y ClamAV
  reales: 6/6 en 5,3 minutos, a 360, 768 y 1440 px; cubre Fase 1, PWA offline,
  carga documental multipart, reporte PDF hasta descarga válida e importación
  hasta `COMPLETED`, reintento idempotente y efecto persistido único.
- Fase 4 responsive/PWA: 10/10.
- flujo estructurado offline obligatorio: 5/5.
- viewports: 360, 390, 768, 1366 y 1440 px.
- rollback por feature flag a modo online-only: 2/2.
- Lighthouse local:
  - rendimiento: 97;
  - accesibilidad: 100;
  - buenas prácticas: 100;
  - FCP: 2,0 s;
  - LCP: 2,3 s;
  - TBT: 60 ms;
  - CLS: 0.
- El detalle de cuenta no intenta cargar MapLibre sin conexión; muestra un
  estado offline y conserva visibles las coordenadas estructuradas.

## Operación y recuperación

- gateway, API live/ready, shell, smoke y monitor local: correctos.
- Compose local: PostgreSQL, API, worker, web, Caddy, ClamAV y backup
  saludables.
- Caddy TLS: configuración válida con variables ficticias.
- Compose staging y producción: `config --quiet` correcto con variables y
  digests ficticios.
- la imagen web es independiente del ambiente: offline, VAPID pública y
  MapLibre se inyectan al iniciar mediante `runtime/config.js` no cacheable,
  dentro de un `tmpfs` de 1 MB y con el resto del contenedor de solo lectura.
- se recreó el contenedor con offline activo/inactivo conservando exactamente
  la imagen `sha256:2205ea29...8ae0cff`; `/runtime/config.js` cambió en runtime
  sin rebuild.
- ClamAV: ping correcto y EICAR detectado tanto por stream como mediante el
  flujo integrado de carga. El documento terminó `REJECTED`, con descarga 404.
- backup con checksum de DB y documentos, seguido de restore temporal:
  correcto en 13 segundos con API y worker detenidos durante la captura.
- restore validó 3 usuarios, 119 cuentas, 8 migraciones, `unaccent`, `pg_trgm`,
  conteos fuente/restaurado y cada archivo documental activo contra su SHA-256.
- captura y rollback rechazan correctamente el candidato actual porque todavía
  contiene cambios sin commit. El dry-run sobre un candidato limpio y digests
  reales queda pendiente hasta la autorización del commit; no se aplicó ni
  desplegó ninguna imagen.
- Compose local quedó saludable con PostgreSQL publicado en el puerto alterno
  55432 y Caddy en 28080 porque servicios externos del equipo ocupaban
  5432/8080.

## Capacidad

Dataset sintético cargado en una DB temporal y luego eliminado:

- 100.000 cuentas;
- 500.000 visitas;
- 500.000 tareas;
- 381,56 segundos de carga con los índices de paginación activos.

Prueba completa de cinco minutos con 20 VUs concurrentes compartiendo una
identidad Manager (mide concurrencia HTTP, no 20 identidades distintas):

- comprobaciones: 3.740/3.740;
- errores HTTP y de negocio: 0 %;
- 100 operaciones sync: 3,15 segundos;
- CRUD p95: 199,25 ms, puerta local `<400 ms` cumplida;
- búsqueda p95: 369,32 ms, puerta local `<700 ms` cumplida.

Después se ejecutó una prueba semántica corta adicional: 100 operaciones se
aplicaron en 1,85 segundos, el reintento devolvió 100 `DUPLICATE` y la consulta
confirmó exactamente 100 efectos persistidos; 88/88 comprobaciones quedaron
verdes. La puerta funcional y de latencia queda verde en local. La validación
integral D-76, incluidos almacenamiento objetivo, usuarios externos y
telemetría de CPU, RAM, disco, conexiones, WAL y colas, debe repetirse en
staging antes del piloto.

## Puertas externas pendientes

- repositorio/GHCR y cuatro digests reales;
- staging, DNS, TLS y monitor externo reales;
- scans de imágenes publicados;
- prueba de carga y telemetría verde en staging;
- dispositivos reales;
- piloto de una semana con Manager y Supervisor;
- responsables, ventana y autorización explícita de producción.
