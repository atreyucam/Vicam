# ADR 0009: Recuperación en VPS único

Estado: aceptado. Fecha: 2026-07-21.

El objetivo futuro combina backup diario de Hostinger, `pg_dump`, snapshot
previo a migraciones y restauración trimestral, con RPO aproximado de 24 horas
y RTO de cuatro horas. Se acepta el riesgo de no tener alta disponibilidad ni
copia automática en otro proveedor.

Fase 0 no conecta al VPS ni ejecuta backups. Aplica D-24 y D-42.
