ALTER TABLE fruits
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT fruits_version_positive CHECK (version > 0);--> statement-breakpoint

ALTER TABLE audit_logs
  ADD COLUMN retention_class varchar(20) NOT NULL DEFAULT 'FUNCTIONAL',
  ADD CONSTRAINT audit_logs_retention_class_check
    CHECK (retention_class IN ('FUNCTIONAL', 'SECURITY'));--> statement-breakpoint

ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only;--> statement-breakpoint

UPDATE audit_logs
SET retention_class = 'SECURITY'
WHERE action LIKE 'LOGIN\_%' ESCAPE '\'
   OR action LIKE 'SESSION\_%' ESCAPE '\'
   OR action LIKE 'PASSWORD\_%' ESCAPE '\'
   OR action IN ('USER_PASSWORD_RESET', 'MANAGER_PASSWORD_RESET_CLI');--> statement-breakpoint

ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only;--> statement-breakpoint

CREATE INDEX audit_logs_retention_idx
  ON audit_logs (retention_class, occurred_at);--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vicam.retention_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;--> statement-breakpoint

ALTER TABLE reminders
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN push_attempted_at timestamptz,
  ADD CONSTRAINT reminders_delivered_timestamp
    CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL);--> statement-breakpoint

ALTER TABLE import_batches
  ADD COLUMN error_storage_key varchar(255);--> statement-breakpoint

ALTER TABLE report_exports
  ADD COLUMN requester_role user_role NOT NULL DEFAULT 'MANAGER',
  ADD COLUMN scope_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;--> statement-breakpoint

UPDATE report_exports r
SET requester_role = u.role,
    scope_user_id = CASE WHEN u.role = 'SUPERVISOR' THEN r.requester_user_id ELSE NULL END
FROM users u
WHERE u.id = r.requester_user_id;--> statement-breakpoint

ALTER TABLE report_exports
  ADD CONSTRAINT report_exports_scope_check CHECK (
    (requester_role = 'MANAGER' AND scope_user_id IS NULL)
    OR (requester_role = 'SUPERVISOR' AND scope_user_id = requester_user_id)
  );--> statement-breakpoint

CREATE INDEX report_exports_scope_idx
  ON report_exports (scope_user_id, report_group, created_at DESC)
  WHERE scope_user_id IS NOT NULL;
