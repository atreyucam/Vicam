# Denylist de contraseñas comprometidas

La versión activa es `vicam-compromised-passwords-v2`. La API compara localmente la contraseña normalizada con NFKC y minúsculas contra un filtro Bloom versionado. No hace consultas de red, no registra la contraseña y no distribuye el texto plano de la lista. V2 conserva además las 25 huellas exactas de V1 para no perder cobertura anterior.

## Fuente y licencia

V2 procesa las 10.000 entradas de `Passwords/Common-Credentials/Pwdb_top-10000.txt` de SecLists release `2026.1`, commit `190c6f7bd58c847ceadfe57d9853592737f059e8`; tras normalizar y deduplicar quedan 9.789 valores. SHA-256 del archivo fuente: `a85ecac41cfbbdbb0e0b8ca6b3d7f9b9b8084089cfba70553c7fd42d9738f795`. SecLists se publica bajo licencia MIT: <https://github.com/danielmiessler/SecLists/blob/190c6f7bd58c847ceadfe57d9853592737f059e8/LICENSE>.

El artefacto versionado contiene un filtro de 262.144 bits y siete posiciones derivadas de SHA-256. Esto mantiene el repositorio compacto y evita distribuir el corpus en texto plano. Puede producir falsos positivos con probabilidad baja; no produce falsos negativos para las 10.000 entradas procesadas. La validación sigue siendo completamente local y determinista.

## Actualización offline

1. El responsable de seguridad descarga y revisa una fuente fuera del proceso de la API, fija commit/versión, checksum y licencia.
2. Guarda temporalmente una selección local, una contraseña por línea, fuera del repositorio.
3. Ejecuta `node scripts/build-compromised-password-denylist.mjs <archivo-local> > src/auth/compromised-password-denylist-vN.ts` desde `apps/api`. El script solo lee disco y escribe el módulo Bloom a stdout; no contiene cliente de red.
4. Revisa el módulo TypeScript generado, actualiza la versión y registra aquí fuente, revisión, checksum, licencia, fecha, parámetros Bloom y número de entradas.
5. Ejecuta pruebas de normalización, rechazo, ausencia de texto plano y determinismo. La versión anterior se conserva hasta desplegar y verificar la nueva.

No se acepta una actualización flotante durante el arranque ni una dependencia de servicios externos para validar contraseñas.
