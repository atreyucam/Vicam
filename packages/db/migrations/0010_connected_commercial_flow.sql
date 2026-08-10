CREATE TYPE visit_result AS ENUM (
  'INTERESTED',
  'FOLLOW_UP_REQUIRED',
  'PROPOSAL_REQUESTED',
  'NEGOTIATION',
  'NOT_INTERESTED',
  'NO_RESULT'
);--> statement-breakpoint

ALTER TABLE visits
  ADD COLUMN result visit_result,
  ADD COLUMN completed_at timestamptz;--> statement-breakpoint

UPDATE visits
SET result = 'NO_RESULT',
    completed_at = coalesce(updated_at, actual_ended_at)
WHERE status = 'COMPLETED';--> statement-breakpoint

ALTER TABLE visits DROP CONSTRAINT visits_completed_fields;--> statement-breakpoint

ALTER TABLE visits
  ADD CONSTRAINT visits_completed_fields CHECK (
    status <> 'COMPLETED'
    OR (
      observation IS NOT NULL
      AND btrim(observation) <> ''
      AND result IS NOT NULL
      AND actual_ended_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_by IS NOT NULL
    )
  ),
  ADD CONSTRAINT visits_completion_state CHECK (
    (status = 'COMPLETED') = (result IS NOT NULL AND completed_at IS NOT NULL)
  );--> statement-breakpoint

CREATE INDEX tasks_account_created_idx ON tasks (account_id, created_at DESC);--> statement-breakpoint
CREATE INDEX tasks_visit_due_idx ON tasks (visit_id, due_date, id);--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_entity_data(table_name text, row_data jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE table_name
    WHEN 'commercial_accounts' THEN jsonb_build_object(
      'id', row_data->'id', 'displayName', row_data->'display_name', 'legalName', row_data->'legal_name',
      'accountType', row_data->'account_type', 'ownerUserId', row_data->'owner_user_id',
      'ownerFullName', (SELECT to_jsonb(u.full_name) FROM users u WHERE u.id=(row_data->>'owner_user_id')::uuid),
      'primaryContactName', (SELECT to_jsonb(c.full_name) FROM commercial_contacts c
        WHERE c.account_id=(row_data->>'id')::uuid AND c.is_primary AND c.deleted_at IS NULL LIMIT 1),
      'status', row_data->'status', 'countryCode', row_data->'country_code',
      'stateProvince', row_data->'state_province', 'city', row_data->'city',
      'address', row_data->'address', 'postalCode', row_data->'postal_code',
      'phone', row_data->'phone', 'email', row_data->'email', 'timezone', row_data->'timezone',
      'latitude', row_data->'latitude', 'longitude', row_data->'longitude',
      'locationSource', row_data->'location_source', 'locationCapturedAt', row_data->'location_captured_at',
      'fruitIds', COALESCE((SELECT jsonb_agg(af.fruit_id ORDER BY af.fruit_id)
        FROM commercial_account_fruits af WHERE af.account_id=(row_data->>'id')::uuid), '[]'::jsonb),
      'fruits', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name,f.id)
        FROM commercial_account_fruits af JOIN fruits f ON f.id=af.fruit_id
        WHERE af.account_id=(row_data->>'id')::uuid AND f.active), '[]'::jsonb),
      'version', row_data->'version', 'createdAt', row_data->'created_at', 'updatedAt', row_data->'updated_at')
    WHEN 'commercial_contacts' THEN jsonb_build_object(
      'id', row_data->'id', 'accountId', row_data->'account_id', 'fullName', row_data->'full_name',
      'title', row_data->'title', 'phone', row_data->'phone', 'email', row_data->'email',
      'notes', row_data->'notes', 'isPrimary', row_data->'is_primary',
      'version', row_data->'version', 'deletedAt', row_data->'deleted_at')
    WHEN 'visits' THEN jsonb_build_object(
      'id', row_data->'id', 'accountId', row_data->'account_id',
      'responsibleUserId', row_data->'responsible_user_id', 'scheduledAt', row_data->'scheduled_at',
      'timezone', row_data->'timezone', 'reason', row_data->'reason', 'priority', row_data->'priority',
      'notes', row_data->'notes', 'status', row_data->'status', 'result', row_data->'result',
      'observation', row_data->'observation', 'actualStartedAt', row_data->'actual_started_at',
      'actualEndedAt', row_data->'actual_ended_at', 'completedAt', row_data->'completed_at',
      'cancellationReason', row_data->'cancellation_reason', 'version', row_data->'version')
    WHEN 'tasks' THEN jsonb_build_object(
      'id', row_data->'id', 'accountId', row_data->'account_id', 'visitId', row_data->'visit_id',
      'responsibleUserId', row_data->'responsible_user_id', 'title', row_data->'title',
      'description', row_data->'description', 'dueDate', row_data->'due_date', 'dueTime', row_data->'due_time',
      'timezone', row_data->'timezone', 'priority', row_data->'priority', 'status', row_data->'status',
      'completedAt', row_data->'completed_at',
      'visitScheduledAt', (SELECT to_jsonb(v.scheduled_at) FROM visits v WHERE v.id=(row_data->>'visit_id')::uuid),
      'visitReason', (SELECT to_jsonb(v.reason) FROM visits v WHERE v.id=(row_data->>'visit_id')::uuid),
      'version', row_data->'version')
  END
$$;
