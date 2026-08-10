CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE TYPE user_role AS ENUM ('MANAGER', 'SUPERVISOR');--> statement-breakpoint
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE device_status AS ENUM ('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE account_status AS ENUM ('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE visit_status AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE task_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE priority AS ENUM ('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE document_status AS ENUM ('QUARANTINED', 'SCANNING', 'AVAILABLE', 'REJECTED', 'DELETED');--> statement-breakpoint
CREATE TYPE document_format AS ENUM ('PDF', 'DOCX', 'XLSX');--> statement-breakpoint
CREATE TYPE sync_operation_status AS ENUM ('RECEIVED', 'APPLIED', 'REJECTED', 'CONFLICT');--> statement-breakpoint
CREATE TYPE sync_conflict_status AS ENUM ('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE change_operation AS ENUM ('UPSERT', 'DELETE', 'REVOKE');--> statement-breakpoint

CREATE TABLE users (
  id uuid PRIMARY KEY, username varchar(100) NOT NULL, full_name varchar(200) NOT NULL,
  role user_role NOT NULL, password_hash text NOT NULL,
  timezone varchar(100) NOT NULL DEFAULT 'America/Guayaquil', status user_status NOT NULL DEFAULT 'ACTIVE',
  must_change_password boolean NOT NULL DEFAULT false, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT users_username_not_blank CHECK (btrim(username) <> ''),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> '')
);--> statement-breakpoint
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));--> statement-breakpoint

CREATE TABLE devices (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(200) NOT NULL, platform varchar(100) NOT NULL,
  status device_status NOT NULL DEFAULT 'ACTIVE', last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);--> statement-breakpoint
CREATE INDEX devices_user_status_idx ON devices (user_id, status);--> statement-breakpoint

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  refresh_token_hash text NOT NULL, family_id uuid NOT NULL, expires_at timestamptz NOT NULL,
  revoked_at timestamptz, replaced_by_session_id uuid, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
  CONSTRAINT user_sessions_replaced_by_fk FOREIGN KEY (replaced_by_session_id) REFERENCES user_sessions(id) ON DELETE SET NULL,
  CONSTRAINT user_sessions_refresh_hash_uq UNIQUE (refresh_token_hash)
);--> statement-breakpoint
CREATE INDEX user_sessions_user_active_idx ON user_sessions (user_id, expires_at) WHERE revoked_at IS NULL;--> statement-breakpoint

CREATE TABLE commercial_accounts (
  id uuid PRIMARY KEY, display_name varchar(200) NOT NULL, normalized_display_name varchar(200) NOT NULL,
  legal_name varchar(250), account_type varchar(50) NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status account_status NOT NULL DEFAULT 'ACTIVE', country_code varchar(2) NOT NULL,
  state_province varchar(150), city varchar(150) NOT NULL, address text, postal_code varchar(30),
  phone varchar(50), email varchar(320), timezone varchar(100),
  latitude numeric(9,6), longitude numeric(9,6), location_source varchar(20),
  location_captured_at timestamptz, location_captured_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1, archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT commercial_accounts_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT commercial_accounts_version_positive CHECK (version > 0),
  CONSTRAINT commercial_accounts_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT commercial_accounts_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT commercial_accounts_location_source CHECK (location_source IS NULL OR location_source IN ('MANUAL', 'DEVICE', 'MAP'))
);--> statement-breakpoint
CREATE INDEX commercial_accounts_owner_status_idx ON commercial_accounts (owner_user_id, status);--> statement-breakpoint
CREATE INDEX commercial_accounts_country_city_idx ON commercial_accounts (country_code, city);--> statement-breakpoint
CREATE INDEX commercial_accounts_name_trgm_idx ON commercial_accounts USING gin (normalized_display_name gin_trgm_ops);--> statement-breakpoint

