CREATE TYPE report_export_status AS ENUM ('QUEUED', 'PROCESSING', 'AVAILABLE', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE import_format AS ENUM ('XLSX', 'CSV');--> statement-breakpoint
CREATE TYPE import_status AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'CONFIRMING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE import_row_action AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'ERROR');--> statement-breakpoint

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type varchar(80) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(500) NOT NULL,
  resource_type varchar(80),
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT notifications_body_not_blank CHECK (btrim(body) <> '')
);--> statement-breakpoint
CREATE INDEX notifications_user_read_created_idx ON notifications (user_id, read_at, created_at DESC);--> statement-breakpoint

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  endpoint_hash varchar(64) NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT push_subscriptions_endpoint_hash_uq UNIQUE (endpoint_hash),
  CONSTRAINT push_subscriptions_endpoint_hash_format CHECK (endpoint_hash ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX push_subscriptions_user_device_idx ON push_subscriptions (user_id, device_id);--> statement-breakpoint

CREATE TABLE report_exports (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_group varchar(20) NOT NULL,
  template varchar(100) NOT NULL,
  format varchar(10) NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone varchar(100) NOT NULL,
  status report_export_status NOT NULL DEFAULT 'QUEUED',
  storage_key varchar(255),
  error_code varchar(100),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_exports_group_check CHECK (report_group IN ('VISITS','TASKS','ACCOUNTS','DOCUMENTS','MANAGEMENT')),
  CONSTRAINT report_exports_format_check CHECK (format IN ('PDF','XLSX')),
  CONSTRAINT report_exports_expiry_check CHECK (expires_at <= created_at + interval '7 days')
);--> statement-breakpoint
CREATE INDEX report_exports_requester_created_idx ON report_exports (requester_user_id, created_at DESC);--> statement-breakpoint
CREATE INDEX report_exports_expiry_idx ON report_exports (expires_at) WHERE status IN ('AVAILABLE','FAILED','EXPIRED');--> statement-breakpoint

CREATE TABLE import_batches (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  format import_format NOT NULL,
  storage_key varchar(255) NOT NULL,
  checksum_sha256 varchar(64) NOT NULL,
  status import_status NOT NULL DEFAULT 'UPLOADED',
  confirmation_id uuid,
  total_rows integer NOT NULL DEFAULT 0,
  create_rows integer NOT NULL DEFAULT 0,
  update_rows integer NOT NULL DEFAULT 0,
  skip_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_checksum_format CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_batches_counts_nonnegative CHECK (total_rows >= 0 AND create_rows >= 0 AND update_rows >= 0 AND skip_rows >= 0 AND error_rows >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX import_batches_requester_confirmation_uq ON import_batches (requester_user_id, confirmation_id) WHERE confirmation_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE import_rows (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  action import_row_action NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_of_account_id uuid REFERENCES commercial_accounts(id) ON DELETE RESTRICT,
  values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz,
  CONSTRAINT import_rows_batch_number_uq UNIQUE (batch_id, row_number),
  CONSTRAINT import_rows_number_positive CHECK (row_number > 0)
);--> statement-breakpoint
CREATE INDEX import_rows_batch_action_idx ON import_rows (batch_id, action, row_number);--> statement-breakpoint

CREATE TABLE app_settings (
  settings_key varchar(64) PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT app_settings_version_positive CHECK (version > 0)
);--> statement-breakpoint
INSERT INTO app_settings(settings_key,value) VALUES (
  'application',
  '{"offlineWindowHours":72,"visitReminderOffsetsMinutes":[1440,60],"taskReminderOffsetsMinutes":[1440],"supervisorReportsEnabled":false,"documentLimitBytes":10485760,"defaultTimezone":"America/Guayaquil","retentionDays":{"exports":7,"documentsTrash":30,"jobs":90}}'::jsonb
);--> statement-breakpoint

ALTER TABLE document_categories ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT document_categories_version_positive CHECK (version > 0);--> statement-breakpoint
ALTER TABLE documents ADD COLUMN rejected_reason varchar(300);--> statement-breakpoint
CREATE INDEX documents_deleted_at_idx ON documents (deleted_at) WHERE deleted_at IS NOT NULL;--> statement-breakpoint
