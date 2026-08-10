#!/bin/sh
set -eu
umask 077

usage() {
  echo "Uso: $0 capture|rollback ENV_FILE COMPOSE_FILE STATE_DIR [--apply]" >&2
  exit 64
}

[ "$#" -ge 4 ] || usage
mode="$1"
env_file="$2"
compose_file="$3"
state_dir="$4"
apply="${5:-}"
workspace="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"

case "$(CDPATH= cd -- "$(dirname "$state_dir")" 2>/dev/null && pwd)/$(basename "$state_dir")" in
  "$workspace"|"$workspace"/*)
    echo "STATE_DIR debe estar fuera del repositorio porque contiene secretos." >&2
    exit 64
    ;;
esac

image_refs() {
  sed -n 's/^\(VICAM_\(API\|WORKER\|WEB\|BACKUP\)_IMAGE\)=\(.*\)$/\1=\3/p' "$1"
}

validate_images() {
  image_refs "$1" | while IFS='=' read -r name reference; do
    printf '%s' "$reference" | grep -Eq '^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.\/-]+@sha256:[a-f0-9]{64}$' ||
      { echo "$name no está fijada por digest GHCR." >&2; exit 65; }
  done
  [ "$(image_refs "$1" | wc -l | tr -d ' ')" -eq 4 ] ||
    { echo "Se requieren cuatro referencias de imagen." >&2; exit 65; }
}

require_clean_candidate() {
  git -C "$workspace" diff --quiet -- &&
    git -C "$workspace" diff --cached --quiet -- ||
    { echo "El candidato tiene cambios rastreados sin commit." >&2; exit 65; }
  [ -z "$(git -C "$workspace" ls-files --others --exclude-standard)" ] ||
    { echo "El candidato contiene archivos no rastreados; cree el commit antes de capturar o validar rollback." >&2; exit 65; }
}

case "$mode" in
  capture)
    [ "$apply" = "" ] || usage
    [ -f "$env_file" ] && [ -f "$compose_file" ] || usage
    [ ! -e "$state_dir" ] || { echo "STATE_DIR ya existe; no se sobrescribe." >&2; exit 65; }
    require_clean_candidate
    validate_images "$env_file"
    mkdir -m 700 "$state_dir"
    cp "$env_file" "$state_dir/release.env"
    chmod 600 "$state_dir/release.env"
    {
      printf 'git_commit=%s\n' "$(git -C "$workspace" rev-parse HEAD)"
      printf 'compose_file=%s\n' "$compose_file"
      printf 'compose_sha256=%s\n' "$(sha256sum "$compose_file" | awk '{print $1}')"
      printf 'caddy_sha256=%s\n' "$(sha256sum "$workspace/infra/caddy/Caddyfile.tls" | awk '{print $1}')"
      printf 'env_sha256=%s\n' "$(sha256sum "$state_dir/release.env" | awk '{print $1}')"
      image_refs "$env_file"
    } >"$state_dir/manifest"
    chmod 600 "$state_dir/manifest"
    printf '{"event":"release_state_captured","stateDir":"%s"}\n' "$state_dir"
    ;;
  rollback)
    [ -f "$state_dir/release.env" ] && [ -f "$state_dir/manifest" ] || usage
    require_clean_candidate
    validate_images "$state_dir/release.env"
    expected_commit="$(sed -n 's/^git_commit=//p' "$state_dir/manifest")"
    expected_compose="$(sed -n 's/^compose_sha256=//p' "$state_dir/manifest")"
    expected_caddy="$(sed -n 's/^caddy_sha256=//p' "$state_dir/manifest")"
    expected_env="$(sed -n 's/^env_sha256=//p' "$state_dir/manifest")"
    [ "$(git -C "$workspace" rev-parse HEAD)" = "$expected_commit" ] ||
      { echo "Checkout manual requerido al commit $expected_commit antes del rollback." >&2; exit 65; }
    [ "$(sha256sum "$compose_file" | awk '{print $1}')" = "$expected_compose" ] ||
      { echo "Compose no coincide con el estado capturado." >&2; exit 65; }
    [ "$(sha256sum "$workspace/infra/caddy/Caddyfile.tls" | awk '{print $1}')" = "$expected_caddy" ] ||
      { echo "Caddyfile no coincide con el estado capturado." >&2; exit 65; }
    [ "$(sha256sum "$state_dir/release.env" | awk '{print $1}')" = "$expected_env" ] ||
      { echo "El snapshot de entorno cambió." >&2; exit 65; }
    docker compose --env-file "$state_dir/release.env" -f "$compose_file" config --quiet
    if [ "$apply" != "--apply" ]; then
      printf '{"event":"release_rollback_validated","apply":false,"gitCommit":"%s"}\n' "$expected_commit"
      exit 0
    fi
    backup="${env_file}.pre-rollback.$(date -u +%Y%m%dT%H%M%SZ)"
    cp "$env_file" "$backup"
    chmod 600 "$backup"
    temporary="${env_file}.rollback.$$"
    cp "$state_dir/release.env" "$temporary"
    chmod 600 "$temporary"
    mv "$temporary" "$env_file"
    if ! docker compose --env-file "$env_file" -f "$compose_file" up -d --wait; then
      echo "Rollback no quedó saludable; preserve evidencia y use $backup." >&2
      exit 1
    fi
    printf '{"event":"release_rollback_applied","previousEnv":"%s","gitCommit":"%s"}\n' \
      "$backup" "$expected_commit"
    ;;
  *) usage ;;
esac
