# ADR 0003: Drizzle y migraciones SQL

Estado: aceptado. Fecha: 2026-07-21.

`packages/db` es el único paquete de base de datos. Drizzle define el esquema y
ejecuta SQL versionado y revisable. `drizzle push` está prohibido en staging y
producción; los cambios destructivos usan expand/contract y forward-fix.

Aplica D-47 y la nomenclatura canónica aprobada en `PLANS.md`.
