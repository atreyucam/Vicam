/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { commercialAccountSchema } from "@vicam/contracts";
import { migrateDatabase, seedDevelopmentData } from "@vicam/db";
import pino from "pino";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { closeIntegrationPool } from "./integration-test-support.js";

const integration = process.env.VICAM_RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:5173";
const config = readApiConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  AUTH_SECRET: "phase2-test-secret-with-at-least-32-characters",
});
const anaId = "00000000-0000-4000-8000-000000000002";
const brunoId = "00000000-0000-4000-8000-000000000003";
const accountId = "10000000-0000-4000-8000-000000000001";
const bananaId = "50000000-0000-4000-8000-000000000001";
const mangoId = "50000000-0000-4000-8000-000000000002";

integration("Phase 2 sync API and database", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let managerAccess: string;
  let supervisorAccess: string;
  let supervisorDevice: string;
  let supervisorGrantToken: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const connectionString = container.getConnectionUri();
    await migrateDatabase({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 5,
      ssl: false,
    });
    pool = new Pool({ connectionString });
    await seedDevelopmentData(pool);
    app = createApp({
      config,
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
    const login = async (username: string, password: string) => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("origin", origin)
        .send({ username, password, deviceName: "Phase2 integration", platform: "test" });
      expect(response.status).toBe(200);
      return response.body.accessToken as string;
    };
    managerAccess = await login("manager.demo", "VicamDev!Manager2026");
    supervisorAccess = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    supervisorDevice = (
      await pool.query<{ id: string }>(
        "select id from devices where user_id=$1 order by created_at desc limit 1",
        [anaId],
      )
    ).rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    if (pool) await closeIntegrationPool(pool);
    await container?.stop();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const syncAuth = () => ({ ...auth(supervisorAccess), "x-offline-grant": supervisorGrantToken });
  const operation = (
    sequence: number,
    entityId: string,
    baseVersion: number,
    payload: Record<string, unknown>,
    changedFields = Object.keys(payload),
  ) => ({
    clientOperationId: randomUUID(),
    sequence,
    entityType: "ACCOUNT",
    entityId,
    action: "UPDATE",
    baseVersion,
    changedFields,
    dependsOn: [],
    payload,
    occurredAt: new Date().toISOString(),
  });

  it("requires online auth, binds grants to user/device, caps 72 hours and revokes device grants", async () => {
    expect(
      (await request(app).post("/api/v1/auth/offline-grants").send({ deviceId: supervisorDevice }))
        .status,
    ).toBe(401);
    const grant = await request(app)
      .post("/api/v1/auth/offline-grants")
      .set(auth(supervisorAccess))
      .send({ deviceId: supervisorDevice });
    expect(grant.status).toBe(201);
    expect(grant.body.grantToken.length).toBeGreaterThan(32);
    supervisorGrantToken = grant.body.grantToken as string;
    expect(new Date(grant.body.expiresAt).getTime() - new Date(grant.body.issuedAt).getTime()).toBe(
      72 * 60 * 60 * 1_000,
    );
    const stored = await pool.query<{ token_hash: string; expires_at: Date; issued_at: Date }>(
      "select token_hash,expires_at,issued_at from offline_grants where id=$1",
      [grant.body.id],
    );
    expect(stored.rows[0]!.token_hash).not.toContain(grant.body.grantToken);
    expect(
      stored.rows[0]!.expires_at.getTime() - stored.rows[0]!.issued_at.getTime(),
    ).toBeLessThanOrEqual(72 * 60 * 60 * 1_000);
    const withoutGrant = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: "0" })
      .set(auth(supervisorAccess));
    expect(withoutGrant.status).toBe(422);
    const wrongGrant = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: "0" })
      .set({ ...auth(supervisorAccess), "x-offline-grant": "x".repeat(64) });
    expect(wrongGrant.status).toBe(403);

    const registered = await request(app)
      .post("/api/v1/devices")
      .set(auth(supervisorAccess))
      .send({ name: "Revocable", platform: "test" });
    expect(registered.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/offline-grants")
          .set(auth(supervisorAccess))
          .send({ deviceId: registered.body.id })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .delete(`/api/v1/devices/${registered.body.id}`)
          .set(auth(supervisorAccess))
      ).status,
    ).toBe(204);
    expect(
      (
        await pool.query<{ count: string }>(
          "select count(*) from offline_grants where device_id=$1 and revoked_at is not null",
          [registered.body.id],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("completes a visit with a linked follow-up task atomically during offline sync", async () => {
    const visitId = "30000000-0000-4000-8000-000000000001";
    const taskId = randomUUID();
    const visit = await pool.query<{ version: number }>("select version from visits where id=$1", [
      visitId,
    ]);
    const operationId = randomUUID();
    const endedAt = new Date().toISOString();
    const completeOperation = {
      clientOperationId: operationId,
      sequence: 10_000,
      entityType: "VISIT",
      entityId: visitId,
      action: "COMPLETE",
      baseVersion: visit.rows[0]!.version,
      changedFields: ["status", "result", "observation", "actualEndedAt"],
      dependsOn: [],
      payload: {
        result: "PROPOSAL_REQUESTED",
        observation: "Cierre sincronizado ficticio",
        actualEndedAt: endedAt,
        followUpTask: {
          id: taskId,
          title: "Enviar propuesta sincronizada",
          responsibleUserId: anaId,
          dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          priority: "HIGH",
        },
      },
      occurredAt: endedAt,
    };
    const pushed = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [completeOperation] });
    expect(pushed.status).toBe(200);
    expect(pushed.body.results[0]).toMatchObject({ status: "APPLIED", entityId: visitId });

    const effects = await pool.query<{
      status: string;
      result: string;
      task_count: number;
      visit_reminders: number;
      domain_audits: number;
    }>(
      `select v.status,v.result::text,
         (select count(*)::integer from tasks t where t.id=$2 and t.account_id=v.account_id and t.visit_id=v.id) task_count,
         (select count(*)::integer from reminders r where r.visit_id=v.id and r.status='PENDING') visit_reminders,
         (select count(*)::integer from audit_logs a where a.entity_id=v.id and a.action='VISIT_COMPLETED') domain_audits
       from visits v where v.id=$1`,
      [visitId, taskId],
    );
    expect(effects.rows[0]).toEqual({
      status: "COMPLETED",
      result: "PROPOSAL_REQUESTED",
      task_count: 1,
      visit_reminders: 0,
      domain_audits: 1,
    });
  });

  it("persists one idempotent effect across app restart and honors dependency order", async () => {
    const base = Number(
      (
        await pool.query<{ version: number }>(
          "select version from commercial_accounts where id=$1",
          [accountId],
        )
      ).rows[0]!.version,
    );
    const op = operation(1, accountId, base, { city: "Daule" });
    const first = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [op] });
    expect(first.status).toBe(200);
    expect(first.body.results[0].status).toBe("APPLIED");
    const restartedApp = createApp({
      config,
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
    const duplicate = await request(restartedApp)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [op] });
    expect(duplicate.body.results[0].status).toBe("DUPLICATE");
    expect(
      (
        await pool.query<{ version: number }>(
          "select version from commercial_accounts where id=$1",
          [accountId],
        )
      ).rows[0]!.version,
    ).toBe(base + 1);

    const newAccount = randomUUID();
    const createAccountId = randomUUID();
    const createContactId = randomUUID();
    const cursorBeforeCreate = (
      await pool.query<{ cursor: string }>(
        "select coalesce(max(cursor),0)::text cursor from change_log",
      )
    ).rows[0]!.cursor;
    const createAccount = {
      clientOperationId: createAccountId,
      sequence: 2,
      entityType: "ACCOUNT",
      entityId: newAccount,
      action: "CREATE",
      baseVersion: null,
      changedFields: [],
      dependsOn: [],
      payload: {
        displayName: "Cuenta offline",
        accountType: "COMPANY",
        ownerUserId: anaId,
        countryCode: "EC",
        city: "Machala",
        phone: "+593700000001",
        fruitIds: [bananaId, mangoId],
      },
      occurredAt: new Date().toISOString(),
    };
    const createContact = {
      clientOperationId: createContactId,
      sequence: 3,
      entityType: "CONTACT",
      entityId: randomUUID(),
      action: "CREATE",
      baseVersion: null,
      changedFields: [],
      dependsOn: [createAccountId],
      payload: {
        accountId: newAccount,
        fullName: "Contacto offline",
        phone: "+593700000002",
        isPrimary: true,
      },
      occurredAt: new Date().toISOString(),
    };
    const dependent = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [createContact, createAccount] });
    expect(dependent.body.results.map((item: { status: string }) => item.status)).toEqual([
      "APPLIED",
      "APPLIED",
    ]);
    expect(
      (
        await pool.query<{ fruit_id: string }>(
          "select fruit_id from commercial_account_fruits where account_id=$1 order by fruit_id",
          [newAccount],
        )
      ).rows.map((row) => row.fruit_id),
    ).toEqual([bananaId, mangoId]);

    const pulled = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: cursorBeforeCreate })
      .set(syncAuth());
    expect(pulled.status).toBe(200);
    const accountChange = pulled.body.changes
      .filter(
        (item: { entityType: string; entityId: string }) =>
          item.entityType === "ACCOUNT" && item.entityId === newAccount,
      )
      .at(-1);
    const account = commercialAccountSchema.parse(accountChange.data);
    expect(account).toMatchObject({
      id: newAccount,
      fruitIds: [bananaId, mangoId],
      ownerFullName: "Ana Supervisora",
      primaryContactName: "Contacto offline",
    });
    expect(account.fruits).toEqual([
      { id: bananaId, name: "Banano" },
      { id: mangoId, name: "Mango" },
    ]);
  });

  it("blocks Supervisor ownership bypasses by ID, pull and push while Manager retains access", async () => {
    const visitId = randomUUID();
    const taskId = randomUUID();
    const contactId = randomUUID();
    const completedVisitId = randomUUID();
    const completedTaskId = randomUUID();
    const before = (
      await pool.query<{ cursor: string }>(
        "select coalesce(max(cursor),0)::text cursor from change_log",
      )
    ).rows[0]!.cursor;
    await pool.query(
      `insert into commercial_contacts(id,account_id,full_name,normalized_full_name,phone,is_primary,created_by,updated_by)
       values($1,$2,'Contacto autorizado','contacto autorizado','+593700000099',false,$3,$3)`,
      [contactId, accountId, anaId],
    );
    await pool.query(
      `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,created_by,updated_by)
       values($1,$2,$3,now()+interval '3 days','America/Guayaquil','Visita ajena','MEDIUM',$3,$3)`,
      [visitId, accountId, brunoId],
    );
    await pool.query(
      `insert into tasks(id,account_id,responsible_user_id,title,due_date,timezone,priority,created_by,updated_by)
       values($1,$2,$3,'Tarea ajena',current_date+3,'America/Guayaquil','MEDIUM',$3,$3)`,
      [taskId, accountId, brunoId],
    );
    await pool.query(
      `insert into visits(id,account_id,responsible_user_id,scheduled_at,timezone,reason,priority,status,result,observation,actual_ended_at,completed_at,completed_by,created_by,updated_by)
       values($1,$2,$3,now()-interval '1 day','America/Guayaquil','Visita finalizada','MEDIUM','COMPLETED','NO_RESULT','Finalizada',now(),now(),$3,$3,$3)`,
      [completedVisitId, accountId, anaId],
    );
    await pool.query(
      `insert into tasks(id,account_id,responsible_user_id,title,due_date,timezone,priority,status,completed_at,completed_by,created_by,updated_by)
       values($1,$2,$3,'Tarea finalizada',current_date-1,'America/Guayaquil','MEDIUM','COMPLETED',now(),$3,$3,$3)`,
      [completedTaskId, accountId, anaId],
    );

    expect(
      (await request(app).get(`/api/v1/visits/${visitId}`).set(auth(supervisorAccess))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/tasks/${taskId}`).set(auth(supervisorAccess))).status,
    ).toBe(404);

    const supervisorPull = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: before })
      .set(syncAuth());
    expect(supervisorPull.status).toBe(200);
    expect(
      supervisorPull.body.changes.map((item: { entityId: string }) => item.entityId),
    ).toContain(contactId);
    expect(
      supervisorPull.body.changes.map((item: { entityId: string }) => item.entityId),
    ).not.toContain(visitId);
    expect(
      supervisorPull.body.changes.map((item: { entityId: string }) => item.entityId),
    ).not.toContain(taskId);
    expect(
      supervisorPull.body.changes.find(
        (item: { entityId: string }) => item.entityId === completedVisitId,
      ),
    ).toMatchObject({ operation: "DELETE", data: null });
    expect(
      supervisorPull.body.changes.find(
        (item: { entityId: string }) => item.entityId === completedTaskId,
      ),
    ).toMatchObject({ operation: "DELETE", data: null });

    const bypassOperations = [
      {
        clientOperationId: randomUUID(),
        sequence: 10,
        entityType: "VISIT",
        entityId: visitId,
        action: "UPDATE",
        baseVersion: 1,
        changedFields: ["reason"],
        dependsOn: [],
        payload: { reason: "Bypass visita" },
        occurredAt: new Date().toISOString(),
      },
      {
        clientOperationId: randomUUID(),
        sequence: 11,
        entityType: "TASK",
        entityId: taskId,
        action: "UPDATE",
        baseVersion: 1,
        changedFields: ["title"],
        dependsOn: [],
        payload: { title: "Bypass tarea" },
        occurredAt: new Date().toISOString(),
      },
    ];
    const bypass = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: bypassOperations });
    expect(bypass.status).toBe(200);
    expect(bypass.body.results).toMatchObject([
      { status: "REJECTED", code: "ACCESS_REVOKED" },
      { status: "REJECTED", code: "ACCESS_REVOKED" },
    ]);

    const managerDevice = (
      await pool.query<{ id: string }>(
        "select id from devices where user_id=$1 order by created_at desc limit 1",
        ["00000000-0000-4000-8000-000000000001"],
      )
    ).rows[0]!.id;
    const managerGrant = await request(app)
      .post("/api/v1/auth/offline-grants")
      .set(auth(managerAccess))
      .send({ deviceId: managerDevice });
    expect(managerGrant.status).toBe(201);
    const managerPull = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: managerDevice, cursor: before })
      .set({ ...auth(managerAccess), "x-offline-grant": managerGrant.body.grantToken });
    expect(managerPull.status).toBe(200);
    expect(managerPull.body.changes.map((item: { entityId: string }) => item.entityId)).toEqual(
      expect.arrayContaining([contactId, visitId, taskId]),
    );

    const archivedAccountId = randomUUID();
    await pool.query(
      `insert into commercial_accounts(
         id,display_name,normalized_display_name,account_type,owner_user_id,country_code,city,phone,
         created_by,updated_by
       ) values($1,'Cuenta para archivar','cuenta para archivar','COMPANY',$2,'EC','Quito',
         '+593700000077',$2,$2)`,
      [archivedAccountId, anaId],
    );
    const beforeArchive = (
      await pool.query<{ cursor: string }>("select max(cursor)::text cursor from change_log")
    ).rows[0]!.cursor;
    await pool.query(
      `update commercial_accounts
       set status='ARCHIVED',archived_at=now(),version=version+1,updated_at=now(),updated_by=$2
       where id=$1`,
      [archivedAccountId, anaId],
    );
    const archivedPull = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: beforeArchive })
      .set(syncAuth());
    expect(archivedPull.body.changes).toContainEqual(
      expect.objectContaining({ entityId: archivedAccountId, operation: "DELETE", data: null }),
    );
    expect(archivedPull.body.purgeAccountIds).toContain(archivedAccountId);
  });

  it("merges disjoint fields, creates same-field conflict and enforces Manager-only resolution", async () => {
    const base = (
      await pool.query<{ version: number }>("select version from commercial_accounts where id=$1", [
        accountId,
      ])
    ).rows[0]!.version;
    await pool.query(
      "update commercial_accounts set phone='+593499999999',version=version+1,updated_at=now() where id=$1",
      [accountId],
    );
    const merged = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({
        deviceId: supervisorDevice,
        operations: [operation(4, accountId, base, { city: "Samborondón" })],
      });
    expect(merged.body.results[0].status).toBe("MERGED");

    const fruitBase = (
      await pool.query<{ version: number }>("select version from commercial_accounts where id=$1", [
        accountId,
      ])
    ).rows[0]!.version;
    const fruitUpdate = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({
        deviceId: supervisorDevice,
        operations: [operation(91, accountId, fruitBase, { fruitIds: [mangoId] })],
      });
    expect(fruitUpdate.body.results[0]).toMatchObject({ status: "APPLIED", code: null });
    expect(
      (
        await pool.query<{ fruit_id: string }>(
          "select fruit_id from commercial_account_fruits where account_id=$1",
          [accountId],
        )
      ).rows.map((row) => row.fruit_id),
    ).toEqual([mangoId]);

    const onlineFruitUpdate = await request(app)
      .patch(`/api/v1/commercial-accounts/${accountId}`)
      .set(auth(supervisorAccess))
      .set("idempotency-key", "phase2-online-fruit-conflict-0001")
      .send({ version: fruitBase + 1, fruitIds: [] });
    expect(onlineFruitUpdate.status).toBe(200);
    const fruitConflict = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({
        deviceId: supervisorDevice,
        operations: [operation(92, accountId, fruitBase + 1, { fruitIds: [mangoId] })],
      });
    expect(fruitConflict.body.results[0]).toMatchObject({
      status: "CONFLICT",
      code: "SAME_FIELD_CHANGED",
    });

    const nextBase = (
      await pool.query<{ version: number }>("select version from commercial_accounts where id=$1", [
        accountId,
      ])
    ).rows[0]!.version;
    await pool.query(
      "update commercial_accounts set city='Milagro',version=version+1,updated_at=now() where id=$1",
      [accountId],
    );
    const conflict = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({
        deviceId: supervisorDevice,
        operations: [operation(5, accountId, nextBase, { city: "Naranjal" })],
      });
    expect(conflict.body.results[0].status).toBe("CONFLICT");
    expect(conflict.body.results[0].code).toBe("SAME_FIELD_CHANGED");
    const conflictId = conflict.body.results[0].conflictId as string;
    expect(
      (
        await request(app)
          .post(`/api/v1/sync/conflicts/${conflictId}/resolve`)
          .set(auth(supervisorAccess))
          .send({ resolution: "SERVER" })
      ).status,
    ).toBe(403);
    await pool.query(
      "update commercial_accounts set city='Daule',version=version+1,updated_at=now() where id=$1",
      [accountId],
    );
    const currentServerVersion = (
      await pool.query<{ version: number }>("select version from commercial_accounts where id=$1", [
        accountId,
      ])
    ).rows[0]!.version;
    const resolved = await request(app)
      .post(`/api/v1/sync/conflicts/${conflictId}/resolve`)
      .set(auth(managerAccess))
      .send({ resolution: "SERVER" });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      status: "RESOLVED",
      serverVersion: currentServerVersion,
      server: { city: "Daule" },
    });
  });

  it("preserves an ACCESS_REVOKED conflict when a pending offline edit loses ownership", async () => {
    const reassignedAccountId = randomUUID();
    const sensitiveDeviceValue = "Edición offline reservada que no debe exponerse";
    await pool.query(
      `insert into commercial_accounts(
         id,display_name,normalized_display_name,account_type,owner_user_id,country_code,city,phone,
         created_by,updated_by
       ) values($1,'Cuenta para reasignar','cuenta para reasignar','COMPANY',$2,'EC','Quito',
         '+593700000088',$2,$2)`,
      [reassignedAccountId, anaId],
    );
    const cursorBeforeReassignment = (
      await pool.query<{ cursor: string }>("select max(cursor)::text cursor from change_log")
    ).rows[0]!.cursor;
    const pendingOperation = operation(90, reassignedAccountId, 1, {
      address: sensitiveDeviceValue,
    });
    await pool.query(
      `update commercial_accounts
       set owner_user_id=$2,version=version+1,updated_at=now(),updated_by=$2 where id=$1`,
      [reassignedAccountId, brunoId],
    );

    const pushed = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [pendingOperation] });
    expect(pushed.status).toBe(200);
    expect(pushed.body.results[0]).toMatchObject({
      status: "CONFLICT",
      code: "ACCESS_REVOKED",
      entityId: reassignedAccountId,
    });
    const conflictId = pushed.body.results[0].conflictId as string;
    expect(
      (
        await pool.query<{ address: string | null; owner_user_id: string }>(
          "select address,owner_user_id from commercial_accounts where id=$1",
          [reassignedAccountId],
        )
      ).rows[0],
    ).toEqual({ address: null, owner_user_id: brunoId });

    const purge = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: cursorBeforeReassignment })
      .set(syncAuth());
    expect(purge.body.purgeAccountIds).toContain(reassignedAccountId);

    const managerConflict = (
      await request(app).get("/api/v1/sync/conflicts").set(auth(managerAccess))
    ).body.find((item: { id: string }) => item.id === conflictId);
    expect(managerConflict).toMatchObject({
      code: "ACCESS_REVOKED",
      device: { address: sensitiveDeviceValue },
      status: "OPEN",
    });
    const supervisorConflict = (
      await request(app).get("/api/v1/sync/conflicts").set(auth(supervisorAccess))
    ).body.find((item: { id: string }) => item.id === conflictId);
    expect(supervisorConflict).toMatchObject({
      code: "ACCESS_REVOKED",
      base: {},
      server: {},
      device: {},
      status: "OPEN",
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/sync/conflicts/${conflictId}/resolve`)
          .set(auth(supervisorAccess))
          .send({ resolution: "SERVER" })
      ).status,
    ).toBe(403);

    const replay = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations: [pendingOperation] });
    expect(replay.body.results[0]).toMatchObject({
      status: "DUPLICATE",
      code: "ACCESS_REVOKED",
      conflictId,
    });
    const evidence = await pool.query<{ operations: string; conflicts: string }>(
      `select count(distinct o.id)::text operations,count(distinct c.id)::text conflicts
       from sync_operations o left join sync_conflicts c on c.operation_id=o.id
       where o.device_id=$1 and o.client_operation_id=$2`,
      [supervisorDevice, pendingOperation.clientOperationId],
    );
    expect(evidence.rows[0]).toEqual({ operations: "1", conflicts: "1" });
    const auditLeak = await pool.query<{ count: string }>(
      "select count(*)::text count from audit_logs where after_changes::text like $1",
      [`%${sensitiveDeviceValue}%`],
    );
    expect(auditLeak.rows[0]!.count).toBe("0");
  });

  it("returns reassignment purge/tombstone, filters unauthorized entities and excludes files", async () => {
    const brunoLogin = await request(app).post("/api/v1/auth/login").set("origin", origin).send({
      username: "supervisor.bruno",
      password: "VicamDev!SupervisorB2026",
      deviceName: "Phase2 reassignment",
      platform: "test",
    });
    expect(brunoLogin.status).toBe(200);
    const brunoAccess = brunoLogin.body.accessToken as string;
    const brunoDevice = (
      await pool.query<{ id: string }>(
        "select id from devices where user_id=$1 order by created_at desc limit 1",
        [brunoId],
      )
    ).rows[0]!.id;
    const brunoGrant = await request(app)
      .post("/api/v1/auth/offline-grants")
      .set(auth(brunoAccess))
      .send({ deviceId: brunoDevice });
    expect(brunoGrant.status).toBe(201);
    await pool.query(
      "update visits set responsible_user_id=$2,version=version+1,updated_at=now() where account_id=$1",
      [accountId, brunoId],
    );
    await pool.query(
      "update tasks set responsible_user_id=$2,version=version+1,updated_at=now() where account_id=$1",
      [accountId, brunoId],
    );
    const before = (
      await pool.query<{ cursor: string }>("select max(cursor)::text cursor from change_log")
    ).rows[0]!.cursor;
    await pool.query(
      "update commercial_accounts set owner_user_id=$2,version=version+1,updated_at=now() where id=$1",
      [accountId, brunoId],
    );
    const pull = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: supervisorDevice, cursor: before })
      .set(syncAuth());
    expect(pull.status).toBe(200);
    expect(pull.body.purgeAccountIds).toContain(accountId);
    expect(
      pull.body.changes.some(
        (item: { entityType: string; operation: string }) =>
          item.entityType === "ACCOUNT" && item.operation === "REVOKE",
      ),
    ).toBe(true);
    expect(
      pull.body.changes.every((item: { entityType: string }) =>
        ["ACCOUNT", "CONTACT", "VISIT", "TASK"].includes(item.entityType),
      ),
    ).toBe(true);
    const newOwnerPull = await request(app)
      .get("/api/v1/sync/pull")
      .query({ deviceId: brunoDevice, cursor: before })
      .set({
        ...auth(brunoAccess),
        "x-offline-grant": brunoGrant.body.grantToken as string,
      });
    expect(newOwnerPull.status).toBe(200);
    expect(
      new Set(newOwnerPull.body.changes.map((item: { entityType: string }) => item.entityType)),
    ).toEqual(new Set(["ACCOUNT", "CONTACT", "VISIT", "TASK"]));
    const forbiddenDocument = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({
        deviceId: supervisorDevice,
        operations: [{ ...operation(6, randomUUID(), 1, {}), entityType: "DOCUMENT" }],
      });
    expect(forbiddenDocument.status).toBe(422);
    await pool.query(
      "update commercial_accounts set owner_user_id=$2,version=version+1,updated_at=now() where id=$1",
      [accountId, anaId],
    );
  });

  it("syncs 100 structured operations in less than 30 seconds", async () => {
    const operations = Array.from({ length: 100 }, (_, index) => ({
      clientOperationId: randomUUID(),
      sequence: index + 100,
      entityType: "TASK",
      entityId: randomUUID(),
      action: "CREATE",
      baseVersion: null,
      changedFields: [],
      dependsOn: [],
      payload: {
        accountId,
        responsibleUserId: anaId,
        title: `Tarea offline ${index}`,
        dueDate: "2026-08-01",
        timezone: "America/Guayaquil",
        priority: "MEDIUM",
      },
      occurredAt: new Date().toISOString(),
    }));
    const started = performance.now();
    const response = await request(app)
      .post("/api/v1/sync/push")
      .set(syncAuth())
      .send({ deviceId: supervisorDevice, operations });
    const elapsed = performance.now() - started;
    console.info(`sync-100-elapsed-ms=${Math.round(elapsed)}`);
    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(100);
    expect(
      response.body.results.every((item: { status: string }) => item.status === "APPLIED"),
    ).toBe(true);
    expect(elapsed).toBeLessThan(30_000);
  }, 40_000);
});
