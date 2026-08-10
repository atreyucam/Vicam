# ADR 0004: pg-boss sin Redis

Estado: aceptado. Fecha: 2026-07-21.

Los trabajos asíncronos usan pg-boss sobre PostgreSQL y un proceso worker
separado. Redis no forma parte del MVP. Fase 0 arranca la cola sin registrar
handlers de negocio; estos se añaden en sus fases propietarias.

Aplica D-48 y reduce operación en el VPS único.
