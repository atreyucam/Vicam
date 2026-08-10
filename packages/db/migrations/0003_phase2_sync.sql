CREATE TABLE offline_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL,
  scope_hash varchar(64) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_grants_token_hash_uq UNIQUE (token_hash),
  CONSTRAINT offline_grants_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT offline_grants_scope_hash_format CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT offline_grants_maximum_lifetime CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '72 hours')
);--> statement-breakpoint
CREATE INDEX offline_grants_user_device_active_idx
  ON offline_grants (user_id, device_id, expires_at DESC)
  WHERE revoked_at IS NULL;--> statement-breakpoint

ALTER TABLE sync_operations
  ADD COLUMN actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN changed_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN result_status varchar(20),
  ADD COLUMN conflict_id uuid,
  ADD COLUMN result_body jsonb,
  ADD CONSTRAINT sync_operations_result_status_check CHECK (
    result_status IS NULL OR result_status IN ('APPLIED','MERGED','DUPLICATE','CONFLICT','REJECTED','BLOCKED')
  );--> statement-breakpoint
CREATE INDEX sync_operations_actor_received_idx ON sync_operations (actor_user_id, received_at DESC);--> statement-breakpoint

ALTER TABLE change_log
  ADD COLUMN changed_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN data jsonb;--> statement-breakpoint

ALTER TABLE sync_conflicts
  ADD COLUMN code varchar(100) NOT NULL DEFAULT 'SAME_FIELD_CHANGED',
  ADD COLUMN base_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN client_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN server_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN resolution varchar(20),
  ADD CONSTRAINT sync_conflicts_code_check CHECK (
    code IN ('SAME_FIELD_CHANGED','STATE_CHANGED','ENTITY_ARCHIVED','ACCESS_REVOKED','DEPENDENCY_FAILED','BASE_VERSION_REQUIRED')
  ),
  ADD CONSTRAINT sync_conflicts_resolution_check CHECK (
    resolution IS NULL OR resolution IN ('SERVER','DEVICE','MERGED')
  );--> statement-breakpoint
ALTER TABLE sync_operations
  ADD CONSTRAINT sync_operations_conflict_fk FOREIGN KEY (conflict_id) REFERENCES sync_conflicts(id) ON DELETE RESTRICT;--> statement-breakpoint

CREATE FUNCTION sync_entity_data(table_name text, row_data jsonb) RETURNS jsonb
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
      'notes', row_data->'notes', 'status', row_data->'status', 'observation', row_data->'observation',
      'actualStartedAt', row_data->'actual_started_at', 'actualEndedAt', row_data->'actual_ended_at',
      'cancellationReason', row_data->'cancellation_reason', 'version', row_data->'version')
    WHEN 'tasks' THEN jsonb_build_object(
      'id', row_data->'id', 'accountId', row_data->'account_id', 'visitId', row_data->'visit_id',
      'responsibleUserId', row_data->'responsible_user_id', 'title', row_data->'title',
      'description', row_data->'description', 'dueDate', row_data->'due_date', 'dueTime', row_data->'due_time',
      'timezone', row_data->'timezone', 'priority', row_data->'priority', 'status', row_data->'status',
      'completedAt', row_data->'completed_at', 'version', row_data->'version')
  END
$$;--> statement-breakpoint

CREATE FUNCTION record_sync_entity_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  raw_new jsonb;
  raw_old jsonb;
  new_data jsonb;
  old_data jsonb;
  entity_kind text;
  entity_owner uuid;
  previous_owner uuid;
  previous_responsible uuid;
  current_responsible uuid;
  previous_authorized_user uuid;
  current_authorized_user uuid;
  account_ref uuid;
  fields text[];
  entity_version integer;
  request_key text;
