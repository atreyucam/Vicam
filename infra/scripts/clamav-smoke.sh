#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-compose.yaml}"
env_file="${ENV_FILE:-infra/env/local.env.example}"

log() {
  printf '{"event":"%s","at":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

docker compose --env-file "$env_file" -f "$compose_file" exec -T clamav \
  clamdscan --ping 1 --config-file=/etc/clamav/clamd.conf >/dev/null

# EICAR es una cadena de prueba estándar, no malware. Se transmite por stdin y
# no se guarda en el repositorio ni en el volumen de documentos.
if printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' |
  docker compose --env-file "$env_file" -f "$compose_file" exec -T clamav \
    clamdscan --stream --config-file=/etc/clamav/clamd.conf - 2>&1 |
  grep -Eq 'Eicar(-Test)?-Signature FOUND'; then
  log "clamav_smoke_ok"
else
  log "clamav_smoke_failed" >&2
  exit 1
fi