CREATE TABLE commercial_contacts (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES commercial_accounts(id) ON DELETE RESTRICT,
  full_name varchar(200) NOT NULL, normalized_full_name varchar(200) NOT NULL,
  title varchar(150), phone varchar(50), email varchar(320), notes text,
  is_primary boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT commercial_contacts_channel_required CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT commercial_contacts_version_positive CHECK (version > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX commercial_contacts_primary_uq ON commercial_contacts (account_id) WHERE is_primary AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX commercial_contacts_account_idx ON commercial_contacts (account_id);--> statement-breakpoint
CREATE INDEX commercial_contacts_name_trgm_idx ON commercial_contacts USING gin (normalized_full_name gin_trgm_ops);--> statement-breakpoint

CREATE TABLE visits (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES commercial_accounts(id) ON DELETE RESTRICT,
  responsible_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scheduled_at timestamptz NOT NULL, timezone varchar(100) NOT NULL, reason text NOT NULL,
  priority priority NOT NULL DEFAULT 'MEDIUM', notes text, status visit_status NOT NULL DEFAULT 'PENDING',
  observation text, actual_started_at timestamptz, actual_ended_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT, cancellation_reason text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT visits_id_account_uq UNIQUE (id, account_id),
  CONSTRAINT visits_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT visits_version_positive CHECK (version > 0),
  CONSTRAINT visits_completed_fields CHECK (status <> 'COMPLETED' OR (observation IS NOT NULL AND btrim(observation) <> '' AND actual_ended_at IS NOT NULL AND completed_by IS NOT NULL)),
  CONSTRAINT visits_cancelled_fields CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> ''))
);--> statement-breakpoint
CREATE INDEX visits_responsible_pending_idx ON visits (responsible_user_id, scheduled_at) WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX visits_account_scheduled_idx ON visits (account_id, scheduled_at);--> statement-breakpoint

CREATE TABLE tasks (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES commercial_accounts(id) ON DELETE RESTRICT, visit_id uuid,
  responsible_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL, description text, due_date date NOT NULL, due_time time,
  timezone varchar(100) NOT NULL, priority priority NOT NULL DEFAULT 'MEDIUM', status task_status NOT NULL DEFAULT 'PENDING',
  completed_at timestamptz, completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT, cancellation_reason text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT tasks_id_account_uq UNIQUE (id, account_id),
  CONSTRAINT tasks_visit_same_account_fk FOREIGN KEY (visit_id, account_id) REFERENCES visits(id, account_id) ON DELETE RESTRICT,
  CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT tasks_version_positive CHECK (version > 0),
  CONSTRAINT tasks_completed_fields CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CONSTRAINT tasks_cancelled_fields CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> ''))
);--> statement-breakpoint
CREATE INDEX tasks_responsible_open_idx ON tasks (responsible_user_id, due_date) WHERE status IN ('PENDING', 'IN_PROGRESS');--> statement-breakpoint
CREATE INDEX tasks_account_idx ON tasks (account_id);--> statement-breakpoint

CREATE TABLE document_categories (
  id uuid PRIMARY KEY, name varchar(150) NOT NULL, normalized_name varchar(150) NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT document_categories_normalized_name_uq UNIQUE (normalized_name)
);--> statement-breakpoint

