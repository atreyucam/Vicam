#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-compose.staging.yaml}"
env_file="${ENV_FILE:-infra/env/staging.env.example}"
backup_file="${BACKUP_FILE:-}"
documents_file="${DOCUMENTS_FILE:-}"
restore_database="vicam_restore_$(date -u +%Y%m%d%H%M%S)_$$"

case "$restore_database" in
  vicam_restore_[0-9]*) ;;
  *) echo "Nombre de DB temporal inseguro." >&2; exit 64 ;;
esac

public_host="$(sed -n 's/^VICAM_PUBLIC_HOST=//p' "$env_file" | tail -1)"
database_name="$(sed -n 's/^VICAM_POSTGRES_DB=//p' "$env_file" | tail -1)"
case "${public_host}:${database_name}" in
  *app.vicamproduce.com:vicam_production|*production*|*prod*)
    echo "Este ensayo rechaza producción; use local o staging sintético." >&2
    exit 64
    ;;
esac

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

cleanup() {
  compose exec -T postgres sh -c \
    'dropdb --if-exists --force -U "$POSTGRES_USER" "$1"' _ "$restore_database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

compose config --quiet
compose ps --status running postgres backup >/dev/null
expected_migration_count="$(grep -c '"idx":' \
  "$(dirname "$0")/../../packages/db/migrations/meta/_journal.json")"
source_migration_count="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
   -c "select count(*) from drizzle.__drizzle_migrations;"')"
[ "$source_migration_count" = "$expected_migration_count" ] || {
  echo "La DB fuente no contiene todas las migraciones del candidato." >&2
  exit 1
}
source_counts="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -F "|" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
   -c "select (select count(*) from users),
              (select count(*) from commercial_accounts),
              (select count(*) from documents);"' )"

if [ -z "$backup_file" ]; then
  status="$(compose exec -T backup cat /backups/backup-status)"
  backup_file="$(printf '%s' "$status" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')"
  documents_file="$(printf '%s' "$status" | sed -n 's/.*"documents_file":"\([^"]*\)".*/\1/p')"
fi
case "$backup_file" in
  vicam-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.dump) ;;
  *) echo "BACKUP_FILE no tiene el formato permitido." >&2; exit 64 ;;
esac
case "${documents_file:-}" in
  vicam-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.documents.tar) ;;
  *) echo "El backup no contiene un archivo documental válido." >&2; exit 64 ;;
esac

compose exec -T backup sh -c \
  'cd /backups && sha256sum -c "$1.sha256" && pg_restore --list "$1" >/dev/null' _ "$backup_file"
compose exec -T backup sh -c '
  set -eu
  cd /backups
  sha256sum -c "$1.sha256"
  restore_dir="/tmp/documents-restore-$$"
  source_manifest="/tmp/documents-source-$$"
  restored_manifest="/tmp/documents-restored-$$"
  mkdir -p "$restore_dir"
  tar -xf "$1" -C "$restore_dir"
  (cd /documents && find . -type f -exec sha256sum {} \; | sort) >"$source_manifest"
  (cd "$restore_dir" && find . -type f -exec sha256sum {} \; | sort) >"$restored_manifest"
  diff "$source_manifest" "$restored_manifest"
  rm -rf "$restore_dir" "$source_manifest" "$restored_manifest"
' _ "$documents_file"

started_epoch="$(date +%s)"
compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" "$1"' _ "$restore_database"
compose exec -T backup sh -c 'cat "/backups/$1"' _ "$backup_file" |
  compose exec -T postgres sh -c \
    'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$1"' _ \
    "$restore_database"

validation="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$1" -c "
   select json_build_object(
     '\''users'\'', (select count(*) from users),
     '\''accounts'\'', (select count(*) from commercial_accounts),
     '\''migrations'\'', (select count(*) from drizzle.__drizzle_migrations),
     '\''unaccent'\'', exists(select 1 from pg_extension where extname='\''unaccent'\''),
     '\''pg_trgm'\'', exists(select 1 from pg_extension where extname='\''pg_trgm'\'')
   );"' _ "$restore_database")"
restored_migration_count="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$1" \
   -c "select count(*) from drizzle.__drizzle_migrations;"' _ "$restore_database")"
[ "$restored_migration_count" = "$source_migration_count" ] || {
  echo "El dump restaurado no coincide con las migraciones de la DB fuente." >&2
  exit 1
}
restored_counts="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -F "|" -U "$POSTGRES_USER" -d "$1" \
   -c "select (select count(*) from users),
              (select count(*) from commercial_accounts),
              (select count(*) from documents);"' _ "$restore_database")"
[ "$restored_counts" = "$source_counts" ] || {
  echo "Los conteos restaurados de usuarios, cuentas o documentos no coinciden con la fuente." >&2
  exit 1
}
extensions_ok="$(compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$1" \
   -c "select exists(select 1 from pg_extension where extname='\''unaccent'\'')
              and exists(select 1 from pg_extension where extname='\''pg_trgm'\'');"' _ \
  "$restore_database")"
[ "$extensions_ok" = "t" ] || {
  echo "El restore no contiene las extensiones PostgreSQL obligatorias." >&2
  exit 1
}
compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -At -F "|" -U "$POSTGRES_USER" -d "$1" \
   -c "select storage_key,checksum_sha256
       from documents
       where status in ('\''QUARANTINED'\'','\''SCANNING'\'','\''AVAILABLE'\'')
       order by storage_key;"' _ "$restore_database" |
  compose exec -T backup sh -c '
    set -eu
    restore_dir="/tmp/documents-db-check-$$"
    mkdir -p "$restore_dir"
    trap '\''rm -rf "$restore_dir"'\'' EXIT INT TERM
    tar -xf "/backups/$1" -C "$restore_dir"
    while IFS="|" read -r storage_key expected_checksum; do
      [ -n "$storage_key" ] || continue
      case "$storage_key" in
        /*|*..*|*[!A-Za-z0-9._/-]*) echo "storage_key inseguro en restore." >&2; exit 1 ;;
      esac
      restored_file="$restore_dir/documents/$storage_key"
      [ -f "$restored_file" ] || {
        echo "Falta el archivo restaurado para storage_key=$storage_key." >&2
        exit 1
      }
      [ "$(sha256sum "$restored_file" | awk '\''{print $1}'\'')" = "$expected_checksum" ] || {
        echo "Checksum documental no coincide para storage_key=$storage_key." >&2
        exit 1
      }
    done
  ' _ "$documents_file"
duration="$(( $(date +%s) - started_epoch ))"

printf '{"event":"restore_test_ok","at":"%s","backup":"%s","documentsBackup":"%s","temporaryDatabase":"%s","durationSeconds":%s,"validation":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_file" "$documents_file" \
  "$restore_database" "$duration" "$validation"
