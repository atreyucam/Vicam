ALTER TABLE users DROP COLUMN timezone;--> statement-breakpoint

CREATE INDEX notifications_created_at_idx ON notifications(created_at);
