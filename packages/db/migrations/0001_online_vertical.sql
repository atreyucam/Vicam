CREATE TYPE reminder_status AS ENUM ('PENDING', 'CANCELLED', 'DELIVERED');--> statement-breakpoint

ALTER TABLE user_sessions ADD COLUMN csrf_token_hash varchar(64);--> statement-breakpoint
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_csrf_hash_format CHECK (csrf_token_hash IS NULL OR csrf_token_hash ~ '^[0-9a-f]{64}$');--> statement-breakpoint

CREATE TABLE login_attempts (
  attempt_key varchar(64) PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_attempts_key_format CHECK (attempt_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT login_attempts_failure_count_nonnegative CHECK (failure_count >= 0)
);--> statement-breakpoint

CREATE TABLE visit_reschedules (
  id uuid PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  old_scheduled_at timestamptz NOT NULL,
  new_scheduled_at timestamptz NOT NULL,
  old_timezone varchar(100) NOT NULL,
  new_timezone varchar(100) NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_reschedules_reason_not_blank CHECK (btrim(reason) <> '')
);--> statement-breakpoint
CREATE INDEX visit_reschedules_visit_created_idx ON visit_reschedules (visit_id, created_at);--> statement-breakpoint

CREATE TABLE reminders (
  id uuid PRIMARY KEY,
  visit_id uuid REFERENCES visits(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES tasks(id) ON DELETE RESTRICT,
  scheduled_at timestamptz NOT NULL,
  status reminder_status NOT NULL DEFAULT 'PENDING',
  job_key varchar(255) NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminders_exactly_one_target CHECK (num_nonnulls(visit_id, task_id) = 1),
  CONSTRAINT reminders_job_key_uq UNIQUE (job_key),
  CONSTRAINT reminders_cancelled_timestamp CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX reminders_visit_status_idx ON reminders (visit_id, status);--> statement-breakpoint
CREATE INDEX reminders_task_status_idx ON reminders (task_id, status);--> statement-breakpoint
CREATE INDEX reminders_pending_schedule_idx ON reminders (scheduled_at) WHERE status = 'PENDING';--> statement-breakpoint

CREATE TABLE mutation_idempotency (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(200) NOT NULL,
  operation varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, idempotency_key, operation),
  CONSTRAINT mutation_idempotency_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mutation_idempotency_status_code CHECK (status_code BETWEEN 200 AND 299)
);--> statement-breakpoint
CREATE INDEX mutation_idempotency_expiry_idx ON mutation_idempotency (expires_at);
