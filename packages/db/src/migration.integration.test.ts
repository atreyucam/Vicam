import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable, type AnyPgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { migrateDatabase } from "./migrate.js";
import * as schema from "./schema.js";
import { seedDevelopmentData } from "./seed.js";

const integration = process.env.VICAM_RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function applySqlMigration(pool: Pool, filename: string): Promise<void> {
  const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), "utf8");
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await pool.query(statement);
  }
}

integration("PostgreSQL 18 migration", () => {
  it("migrates an empty database and enforces base invariants", async () => {
    const container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const connectionString = container.getConnectionUri();
    const pool = new Pool({ connectionString });

    try {
      await migrateDatabase({
        connectionString,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 1,
        ssl: false,
      });
      await migrateDatabase({
        connectionString,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 1,
        ssl: false,
      });

      const extensions = await pool.query<{ extname: string }>(
        "select extname from pg_extension where extname in ('unaccent', 'pg_trgm') order by extname",
      );
      expect(extensions.rows.map((row) => row.extname)).toEqual(["pg_trgm", "unaccent"]);

      for (const value of Object.values(schema) as unknown[]) {
        if (!is(value, PgTable)) continue;
        const table = value as AnyPgTable;
        const config = getTableConfig(table);
        const databaseColumns = await pool.query<{ column_name: string }>(
          `select column_name
             from information_schema.columns
            where table_schema='public' and table_name=$1
            order by column_name`,
          [config.name],
        );
        expect(
          databaseColumns.rows.map((row) => row.column_name),
          `Column drift in ${config.name}`,
        ).toEqual(config.columns.map((column) => column.name).sort());

        const expectedIndexes = config.indexes
          .map((indexDefinition) => indexDefinition.config.name)
          .filter((name): name is string => Boolean(name))
          .sort();
        const databaseIndexes = await pool.query<{ indexname: string }>(
          `select indexname
             from pg_indexes
            where schemaname='public' and tablename=$1 and indexname=any($2::text[])
            order by indexname`,
          [config.name, expectedIndexes],
        );
        expect(
          databaseIndexes.rows.map((row) => row.indexname),
          `Index drift in ${config.name}`,
        ).toEqual(expectedIndexes);
      }

      const userId = randomUUID();
      await pool.query(
        "insert into users (id, username, full_name, role, password_hash) values ($1, 'manager', 'Manager', 'MANAGER', 'argon2id-hash-placeholder')",
        [userId],
      );
      const notificationSource = `reminder:${randomUUID()}`;
      await pool.query(
        "insert into notifications(id,user_id,type,title,body,source_key) values($1,$2,'TEST','Aviso','Contenido seguro',$3)",
        [randomUUID(), userId, notificationSource],
      );
      await expect(
        pool.query(
          "insert into notifications(id,user_id,type,title,body,source_key) values($1,$2,'TEST','Aviso','Contenido seguro',$3)",
          [randomUUID(), userId, notificationSource],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        pool.query(
          `insert into report_exports
             (id,requester_user_id,report_group,template,format,timezone,expires_at)
           values($1,$2,'ACCOUNTS','directory','PDF','America/Guayaquil',now()+interval '6 days')`,
          [randomUUID(), userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await pool.query(
        `with clock as (select now() created_at)
         insert into report_exports
           (id,requester_user_id,report_group,template,format,timezone,created_at,expires_at)
         select $1,$2,'ACCOUNTS','directory','PDF','America/Guayaquil',
                created_at,created_at+interval '7 days' from clock`,
        [randomUUID(), userId],
      );
      await expect(
        pool.query(
          "insert into commercial_accounts (id, display_name, normalized_display_name, account_type, owner_user_id, country_code, city) values ($1, 'Cuenta', 'cuenta', 'COMPANY', $2, 'EC', 'Quito')",
          [randomUUID(), userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await pool.query(
        `insert into commercial_accounts
          (id,display_name,normalized_display_name,account_type,owner_user_id,country_code,city,phone,
           latitude,longitude,location_source,location_captured_at,location_captured_by)
         values ($1,'GPS válida','gps valida','FARM',$2,'EC','Quito','+593200000099',-0.18,-78.46,'DEVICE',now(),$2)`,
        [randomUUID(), userId],
      );
      await expect(
        pool.query(
          `insert into commercial_accounts
            (id,display_name,normalized_display_name,account_type,owner_user_id,country_code,city,phone,latitude)
           values ($1,'GPS parcial','gps parcial','FARM',$2,'EC','Quito','+593200000098',-0.18)`,
          [randomUUID(), userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await seedDevelopmentData(pool);
      await seedDevelopmentData(pool);
      const seedCount = await pool.query<{ count: string }>(
        "select count(*) from users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003')",
      );
      expect(seedCount.rows[0]?.count).toBe("3");

      const activeSeeds = await pool.query<{ count: string }>(
        "select count(*) from users where status='ACTIVE' and password_hash like '$argon2id$%'",
      );
      expect(activeSeeds.rows[0]?.count).toBe("3");

      await expect(
        pool.query(
          `insert into visit_reschedules(
             id,visit_id,old_scheduled_at,new_scheduled_at,old_timezone,new_timezone,reason,actor_user_id
           ) values(
             $1,'30000000-0000-4000-8000-000000000001',now(),now(),
             'America/Guayaquil','America/Guayaquil','Sin cambio',$2
           )`,
          [randomUUID(), "00000000-0000-4000-8000-000000000002"],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const rescheduleId = randomUUID();
      await pool.query(
        `insert into visit_reschedules(
           id,visit_id,old_scheduled_at,new_scheduled_at,old_timezone,new_timezone,reason,actor_user_id
         ) values(
           $1,'30000000-0000-4000-8000-000000000001',now(),now()+interval '1 day',
           'America/Guayaquil','America/Guayaquil','Cambio válido',$2
         )`,
        [rescheduleId, "00000000-0000-4000-8000-000000000002"],
      );
      await expect(
        pool.query("update visit_reschedules set reason='Mutado' where id=$1", [rescheduleId]),
      ).rejects.toMatchObject({ code: "P0001" });
      await expect(
        pool.query("delete from visit_reschedules where id=$1", [rescheduleId]),
      ).rejects.toMatchObject({ code: "P0001" });

      await expect(
        pool.query(
          "insert into reminders(id,scheduled_at,job_key) values($1,now(),'invalid-no-target')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const auditId = randomUUID();
      await pool.query(
        "insert into audit_logs (id, action, entity_type, request_id) values ($1, 'TEST', 'foundation', 'request-test')",
        [auditId],
      );
      await expect(
        pool.query("update audit_logs set action = 'MUTATED' where id = $1", [auditId]),
      ).rejects.toMatchObject({ code: "P0001" });

      const deviceId = randomUUID();
      await pool.query(
        "insert into devices (id, user_id, name, platform) values ($1, $2, 'Test', 'PLAYWRIGHT')",
        [deviceId, userId],
      );
      const clientOperationId = randomUUID();
      await pool.query(
        `insert into sync_operations (
           id, device_id, client_operation_id, sequence, entity_type, entity_id,
           action, payload_hash, occurred_at
         ) values ($1, $2, $3, 1, 'account', $4, 'PATCH', $5, now())`,
        [randomUUID(), deviceId, clientOperationId, randomUUID(), "a".repeat(64)],
      );
      await expect(
        pool.query(
          `insert into sync_operations (
             id, device_id, client_operation_id, sequence, entity_type, entity_id,
             action, payload_hash, occurred_at
           ) values ($1, $2, $3, 2, 'account', $4, 'PATCH', $5, now())`,
          [randomUUID(), deviceId, clientOperationId, randomUUID(), "b".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);

  it("upgrades a database at 0000 through the Phase 1 corrective schema", async () => {
    const container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      const initial = await readFile(
        new URL("../migrations/0000_initial.sql", import.meta.url),
        "utf8",
      );
      for (const statement of initial
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await pool.query(statement);
      }
      expect(
        (
          await pool.query<{ table_name: string | null }>(
            "select to_regclass('public.visit_reschedules')::text table_name",
          )
        ).rows[0]?.table_name,
      ).toBeNull();
      const online = await readFile(
        new URL("../migrations/0001_online_vertical.sql", import.meta.url),
        "utf8",
      );
      for (const statement of online
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await pool.query(statement);
      }
      const corrective = await readFile(
        new URL("../migrations/0002_accounts_gps_fruits.sql", import.meta.url),
        "utf8",
      );
      for (const statement of corrective
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await pool.query(statement);
      }
      expect(
        (
          await pool.query<{ table_name: string | null }>(
            "select to_regclass('public.visit_reschedules')::text table_name",
          )
        ).rows[0]?.table_name,
      ).toBe("visit_reschedules");
      expect(
        (
          await pool.query<{ table_name: string | null }>(
            "select to_regclass('public.reminders')::text table_name",
          )
        ).rows[0]?.table_name,
      ).toBe("reminders");
      expect(
        (
          await pool.query(
            "select column_name from information_schema.columns where table_name='user_sessions' and column_name='csrf_token_hash'",
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query<{ table_name: string | null }>(
            "select to_regclass('public.commercial_account_fruits')::text table_name",
          )
        ).rows[0]?.table_name,
      ).toBe("commercial_account_fruits");
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);

  it("upgrades a populated 0002 database to 0003 without losing data", async () => {
    const container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const ownerId = randomUUID();
    const accountId = randomUUID();
    const fruitId = randomUUID();
    const contactId = randomUUID();
    const visitId = randomUUID();
    const taskId = randomUUID();
    try {
      await applySqlMigration(pool, "0000_initial.sql");
      await applySqlMigration(pool, "0001_online_vertical.sql");
      await applySqlMigration(pool, "0002_accounts_gps_fruits.sql");
      await pool.query(
        "insert into users(id,username,full_name,role,password_hash) values($1,'existing.owner','Existing Owner','SUPERVISOR','argon2id-placeholder')",
        [ownerId],
      );
      await pool.query(
        "insert into fruits(id,name,normalized_name,created_by,updated_by) values($1,'Mango','mango',$2,$2)",
        [fruitId, ownerId],
      );
      await pool.query(
        `insert into commercial_accounts(id,display_name,normalized_display_name,account_type,owner_user_id,country_code,city,phone,created_by,updated_by)
         values($1,'Cuenta existente','cuenta existente','COMPANY',$2,'EC','Machala','+593700001001',$2,$2)`,
        [accountId, ownerId],
      );
      await pool.query(
        "insert into commercial_account_fruits(account_id,fruit_id,created_by) values($1,$2,$3)",
        [accountId, fruitId, ownerId],
      );
      await pool.query(
        `insert into commercial_contacts(id,account_id,full_name,normalized_full_name,phone,is_primary,created_by,updated_by)
         values($1,$2,'Contacto existente','contacto existente','+593700001002',true,$3,$3)`,
        [contactId, accountId, ownerId],
      );
      await pool.query(
        `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,created_by,updated_by)
         values($1,$2,$3,now()+interval '1 day','America/Guayaquil','Visita existente','MEDIUM',$3,$3)`,
        [visitId, accountId, ownerId],
      );
      await pool.query(
        `insert into tasks(id,account_id,responsible_user_id,title,due_date,timezone,priority,created_by,updated_by)
         values($1,$2,$3,'Tarea existente',current_date+1,'America/Guayaquil','MEDIUM',$3,$3)`,
        [taskId, accountId, ownerId],
      );

      await applySqlMigration(pool, "0003_phase2_sync.sql");

      const existing = await pool.query<{
        data: {
          fruitIds: string[];
          fruits: { id: string; name: string }[];
          ownerFullName: string;
          primaryContactName: string;
        };
      }>(
        "select data from change_log where entity_type='ACCOUNT' and entity_id=$1 order by cursor desc limit 1",
        [accountId],
      );
      expect(existing.rows[0]!.data).toMatchObject({
        fruitIds: [fruitId],
        fruits: [{ id: fruitId, name: "Mango" }],
        ownerFullName: "Existing Owner",
        primaryContactName: "Contacto existente",
      });
      expect(
        (
          await pool.query<{ count: string }>(
            "select count(*) from visits where id=$1 union all select count(*) from tasks where id=$2",
            [visitId, taskId],
          )
        ).rows.map((row) => row.count),
      ).toEqual(["1", "1"]);

      await pool.query(
        "update commercial_accounts set city='Guayaquil',version=version+1,updated_at=now() where id=$1",
        [accountId],
      );
      const changed = await pool.query<{ data: { city: string; fruitIds: string[] } }>(
        "select data from change_log where entity_type='ACCOUNT' and entity_id=$1 order by cursor desc limit 1",
        [accountId],
      );
      expect(changed.rows[0]!.data).toMatchObject({ city: "Guayaquil", fruitIds: [fruitId] });
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);

  it("upgrades a populated 0004 database through 0008 with immutable histories enabled", async () => {
    const container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const managerId = randomUUID();
    const supervisorId = randomUUID();
    const functionalAuditId = randomUUID();
    const securityAuditId = randomUUID();
    const managerExportId = randomUUID();
    const supervisorExportId = randomUUID();
    const importBatchId = randomUUID();
    const accountId = randomUUID();
    const visitId = randomUUID();
    try {
      await applySqlMigration(pool, "0000_initial.sql");
      await applySqlMigration(pool, "0001_online_vertical.sql");
      await applySqlMigration(pool, "0002_accounts_gps_fruits.sql");
      await applySqlMigration(pool, "0003_phase2_sync.sql");
      await pool.query(
        `insert into users(id,username,full_name,role,password_hash)
         values
           ($1,'populated.manager','Populated Manager','MANAGER','argon2id-placeholder'),
           ($2,'populated.supervisor','Populated Supervisor','SUPERVISOR','argon2id-placeholder')`,
        [managerId, supervisorId],
      );
      await applySqlMigration(pool, "0004_phase3_operations.sql");
      await pool.query(
        `insert into commercial_accounts(id,display_name,normalized_display_name,account_type,
           owner_user_id,country_code,city,phone,created_by,updated_by)
         values($1,'Cuenta de migración','cuenta de migracion','COMPANY',$2,'EC','Quito','+593200000001',$2,$2)`,
        [accountId, managerId],
      );
      await pool.query(
        `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,
           status,observation,actual_ended_at,completed_by,created_by,updated_by)
         values($1,$2,$3,now()-interval '1 day','America/Guayaquil','Cierre histórico','MEDIUM',
           'COMPLETED','Cierre histórico',now(),$3,$3,$3)`,
        [visitId, accountId, managerId],
      );
      await pool.query(
        `insert into audit_logs(id,actor_user_id,action,entity_type,request_id)
         values
           ($1,$3,'ACCOUNT_UPDATED','commercial_account','migration-functional'),
           ($2,$4,'SESSION_REVOKED','session','migration-security')`,
        [functionalAuditId, securityAuditId, managerId, supervisorId],
      );
      await pool.query(
        `with clock as (select statement_timestamp() created_at)
         insert into report_exports(
           id,requester_user_id,report_group,template,format,timezone,status,created_at,expires_at
         )
         select $1,$2,'ACCOUNTS','directory','PDF','America/Guayaquil','QUEUED',
                created_at,created_at+interval '7 days'
         from clock`,
        [managerExportId, managerId],
      );
      await pool.query(
        `with clock as (select statement_timestamp() created_at)
         insert into report_exports(
           id,requester_user_id,report_group,template,format,timezone,status,created_at,expires_at
         )
         select $1,$2,'TASKS','open','XLSX','America/Guayaquil','QUEUED',
                created_at,created_at+interval '7 days'
         from clock`,
        [supervisorExportId, supervisorId],
      );
      await pool.query(
        `insert into import_batches(
           id,requester_user_id,format,storage_key,checksum_sha256,status,total_rows,create_rows
         ) values($1,$2,'CSV','imports/populated',$3,'READY',1,1)`,
        [importBatchId, managerId, "a".repeat(64)],
      );

      await applySqlMigration(pool, "0005_phase3_reviewer_fixes.sql");
      await applySqlMigration(pool, "0006_phase3_delivery_retention.sql");
      await applySqlMigration(pool, "0007_phase4_capacity_indexes.sql");
      await applySqlMigration(pool, "0008_visit_reschedule_integrity.sql");
      await applySqlMigration(pool, "0009_remove_user_timezone_notification_retention.sql");
      await applySqlMigration(pool, "0010_connected_commercial_flow.sql");

      const audits = await pool.query<{ id: string; retention_class: string }>(
        "select id,retention_class from audit_logs where id=any($1::uuid[]) order by id",
        [[functionalAuditId, securityAuditId]],
      );
      expect(Object.fromEntries(audits.rows.map((row) => [row.id, row.retention_class]))).toEqual({
        [functionalAuditId]: "FUNCTIONAL",
        [securityAuditId]: "SECURITY",
      });
      const trigger = await pool.query<{ enabled: string }>(
        `select tgenabled enabled
         from pg_trigger
         where tgrelid='audit_logs'::regclass and tgname='audit_logs_append_only'`,
      );
      expect(trigger.rows[0]?.enabled).toBe("O");
      const visitHistoryTrigger = await pool.query<{ enabled: string }>(
        `select tgenabled enabled
         from pg_trigger
         where tgrelid='visit_reschedules'::regclass
           and tgname='visit_reschedules_append_only'`,
      );
      expect(visitHistoryTrigger.rows[0]?.enabled).toBe("O");
      const capacityIndexes = await pool.query<{ count: string }>(
        `select count(*) from pg_indexes
         where schemaname='public'
           and indexname=any($1::text[])`,
        [["commercial_accounts_page_idx", "visits_page_idx", "tasks_page_idx"]],
      );
      expect(capacityIndexes.rows[0]?.count).toBe("3");
      const completedVisit = await pool.query<{ result: string; completed_at: Date | null }>(
        "select result,completed_at from visits where id=$1",
        [visitId],
      );
      expect(completedVisit.rows[0]).toMatchObject({ result: "NO_RESULT" });
      expect(completedVisit.rows[0]?.completed_at).toBeInstanceOf(Date);
      await expect(
        pool.query("update audit_logs set action='MUTATED' where id=$1", [functionalAuditId]),
      ).rejects.toMatchObject({ code: "P0001" });

      const exports = await pool.query<{
        id: string;
        requester_role: string;
        scope_user_id: string | null;
      }>(
        `select id,requester_role,scope_user_id
         from report_exports
         where id=any($1::uuid[])`,
        [[managerExportId, supervisorExportId]],
      );
      expect(Object.fromEntries(exports.rows.map((row) => [row.id, row]))).toMatchObject({
        [managerExportId]: { requester_role: "MANAGER", scope_user_id: null },
        [supervisorExportId]: {
          requester_role: "SUPERVISOR",
          scope_user_id: supervisorId,
        },
      });
      expect(
        (
          await pool.query<{ count: string }>(
            "select count(*) from import_batches where id=$1 and total_rows=1 and create_rows=1",
            [importBatchId],
          )
        ).rows[0]?.count,
      ).toBe("1");

      await pool.query("begin");
      try {
        await pool.query("select set_config('vicam.retention_cleanup','on',true)");
        await pool.query("delete from audit_logs where id=$1", [functionalAuditId]);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
      expect(
        (
          await pool.query<{ count: string }>("select count(*) from audit_logs where id=$1", [
            functionalAuditId,
          ])
        ).rows[0]?.count,
      ).toBe("0");
    } finally {
      await pool.end();
      await container.stop();
    }
  }, 120_000);
});
