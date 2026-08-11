import type { Pool } from "pg";

// Fictitious credentials for local development only. Never use these in staging or production.
export const developmentSeedCredentials = {
  manager: { username: "manager.demo", password: "VicamDev!Manager2026" },
  supervisorA: { username: "supervisor.ana", password: "VicamDev!SupervisorA2026" },
  supervisorB: { username: "supervisor.bruno", password: "VicamDev!SupervisorB2026" },
} as const;

const passwordHashes = {
  manager:
    "$argon2id$v=19$m=19456,p=1,t=2$qVRGtxcqsVAeUhP8ZXAo7g$9joDtKwJSzJ1SeW/r7M01FNiiiyQcHUGBUEGa1Q4YZQ",
  supervisorA:
    "$argon2id$v=19$m=19456,p=1,t=2$hfWpQa1CToXUYCli3QdRBw$euZdkhJMquPxnn5vf4jhRrTBck18b4CAb1MJV4CRyV8",
  supervisorB:
    "$argon2id$v=19$m=19456,p=1,t=2$pOyn3gHG6JRCSV5awPRMdQ$4IT0BeDsFLpADrT9AVqJ5t8Vu23rqiT5IkY7KJrPUUI",
} as const;

export async function seedDevelopmentData(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into users (id, username, full_name, role, password_hash, status)
       values
         ('00000000-0000-4000-8000-000000000001', 'manager.demo', 'Manager Demostración', 'MANAGER', $1, 'ACTIVE'),
         ('00000000-0000-4000-8000-000000000002', 'supervisor.ana', 'Ana Supervisora', 'SUPERVISOR', $2, 'ACTIVE'),
         ('00000000-0000-4000-8000-000000000003', 'supervisor.bruno', 'Bruno Supervisor', 'SUPERVISOR', $3, 'ACTIVE')
       on conflict (id) do update set
         username = excluded.username, full_name = excluded.full_name, role = excluded.role,
         password_hash = excluded.password_hash, status = 'ACTIVE', must_change_password = false,
         updated_at = now()`,
      [passwordHashes.manager, passwordHashes.supervisorA, passwordHashes.supervisorB],
    );
    await client.query(
      `insert into document_categories
         (id,name,normalized_name,active,created_by,updated_by)
       values
         ('60000000-0000-4000-8000-000000000001','General','general',true,
          '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001')
       on conflict (id) do update set active=true,updated_at=now()`,
    );
    await client.query(
      `insert into fruits (id, name, normalized_name, active, created_by, updated_by)
       values
         ('50000000-0000-4000-8000-000000000001', 'Banano', 'banano', true,
          '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
         ('50000000-0000-4000-8000-000000000002', 'Mango', 'mango', true,
          '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
         ('50000000-0000-4000-8000-000000000003', 'Pitahaya inactiva', 'pitahaya inactiva', false,
          '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')
       on conflict (id) do update set
         name=excluded.name, normalized_name=excluded.normalized_name, active=excluded.active,
         updated_at=now(), updated_by=excluded.updated_by`,
    );
    await client.query(
      `insert into commercial_accounts (
         id, display_name, normalized_display_name, account_type, owner_user_id,
         country_code, city, phone, created_by, updated_by
       ) values
         ('10000000-0000-4000-8000-000000000001', 'Exportadora Costa Demo', 'exportadora costa demo', 'COMPANY',
          '00000000-0000-4000-8000-000000000002', 'EC', 'Guayaquil', '+593400000001',
          '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
         ('10000000-0000-4000-8000-000000000002', 'Finca Sierra Demo', 'finca sierra demo', 'FARM',
          '00000000-0000-4000-8000-000000000003', 'EC', 'Quito', '+593200000002',
          '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into commercial_account_fruits (account_id, fruit_id, created_by)
       values
         ('10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001')
       on conflict (account_id, fruit_id) do nothing`,
    );
    await client.query(
      `insert into commercial_contacts (
         id, account_id, full_name, normalized_full_name, phone, is_primary, created_by, updated_by
       ) values
         ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          'Contacto Costa Demo', 'contacto costa demo', '+593400000011', true,
          '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'),
         ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
          'Contacto Sierra Demo', 'contacto sierra demo', '+593200000012', true,
          '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into visits (
         id, account_id, responsible_user_id, scheduled_at, timezone, reason, priority, created_by, updated_by
       ) values
         ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002', now() + interval '1 day', 'America/Guayaquil',
          'Seguimiento comercial ficticio', 'MEDIUM', '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000002'),
         ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003', now() + interval '2 days', 'America/Guayaquil',
          'Visita de demostración', 'HIGH', '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000003')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into tasks (
         id, account_id, responsible_user_id, title, due_date, timezone, priority, created_by, updated_by
       ) values
         ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002', 'Confirmar siguiente visita ficticia', current_date + 2,
          'America/Guayaquil', 'MEDIUM', '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000002'),
          ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
           '00000000-0000-4000-8000-000000000003', 'Preparar información ficticia',
           (now() at time zone 'America/Guayaquil')::date - 1,
           'America/Guayaquil', 'HIGH', '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000003')
       on conflict (id) do nothing`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
