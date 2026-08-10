ALTER TABLE visit_reschedules
  ADD CONSTRAINT visit_reschedules_schedule_changed CHECK (
    old_scheduled_at IS DISTINCT FROM new_scheduled_at
    OR old_timezone IS DISTINCT FROM new_timezone
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_visit_reschedule_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'visit_reschedules is append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER visit_reschedules_append_only
BEFORE UPDATE OR DELETE ON visit_reschedules
FOR EACH ROW EXECUTE FUNCTION reject_visit_reschedule_mutation();
