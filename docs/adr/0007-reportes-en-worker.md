# ADR 0007: Reportes en segundo plano

Estado: aceptado. Fecha: 2026-07-21.

PDF y XLSX se generan en el worker con concurrencia PDF inicial de uno. Los
resultados expiran a los siete días y deben representar los mismos filtros y
datos. Fase 0 no registra handlers de reportes.

Aplica D-31 y D-32.
