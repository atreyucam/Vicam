# ADR 0011: Cifrado y purga de datos offline

- Estado: Aprobado para Fase 2
- Fecha: 2026-07-22
- Decisiones relacionadas: D-16 a D-21, D-28, D-51, D-54, D-60, D-72, D-75

## Contexto

VICAM permite trabajar hasta 72 horas sin conexión con datos estructurados mínimos. Un PIN de seis dígitos no aporta entropía suficiente para cifrar esos datos directamente y el almacenamiento del navegador puede copiarse fuera del dispositivo.

## Decisión

Al autorizar un dispositivo se genera con Web Crypto una clave de datos (DEK) AES-GCM de 256 bits. La DEK cifra cada registro con IV aleatorio y datos autenticados que incluyen almacén, identificador y versión de esquema. El PIN normalizado deriva mediante PBKDF2-SHA-256, salt aleatorio por autorización y un número de iteraciones versionado una clave de envoltura (KEK). La KEK solo envuelve la DEK y nunca cifra datos de aplicación directamente.

No se persisten el PIN, la KEK ni una DEK en texto plano. Durante una sesión desbloqueada la DEK permanece como `CryptoKey` no exportable cuando el navegador lo permite. La DEK envuelta, salt, parámetros KDF, IV y versión criptográfica pueden persistirse. Los índices sin cifrar se limitan a identificadores opacos, secuencia, estado de cola, tipo de entidad y marcas temporales necesarias.

Un candado único entre pestañas usa Web Locks y `BroadcastChannel`; si Web Locks no existe, una concesión en IndexedDB con vencimiento corto evita procesos concurrentes. El contador de PIN se actualiza bajo el mismo candado. Cinco intentos fallidos purgan IndexedDB, Cache Storage, clave envuelta y cola. La misma purga ocurre al expirar 72 horas, cerrar sesión, revocar sesión/dispositivo, perder ownership o recibir una orden de purga en pull.

El service worker solo precachea shell y estáticos versionados. No aplica caché genérica a `/api`, autenticación, descargas ni documentos y respeta `Cache-Control: no-store`. La sincronización no depende de Background Sync: también se activa al abrir, reconectar, volver a primer plano, cumplir el intervalo y por acción manual.

## Amenazas y limitaciones

- El cifrado reduce exposición en reposo, pero no protege un navegador o sistema operativo ya comprometido durante una sesión desbloqueada.
- Un PIN de seis dígitos sigue siendo débil; PBKDF2 y el límite de cinco intentos elevan el coste, pero no sustituyen autenticación online.
- La purga en revocación requiere que el dispositivo vuelva a contactar al servidor. La autorización local expira por sí sola a las 72 horas.
- No entran en almacenamiento offline documentos, imágenes, cookies, refresh tokens ni respuestas de autenticación.

## Verificación

Pruebas unitarias verifican cifrado autenticado, salt/IV únicos, PIN erróneo, concurrencia y purgas. Playwright verifica logout, expiración, cinco fallos, revocación, dos pestañas, exclusión documental y actualización segura del service worker.
