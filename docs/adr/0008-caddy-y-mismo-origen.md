# ADR 0008: Caddy y mismo origen

Estado: aceptado. Fecha: 2026-07-21.

Caddy es el único gateway público. Sirve la web y reenvía `/api/v1` a la API,
manteniendo mismo origen. PostgreSQL, API y worker permanecen privados. El
Compose de Fase 0 es exclusivamente local y usa HTTP loopback.

TLS, HSTS, DNS y producción quedan para la fase operativa. Aplica D-22 y D-50.
