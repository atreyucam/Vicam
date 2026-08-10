# ADR 0002: Sesiones y recuperación

Estado: aceptado. Fecha: 2026-07-21.

Las contraseñas usan Argon2id. El access token vive en memoria durante 15
minutos y el refresh opaco rota en cookie HttpOnly hasta siete días. Supervisor
se recupera mediante Manager y Manager mediante CLI administrativa auditada.

La autenticación funcional se implementa en Fase 1; Fase 0 aporta contratos y
la primitiva de hash, verificación y rehash. Aplica D-25, D-28, D-53 y D-67.
