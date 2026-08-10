# ADR 0006: Documentos únicamente online

Estado: aceptado. Fecha: 2026-07-21.

Solo se admiten PDF, DOCX y XLSX de hasta 10 MB. Los bytes viven en volumen
privado, nunca en la cola offline, y se publican solo después de cuarentena y
ClamAV. No se admiten imágenes ni fotografías.

Fase 0 reserva metadata y constraints; uploads y ClamAV pertenecen a Fase 3.
Aplica D-21, D-27, D-30 y D-68.
