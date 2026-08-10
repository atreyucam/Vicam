# ADR 0005: Sincronización idempotente

Estado: aceptado. Fecha: 2026-07-21.

La sincronización futura usa operaciones con `device_id`,
`client_operation_id`, secuencia y versión base. La unicidad servidor evita
duplicados y el change log usa cursor monótono. Conflictos del mismo campo no se
sobrescriben silenciosamente.

Fase 0 crea únicamente la base estructural; el protocolo y la PWA offline
pertenecen a Fase 2. Aplica D-16 a D-21 y D-72.