CREATE TABLE documents (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES commercial_accounts(id) ON DELETE RESTRICT,
  visit_id uuid, task_id uuid, category_id uuid REFERENCES document_categories(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL, original_filename varchar(255) NOT NULL, storage_key varchar(255) NOT NULL,
  format document_format NOT NULL, mime_type varchar(100) NOT NULL, size_bytes integer NOT NULL,
  checksum_sha256 varchar(64) NOT NULL, status document_status NOT NULL DEFAULT 'QUARANTINED',
  scanned_at timestamptz, deleted_at timestamptz, deleted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT documents_visit_same_account_fk FOREIGN KEY (visit_id, account_id) REFERENCES visits(id, account_id) ON DELETE RESTRICT,
  CONSTRAINT documents_task_same_account_fk FOREIGN KEY (task_id, account_id) REFERENCES tasks(id, account_id) ON DELETE RESTRICT,
  CONSTRAINT documents_storage_key_uq UNIQUE (storage_key),
  CONSTRAINT documents_single_context CHECK (num_nonnulls(visit_id, task_id) <= 1),
  CONSTRAINT documents_size_range CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT documents_checksum_sha256 CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_version_positive CHECK (version > 0)
);--> statement-breakpoint
CREATE INDEX documents_account_category_created_idx ON documents (account_id, category_id, created_at);--> statement-breakpoint
CREATE INDEX documents_checksum_idx ON documents (checksum_sha256);--> statement-breakpoint

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(100) NOT NULL, entity_type varchar(100) NOT NULL, entity_id uuid,
  before_changes jsonb, after_changes jsonb, request_id varchar(100) NOT NULL,
  device_id uuid REFERENCES devices(id) ON DELETE RESTRICT, ip_address varchar(64),
  occurred_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX audit_logs_actor_occurred_idx ON audit_logs (actor_user_id, occurred_at);--> statement-breakpoint
CREATE INDEX audit_logs_entity_occurred_idx ON audit_logs (entity_type, entity_id, occurred_at);--> statement-breakpoint
CREATE INDEX audit_logs_request_id_idx ON audit_logs (request_id);--> statement-breakpoint
CREATE FUNCTION reject_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();--> statement-breakpoint

CREATE TABLE sync_operations (
  id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  client_operation_id uuid NOT NULL, sequence integer NOT NULL,
  entity_type varchar(100) NOT NULL, entity_id uuid NOT NULL, action varchar(20) NOT NULL,
  base_version integer, payload_hash varchar(64) NOT NULL,
  status sync_operation_status NOT NULL DEFAULT 'RECEIVED', result_code varchar(100), result_entity_version integer,
  occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz,
  CONSTRAINT sync_operations_device_client_uq UNIQUE (device_id, client_operation_id),
  CONSTRAINT sync_operations_device_sequence_uq UNIQUE (device_id, sequence),
  CONSTRAINT sync_operations_sequence_positive CHECK (sequence > 0),
  CONSTRAINT sync_operations_base_version_positive CHECK (base_version IS NULL OR base_version > 0),
  CONSTRAINT sync_operations_payload_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE TABLE sync_operation_dependencies (
  operation_id uuid NOT NULL REFERENCES sync_operations(id) ON DELETE CASCADE,
  depends_on_operation_id uuid NOT NULL REFERENCES sync_operations(id) ON DELETE RESTRICT,
  PRIMARY KEY (operation_id, depends_on_operation_id),
  CONSTRAINT sync_operation_dependencies_not_self CHECK (operation_id <> depends_on_operation_id)
);--> statement-breakpoint

CREATE TABLE change_log (
  cursor bigserial PRIMARY KEY, entity_type varchar(100) NOT NULL, entity_id uuid NOT NULL,
  operation change_operation NOT NULL, version integer NOT NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(), request_id varchar(100) NOT NULL,
  CONSTRAINT change_log_version_positive CHECK (version > 0)
);--> statement-breakpoint
CREATE INDEX change_log_entity_version_idx ON change_log (entity_type, entity_id, version);--> statement-breakpoint
CREATE INDEX change_log_owner_cursor_idx ON change_log (owner_user_id, cursor);--> statement-breakpoint

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES sync_operations(id) ON DELETE RESTRICT,
  entity_type varchar(100) NOT NULL, entity_id uuid NOT NULL,
  base_version integer NOT NULL, server_version integer NOT NULL, conflicting_fields text[] NOT NULL,
  base_snapshot_hash varchar(64) NOT NULL, client_snapshot_hash varchar(64) NOT NULL, server_snapshot_hash varchar(64) NOT NULL,
  status sync_conflict_status NOT NULL DEFAULT 'OPEN', resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_conflicts_operation_uq UNIQUE (operation_id),
  CONSTRAINT sync_conflicts_versions_positive CHECK (base_version > 0 AND server_version > 0)
);--> statement-breakpoint
CREATE INDEX sync_conflicts_status_created_idx ON sync_conflicts (status, created_at);