BEGIN
  raw_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  raw_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_data := CASE WHEN raw_new IS NULL THEN NULL ELSE sync_entity_data(TG_TABLE_NAME, raw_new) END;
  old_data := CASE WHEN raw_old IS NULL THEN NULL ELSE sync_entity_data(TG_TABLE_NAME, raw_old) END;
  entity_kind := CASE TG_TABLE_NAME
    WHEN 'commercial_accounts' THEN 'ACCOUNT'
    WHEN 'commercial_contacts' THEN 'CONTACT'
    WHEN 'visits' THEN 'VISIT'
    WHEN 'tasks' THEN 'TASK'
  END;
  account_ref := CASE TG_TABLE_NAME
    WHEN 'commercial_accounts' THEN COALESCE(raw_new->>'id', raw_old->>'id')::uuid
    ELSE COALESCE(raw_new->>'account_id', raw_old->>'account_id')::uuid
  END;
  IF TG_TABLE_NAME = 'commercial_accounts' THEN
    entity_owner := COALESCE(raw_new->>'owner_user_id', raw_old->>'owner_user_id')::uuid;
    previous_owner := CASE WHEN raw_old IS NULL THEN NULL ELSE (raw_old->>'owner_user_id')::uuid END;
  ELSE
    SELECT owner_user_id INTO entity_owner FROM commercial_accounts WHERE id = account_ref;
    IF raw_old IS NULL THEN
      previous_owner := NULL;
    ELSE
      SELECT owner_user_id INTO previous_owner FROM commercial_accounts
        WHERE id = (raw_old->>'account_id')::uuid;
    END IF;
    IF TG_TABLE_NAME IN ('visits','tasks') THEN
      previous_responsible := CASE WHEN raw_old IS NULL THEN NULL ELSE (raw_old->>'responsible_user_id')::uuid END;
      current_responsible := CASE WHEN raw_new IS NULL THEN NULL ELSE (raw_new->>'responsible_user_id')::uuid END;
      previous_authorized_user := CASE WHEN previous_responsible = previous_owner THEN previous_responsible END;
      current_authorized_user := CASE WHEN current_responsible = entity_owner THEN current_responsible END;
    END IF;
  END IF;
  entity_version := COALESCE(raw_new->>'version', raw_old->>'version')::integer;
  request_key := COALESCE(NULLIF(current_setting('vicam.request_id', true), ''), 'database-change');

  IF old_data IS NULL THEN
    SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO fields
      FROM jsonb_object_keys(new_data - ARRAY['id','version','createdAt','updatedAt']) key;
  ELSIF new_data IS NULL THEN
    fields := '{}';
  ELSE
    SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO fields
      FROM jsonb_each(new_data - ARRAY['id','version','createdAt','updatedAt']) item
      WHERE old_data->item.key IS DISTINCT FROM item.value;
  END IF;

  IF TG_TABLE_NAME = 'commercial_accounts' AND TG_OP = 'UPDATE' AND previous_owner IS DISTINCT FROM entity_owner THEN
    INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
    VALUES ('ACCOUNT', (raw_new->>'id')::uuid, 'REVOKE', (raw_new->>'version')::integer, previous_owner, ARRAY['ownerUserId'], NULL, request_key);

    INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
    SELECT 'CONTACT', c.id, 'UPSERT', c.version, entity_owner, ARRAY['ownerUserId'],
      sync_entity_data('commercial_contacts', to_jsonb(c)), request_key
    FROM commercial_contacts c WHERE c.account_id = account_ref;

    INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
    SELECT 'VISIT', v.id, 'UPSERT', v.version, entity_owner, ARRAY['ownerUserId'],
      sync_entity_data('visits', to_jsonb(v)), request_key
    FROM visits v WHERE v.account_id = account_ref AND v.responsible_user_id = entity_owner;

    INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
    SELECT 'TASK', t.id, 'UPSERT', t.version, entity_owner, ARRAY['ownerUserId'],
      sync_entity_data('tasks', to_jsonb(t)), request_key
    FROM tasks t WHERE t.account_id = account_ref AND t.responsible_user_id = entity_owner;
  END IF;

  IF TG_TABLE_NAME IN ('visits','tasks') AND previous_authorized_user IS NOT NULL
     AND previous_authorized_user IS DISTINCT FROM current_authorized_user THEN
    INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
    VALUES (entity_kind, COALESCE(raw_new->>'id', raw_old->>'id')::uuid, 'REVOKE', entity_version,
      previous_authorized_user, ARRAY['responsibleUserId'], NULL, request_key);
  END IF;

  INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
  VALUES (
    entity_kind, COALESCE(raw_new->>'id', raw_old->>'id')::uuid,
    (CASE WHEN TG_OP = 'DELETE' OR (new_data->>'deletedAt') IS NOT NULL THEN 'DELETE' ELSE 'UPSERT' END)::change_operation,
    entity_version, entity_owner, fields, new_data, request_key
  );
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint

CREATE TRIGGER commercial_accounts_sync_change AFTER INSERT OR UPDATE OR DELETE ON commercial_accounts
  FOR EACH ROW EXECUTE FUNCTION record_sync_entity_change();--> statement-breakpoint
CREATE TRIGGER commercial_contacts_sync_change AFTER INSERT OR UPDATE OR DELETE ON commercial_contacts
  FOR EACH ROW EXECUTE FUNCTION record_sync_entity_change();--> statement-breakpoint
CREATE TRIGGER visits_sync_change AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION record_sync_entity_change();--> statement-breakpoint
CREATE TRIGGER tasks_sync_change AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_sync_entity_change();--> statement-breakpoint

INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
SELECT 'ACCOUNT', a.id, 'UPSERT', a.version, a.owner_user_id, '{}', sync_entity_data('commercial_accounts', to_jsonb(a)), 'phase2-backfill'
FROM commercial_accounts a;--> statement-breakpoint
INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
SELECT 'CONTACT', c.id, 'UPSERT', c.version, a.owner_user_id, '{}', sync_entity_data('commercial_contacts', to_jsonb(c)), 'phase2-backfill'
FROM commercial_contacts c JOIN commercial_accounts a ON a.id=c.account_id;--> statement-breakpoint
INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
SELECT 'VISIT', v.id, 'UPSERT', v.version, a.owner_user_id, '{}', sync_entity_data('visits', to_jsonb(v)), 'phase2-backfill'
FROM visits v JOIN commercial_accounts a ON a.id=v.account_id;--> statement-breakpoint
INSERT INTO change_log(entity_type, entity_id, operation, version, owner_user_id, changed_fields, data, request_id)
SELECT 'TASK', t.id, 'UPSERT', t.version, a.owner_user_id, '{}', sync_entity_data('tasks', to_jsonb(t)), 'phase2-backfill'
FROM tasks t JOIN commercial_accounts a ON a.id=t.account_id;--> statement-breakpoint
