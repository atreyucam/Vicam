# ADR 0001: Monolito modular

Estado: aceptado. Fecha: 2026-07-21.

VICAM se implementa como monorepo pnpm y monolito modular TypeScript con web,
API y worker desplegables por separado. Esta decisión aplica D-23, D-46 y
D-49; evita microservicios y Redis en el MVP.

Los módulos comparten contratos, pero conservan límites de dominio y propiedad
de carpetas. La evolución a servicios separados requiere evidencia de carga.
