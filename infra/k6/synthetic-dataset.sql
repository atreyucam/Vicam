\set ON_ERROR_STOP on
\if :{?account_count}
\else
  \set account_count 100000
\endif
\if :{?visit_count}
\else
  \set visit_count 500000
\endif
\if :{?task_count}
\else
  \set task_count 500000
\endif
\if :{?owner_username}
\else
  \set owner_username manager.load
\endif
\if :{?confirm_synthetic_load}
\else
  \set confirm_synthetic_load NO
\endif

SELECT CASE WHEN :'confirm_synthetic_load' = 'YES' THEN 1 ELSE 1 / 0 END
  AS explicit_confirmation_required;
SELECT id AS owner_id
FROM users
WHERE username = :'owner_username' AND role = 'MANAGER' AND status = 'ACTIVE'
\gset

BEGIN;
SET LOCAL synchronous_commit = off;
-- Fixtures de capacidad: evita poblar auditoría/change_log y medir triggers
-- transaccionales ya cubiertos por las pruebas API/DB.
SET LOCAL session_replication_role = replica;
SELECT set_config('app.request_id', 'phase4-synthetic-load', true);

INSERT INTO commercial_accounts (
  id, display_name, normalized_display_name, account_type, owner_user_id,
  status, country_code, city, phone, timezone, created_by, updated_by
)
SELECT
  overlay(
    overlay(md5('vicam-load-account-' || series) placing '4' from 13 for 1)
    placing '8' from 17 for 1
  )::uuid,
  'Cuenta sintética ' || series,
  'cuenta sintetica ' || series,
  CASE series % 4
    WHEN 0 THEN 'DISTRIBUTOR'
    WHEN 1 THEN 'FARM'
    WHEN 2 THEN 'COMPANY'
    ELSE 'PERSON'
  END,
  :'owner_id'::uuid,
  'ACTIVE',
  'EC',
  (ARRAY['Quito', 'Guayaquil', 'Cuenca', 'Machala', 'Ambato'])[(series % 5) + 1],
  '+5932' || lpad(series::text, 8, '0'),
  'America/Guayaquil',
  :'owner_id'::uuid,
  :'owner_id'::uuid
FROM generate_series(1, :account_count) AS generated(series)
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits (
  id, account_id, responsible_user_id, scheduled_at, timezone, reason,
  priority, status, created_by, updated_by
)
SELECT
  overlay(
    overlay(md5('vicam-load-visit-' || series) placing '4' from 13 for 1)
    placing '8' from 17 for 1
  )::uuid,
  overlay(
    overlay(
      md5('vicam-load-account-' || (((series - 1) % :account_count) + 1))
      placing '4' from 13 for 1
    )
    placing '8' from 17 for 1
  )::uuid,
  :'owner_id'::uuid,
  now() + (((series % 180) - 90)::text || ' days')::interval,
  'America/Guayaquil',
  'Visita sintética de capacidad',
  (ARRAY['LOW', 'MEDIUM', 'HIGH'])[(series % 3) + 1]::priority,
  'PENDING',
  :'owner_id'::uuid,
  :'owner_id'::uuid
FROM generate_series(1, :visit_count) AS generated(series)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (
  id, account_id, responsible_user_id, title, due_date, due_time, timezone,
  priority, status, created_by, updated_by
)
SELECT
  overlay(
    overlay(md5('vicam-load-task-' || series) placing '4' from 13 for 1)
    placing '8' from 17 for 1
  )::uuid,
  overlay(
    overlay(
      md5('vicam-load-account-' || (((series - 1) % :account_count) + 1))
      placing '4' from 13 for 1
    )
    placing '8' from 17 for 1
  )::uuid,
  :'owner_id'::uuid,
  'Tarea sintética ' || series,
  current_date + ((series % 120) - 30),
  CASE WHEN series % 3 = 0 THEN NULL ELSE time '09:00' + ((series % 8) * interval '1 hour') END,
  'America/Guayaquil',
  (ARRAY['LOW', 'MEDIUM', 'HIGH'])[(series % 3) + 1]::priority,
  'PENDING',
  :'owner_id'::uuid,
  :'owner_id'::uuid
FROM generate_series(1, :task_count) AS generated(series)
ON CONFLICT (id) DO NOTHING;

COMMIT;
ANALYZE commercial_accounts;
ANALYZE visits;
ANALYZE tasks;

SELECT json_build_object(
  'accounts', (SELECT count(*) FROM commercial_accounts WHERE display_name LIKE 'Cuenta sintética %'),
  'visits', (SELECT count(*) FROM visits WHERE reason = 'Visita sintética de capacidad'),
  'tasks', (SELECT count(*) FROM tasks WHERE title LIKE 'Tarea sintética %')
) AS synthetic_dataset;
