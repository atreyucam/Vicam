ALTER TABLE notifications
  ADD COLUMN source_key varchar(255);--> statement-breakpoint

CREATE UNIQUE INDEX notifications_source_key_uq
  ON notifications(source_key)
  WHERE source_key IS NOT NULL;--> statement-breakpoint

CREATE TYPE push_delivery_status AS ENUM ('PENDING','SENT','FAILED');--> statement-breakpoint

CREATE TABLE notification_push_deliveries (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status push_delivery_status NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error_code varchar(80),
  PRIMARY KEY(notification_id,subscription_id),
  CONSTRAINT notification_push_attempts_nonnegative CHECK (attempt_count >= 0)
);--> statement-breakpoint

CREATE INDEX notification_push_pending_idx
  ON notification_push_deliveries(notification_id,status)
  WHERE status='PENDING';--> statement-breakpoint

ALTER TABLE report_exports
  DROP CONSTRAINT report_exports_expiry_check,
  ADD CONSTRAINT report_exports_expiry_check
    CHECK (expires_at = created_at + interval '7 days');--> statement-breakpoint
