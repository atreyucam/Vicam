# Confianza de proxy para Caddy

`CADDY_TRUSTED_PROXIES` es una lista de direcciones o CIDR separada por comas. Debe contener únicamente la IP o subred privada desde la que Caddy conecta a la API. Producción exige la variable explícita y rechaza `*`, `0.0.0.0/0` y `::/0`.

Express solo interpreta `X-Forwarded-For` y `X-Forwarded-Proto` cuando el salto inmediato pertenece a esa lista. Por ello, una conexión directa no puede falsificar la IP usada por rate limiting/auditoría ni declararse HTTPS. Los endpoints que emiten o rotan cookies rechazan transporte no seguro en producción; las cookies de producción siempre incluyen `Secure`, `HttpOnly` para refresh y `SameSite=Lax`.

Ejemplo para una red Docker dedicada: `CADDY_TRUSTED_PROXIES=172.28.0.0/24`. La subred real debe verificarse durante el despliegue; no se debe copiar este ejemplo sin comprobarla.
