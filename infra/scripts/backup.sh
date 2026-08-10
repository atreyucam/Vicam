#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

backup_directory=/backups
retention_days="${BACKUP_RETENTION_DAYS:-14}"
interval_seconds="${BACKUP_INTERVAL_SECONDS:-86400}"
status_file="$backup_directory/backup-status"

case "$retention_days" in *[!0-9]*|'') echo 'backup retention must be a whole number' >&2; exit 64;; esac
case "$interval_seconds" in *[!0-9]*|'') echo 'backup interval must be a whole number' >&2; exit 64;; esac

umask 077
mkdir -p "$backup_directory"

backup_once() {
  started_epoch="$(date +%s)"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  temporary_file="$backup_directory/.vicam-${timestamp}.dump.tmp"
  final_file="$backup_directory/vicam-${timestamp}.dump"
  temporary_documents="$backup_directory/.vicam-${timestamp}.documents.tar.tmp"
  final_documents="$backup_directory/vicam-${timestamp}.documents.tar"
  temporary_status="$backup_directory/.backup-status.tmp"

  rm -f "$temporary_file" "$temporary_documents" "$temporary_status"
  if ! pg_dump --format=custom --file="$temporary_file" --no-owner --no-privileges; then
    rm -f "$temporary_file"
    return 1
  fi
  if ! pg_restore --list "$temporary_file" >/dev/null; then
    rm -f "$temporary_file"
    return 1
  fi
  if ! tar -C /documents -cf "$temporary_documents" .; then
    rm -f "$temporary_file" "$temporary_documents"
    return 1
  fi
  if ! tar -tf "$temporary_documents" >/dev/null; then
    rm -f "$temporary_file" "$temporary_documents"
    return 1
  fi
  checksum="$(sha256sum "$temporary_file" | awk '{print $1}')"
  documents_checksum="$(sha256sum "$temporary_documents" | awk '{print $1}')"
  if ! mv "$temporary_file" "$final_file"; then
    rm -f "$temporary_file" "$temporary_documents"
    return 1
  fi
  if ! mv "$temporary_documents" "$final_documents"; then
    rm -f "$temporary_documents" "$final_file"
    return 1
  fi
  if ! printf '%s  %s\n' "$checksum" "$(basename "$final_file")" >"$final_file.sha256"; then
    return 1
  fi
  if ! printf '%s  %s\n' "$documents_checksum" "$(basename "$final_documents")" \
    >"$final_documents.sha256"; then
    return 1
  fi
  find "$backup_directory" -type f \
    \( -name 'vicam-*.dump' -o -name 'vicam-*.dump.sha256' \
       -o -name 'vicam-*.documents.tar' -o -name 'vicam-*.documents.tar.sha256' \) \
    -mtime "+$retention_days" -delete
  duration_seconds="$(( $(date +%s) - started_epoch ))"
  printf '{"status":"ok","completed_at":"%s","file":"%s","sha256":"%s","documents_file":"%s","documents_sha256":"%s","duration_seconds":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$final_file")" "$checksum" \
    "$(basename "$final_documents")" "$documents_checksum" "$duration_seconds" \
    >"$temporary_status"
  mv "$temporary_status" "$status_file"
  printf '{"event":"backup_completed","file":"%s","sha256":"%s","documents_file":"%s","documents_sha256":"%s","duration_seconds":%s}\n' \
    "$(basename "$final_file")" "$checksum" "$(basename "$final_documents")" \
    "$documents_checksum" "$duration_seconds"
}

while true; do
  if ! backup_once; then
    failure_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"status":"failed","failed_at":"%s"}\n' "$failure_time" >"$status_file"
    printf '{"event":"backup_failed","failed_at":"%s"}\n' "$failure_time" >&2
  fi
  sleep "$interval_seconds"
done
