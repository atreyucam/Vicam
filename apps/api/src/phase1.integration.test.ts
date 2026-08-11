/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrateDatabase, seedDevelopmentData } from "@vicam/db";
import pino from "pino";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { executeManagerPasswordReset } from "./cli/reset-manager-password.js";
import { requestHash } from "./db.js";
import { closeIntegrationPool } from "./integration-test-support.js";

const integration = process.env.VICAM_RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:5173";
const config = readApiConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
});

function setCookieHeaders(response: request.Response): string[] {
  const value = response.headers["set-cookie"];
  const headers = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (headers.length === 0) throw new Error("session cookies missing");
  return headers;
}

function cookieHeader(response: request.Response, name: string): string {
  const header = setCookieHeaders(response).find((value) => value.startsWith(`${name}=`));
  if (header === undefined) throw new Error(`${name} cookie missing`);
  return header;
}

function cookiePair(response: request.Response, name: string): string {
  return cookieHeader(response, name).split(";", 1)[0]!;
}

function cookieValue(pair: string): string {
  return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}

function browserCookies(response: request.Response) {
  const refresh = cookiePair(response, "vicam_refresh");
  const csrf = cookiePair(response, "vicam_csrf");
  return { refresh, csrf, header: `${refresh}; ${csrf}` };
}

async function waitForBlockedTransactions(pool: Pool, minimum: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ total: number }>(
      `select count(*)::integer total from pg_stat_activity
       where datname=current_database() and cardinality(pg_blocking_pids(pid)) > 0`,
    );
    if ((blocked.rows[0]?.total ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${minimum} blocked transactions`);
}

integration("Phase 1 online API", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let productionApp: ReturnType<typeof createApp>;
  let directApp: ReturnType<typeof createApp>;
  let untrustedProxyTestApp: ReturnType<typeof createApp>;

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
    productionApp = createApp({
      config: { ...config, NODE_ENV: "production" },
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
    directApp = createApp({
      config: {
        ...config,
        NODE_ENV: "production",
        CADDY_TRUSTED_PROXIES: ["10.20.0.2/32"],
      },
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
    untrustedProxyTestApp = createApp({
      config: { ...config, CADDY_TRUSTED_PROXIES: ["10.20.0.2/32"] },
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
  }, 120_000);

  afterAll(async () => {
    if (pool) await closeIntegrationPool(pool);
    await container?.stop();
  });

  async function login(username: string, password: string) {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .send({ username, password, deviceName: "Supertest", platform: "test" });
    expect(response.status).toBe(200);
    const cookies = browserCookies(response);
    return {
      access: response.body.accessToken as string,
      csrf: response.body.csrfToken as string,
      csrfCookie: cookieValue(cookies.csrf),
      cookie: cookies.header,
    };
  }

  it("restores CSRF after a browser restart and rotates refresh tokens with reuse detection", async () => {
    const wrongOrigin = await request(app)
      .post("/api/v1/auth/login")
      .set("origin", "https://evil.example")
      .send({ username: "manager.demo", password: "VicamDev!Manager2026" });
    expect(wrongOrigin.status).toBe(403);

    const rejectedDirect = await request(directApp)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .set("x-forwarded-for", "198.51.100.25")
      .set("x-forwarded-proto", "https")
      .send({
        username: "manager.demo",
        password: "VicamDev!Manager2026",
        deviceName: "Direct spoof test",
        platform: "test",
      });
    expect(rejectedDirect.status).toBe(403);
    expect(rejectedDirect.body.code).toBe("HTTPS_REQUIRED");

    const productionLogin = await request(productionApp)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .set("x-forwarded-for", "198.51.100.25")
      .set("x-forwarded-proto", "https")
      .send({
        username: "manager.demo",
        password: "VicamDev!Manager2026",
        deviceName: "Secure cookie test",
        platform: "test",
      });
    expect(cookieHeader(productionLogin, "vicam_refresh")).toContain("Secure");
    expect(cookieHeader(productionLogin, "vicam_csrf")).toContain("Secure");

    const session = await login("manager.demo", "VicamDev!Manager2026");
    expect(session.csrfCookie).toBe(session.csrf);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${session.access}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("MANAGER");

    const noCsrf = await request(app)
      .post("/api/v1/auth/refresh")
      .set("origin", origin)
      .set("cookie", session.cookie);
    expect(noCsrf.status).toBe(403);

    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .set("origin", origin)
      .set("cookie", session.cookie)
      .set("x-csrf-token", session.csrfCookie);
    expect(rotated.status).toBe(200);
    const rotatedCookies = browserCookies(rotated);
    const rotatedCsrf = cookieValue(rotatedCookies.csrf);
    expect(rotatedCsrf).toBe(rotated.body.csrfToken);
    expect(rotatedCsrf).not.toBe(session.csrfCookie);
    expect(cookieHeader(rotated, "vicam_refresh")).toContain("HttpOnly");
    expect(cookieHeader(rotated, "vicam_csrf")).not.toContain("HttpOnly");
    expect(cookieHeader(rotated, "vicam_csrf")).toContain("Path=/;");
    const reused = await request(app)
      .post("/api/v1/auth/refresh")
      .set("origin", origin)
      .set("cookie", session.cookie)
      .set("x-csrf-token", session.csrfCookie);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe("REFRESH_TOKEN_REUSED");
    const familyRevoked = await request(app)
      .post("/api/v1/auth/refresh")
      .set("origin", origin)
      .set("cookie", rotatedCookies.header)
      .set("x-csrf-token", rotatedCsrf);
    expect(familyRevoked.status).toBe(401);
  });

  it("returns 404 for horizontal URL access and keeps paginated scope", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const headers = { authorization: `Bearer ${ana.access}` };
    const own = await request(app)
      .get("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001")
      .set(headers);
    expect(own.status).toBe(200);
    const foreign = await request(app)
      .get("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000002")
      .set(headers);
    expect(foreign.status).toBe(404);
    const foreignVisit = await request(app)
      .get("/api/v1/visits/30000000-0000-4000-8000-000000000002")
      .set(headers);
    expect(foreignVisit.status).toBe(404);
    const foreignTask = await request(app)
      .get("/api/v1/tasks/40000000-0000-4000-8000-000000000002")
      .set(headers);
    expect(foreignTask.status).toBe(404);
    const page = await request(app)
      .get("/api/v1/commercial-accounts?page=1&pageSize=1")
      .set(headers);
    expect(page.status).toBe(200);
    expect(page.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });

  it("completes the visit transactionally, cancels reminders and exposes safe audit only to Manager", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const visit = await request(app)
      .get("/api/v1/visits/30000000-0000-4000-8000-000000000001")
      .set("authorization", `Bearer ${ana.access}`);
    const endedAt = new Date().toISOString();
    const followUpTask = {
      id: "41000000-0000-4000-8000-000000000001",
      title: "Dar seguimiento al cierre ficticio",
      responsibleUserId: "00000000-0000-4000-8000-000000000002",
      dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      priority: "HIGH",
    };
    const completed = await request(app)
      .post("/api/v1/visits/30000000-0000-4000-8000-000000000001/complete")
      .set("authorization", `Bearer ${ana.access}`)
      .set("idempotency-key", "complete-seed-visit-0001")
      .send({
        result: "INTERESTED",
        observation: "Cierre ficticio satisfactorio",
        actualEndedAt: endedAt,
        followUpTask,
        version: visit.body.version,
      });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: "COMPLETED", result: "INTERESTED" });
    const replay = await request(app)
      .post("/api/v1/visits/30000000-0000-4000-8000-000000000001/complete")
      .set("authorization", `Bearer ${ana.access}`)
      .set("idempotency-key", "complete-seed-visit-0001")
      .send({
        result: "INTERESTED",
        observation: "Cierre ficticio satisfactorio",
        actualEndedAt: endedAt,
        followUpTask,
        version: visit.body.version,
      });
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(completed.body.version);
    const detail = await request(app)
      .get("/api/v1/visits/30000000-0000-4000-8000-000000000001")
      .set("authorization", `Bearer ${ana.access}`);
    expect(detail.status).toBe(200);
    expect(detail.body.history.at(-1)).toMatchObject({
      type: "COMPLETED",
      result: "INTERESTED",
      actorFullName: "Ana Supervisora",
    });
    const taskDetail = await request(app)
      .get(`/api/v1/tasks/${followUpTask.id}`)
      .set("authorization", `Bearer ${ana.access}`);
    expect(taskDetail.status).toBe(200);
    expect(taskDetail.body).toMatchObject({
      visitId: "30000000-0000-4000-8000-000000000001",
      accountId: "10000000-0000-4000-8000-000000000001",
      title: followUpTask.title,
      visitReason: visit.body.reason,
      createdByFullName: "Ana Supervisora",
    });
    const pending = await pool.query(
      "select count(*)::integer total from reminders where visit_id='30000000-0000-4000-8000-000000000001' and status='PENDING'",
    );
    expect(pending.rows[0]?.total).toBe(0);
    const supervisorAudit = await request(app)
      .get("/api/v1/audit")
      .set("authorization", `Bearer ${ana.access}`);
    expect(supervisorAudit.status).toBe(403);
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const audit = await request(app)
      .get("/api/v1/audit?action=VISIT_COMPLETED&page=1&pageSize=20")
      .set("authorization", `Bearer ${manager.access}`);
    expect(audit.status).toBe(200);
    expect(audit.body.items[0]).toMatchObject({
      action: "VISIT_COMPLETED",
      entityId: "30000000-0000-4000-8000-000000000001",
    });
    expect(JSON.stringify(audit.body)).not.toMatch(/password|token|observation/i);
    const summary = await request(app)
      .get("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001/commercial-summary")
      .set("authorization", `Bearer ${ana.access}`);
    expect(summary.status).toBe(200);
    expect(summary.body.openTaskCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "VISIT_COMPLETED", resourceId: visit.body.id }),
        expect.objectContaining({ type: "TASK_CREATED", resourceId: followUpTask.id }),
      ]),
    );
  });

  it("persists progressive rate limiting without revealing account existence", async () => {
    let response: request.Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++)
      response = await request(untrustedProxyTestApp)
        .post("/api/v1/auth/login")
        .set("origin", origin)
        .set("x-forwarded-for", `203.0.113.${attempt + 10}`)
        .set("x-forwarded-proto", "https")
        .send({ username: "unknown.user", password: "Wrong!Password1" });
    expect(response?.status).toBe(429);
    expect(response?.headers["retry-after"]).toBeDefined();
    const correctShape = await request(untrustedProxyTestApp)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .set("x-forwarded-for", "203.0.113.99")
      .set("x-forwarded-proto", "https")
      .send({ username: "unknown.user", password: "Another!Wrong2" });
    expect(correctShape.status).toBe(429);
  });

  it("derives overdue using the task civil date and timezone", async () => {
    await pool.query(
      `update tasks
       set status='PENDING',
           due_date=(now() at time zone 'America/Guayaquil')::date-1,
           due_time=null,
           timezone='America/Guayaquil'
       where id='40000000-0000-4000-8000-000000000002'`,
    );
    const derived = await pool.query<{ overdue: boolean }>(
      `select (status in ('PENDING','IN_PROGRESS')
        and ((due_date+coalesce(due_time,time '23:59:59')) at time zone timezone)<now()) overdue
       from tasks where id='40000000-0000-4000-8000-000000000002'`,
    );
    expect(derived.rows[0]?.overdue).toBe(true);
    const bruno = await login("supervisor.bruno", "VicamDev!SupervisorB2026");
    const task = await request(app)
      .get("/api/v1/tasks/40000000-0000-4000-8000-000000000002")
      .set("authorization", `Bearer ${bruno.access}`);
    expect(task.status).toBe(200);
    expect(task.body.overdue).toBe(true);
  });

  it("creates tasks without dueTime and schedules end-of-day reminders", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const dueDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const created = await request(app)
      .post("/api/v1/tasks")
      .set("authorization", `Bearer ${ana.access}`)
      .set("idempotency-key", "task-without-due-time-0001")
      .send({
        accountId: "10000000-0000-4000-8000-000000000001",
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        title: "Seguimiento sin hora ficticio",
        dueDate,
        timezone: "America/Guayaquil",
        priority: "MEDIUM",
      });
    expect(created.status).toBe(201);
    expect(created.body.dueTime).toBeNull();
    const persisted = await pool.query<{ due_time: string | null; pending_reminders: number }>(
      `select t.due_time,
         (select count(*)::integer from reminders r where r.task_id=t.id and r.status='PENDING') pending_reminders
       from tasks t where t.id=$1`,
      [created.body.id],
    );
    expect(persisted.rows[0]).toEqual({ due_time: null, pending_reminders: 2 });
  });

  it("lists, revokes and logs out sessions with CSRF protection", async () => {
    const first = await login("supervisor.bruno", "VicamDev!SupervisorB2026");
    const second = await login("supervisor.bruno", "VicamDev!SupervisorB2026");
    const sessions = await request(app)
      .get("/api/v1/auth/sessions")
      .set("authorization", `Bearer ${second.access}`);
    expect(sessions.status).toBe(200);
    const firstSessionId = (
      JSON.parse(Buffer.from(first.access.split(".")[1]!, "base64url").toString("utf8")) as {
        sid: string;
      }
    ).sid;
    const firstSession = sessions.body.find((item: { id: string }) => item.id === firstSessionId);
    expect(firstSession).toBeDefined();
    const revoked = await request(app)
      .delete(`/api/v1/auth/sessions/${firstSession.id}`)
      .set("authorization", `Bearer ${second.access}`)
      .set("idempotency-key", "session-revoke-replay-0001");
    expect(revoked.status).toBe(204);
    const revokeReplay = await request(app)
      .delete(`/api/v1/auth/sessions/${firstSession.id}`)
      .set("authorization", `Bearer ${second.access}`)
      .set("idempotency-key", "session-revoke-replay-0001");
    expect(revokeReplay.status).toBe(204);
    expect(
      (await request(app).get("/api/v1/auth/me").set("authorization", `Bearer ${first.access}`))
        .status,
    ).toBe(401);
    const logoutWithoutCsrf = await request(app)
      .post("/api/v1/auth/logout")
      .set("origin", origin)
      .set("cookie", second.cookie);
    expect(logoutWithoutCsrf.status).toBe(403);
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("origin", origin)
      .set("cookie", second.cookie)
      .set("x-csrf-token", second.csrfCookie)
      .set("idempotency-key", "session-logout-replay-0001");
    expect(logout.status).toBe(204);
    const logoutReplay = await request(app)
      .post("/api/v1/auth/logout")
      .set("origin", origin)
      .set("cookie", second.cookie)
      .set("x-csrf-token", second.csrfCookie)
      .set("idempotency-key", "session-logout-replay-0001");
    expect(logoutReplay.status).toBe(204);
    expect(cookieHeader(logout, "vicam_refresh")).toContain("Max-Age=0");
    expect(cookieHeader(logout, "vicam_csrf")).toContain("Max-Age=0");
    expect(
      (await request(app).get("/api/v1/auth/me").set("authorization", `Bearer ${second.access}`))
        .status,
    ).toBe(401);
  });

  it("persists explicit GPS and active fruit ownership with replay-safe account updates", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const auth = { authorization: `Bearer ${ana.access}` };
    const fruits = await request(app).get("/api/v1/fruits").set(auth);
    expect(fruits.status).toBe(200);
    expect(fruits.body).toEqual([
      { id: "50000000-0000-4000-8000-000000000001", name: "Banano", active: true, version: 1 },
      { id: "50000000-0000-4000-8000-000000000002", name: "Mango", active: true, version: 1 },
    ]);

    const capturedAt = "2026-07-22T14:30:00.000Z";
    const input = {
      displayName: "Cuenta GPS Frutas Ficticia",
      accountType: "FARM",
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      countryCode: "EC",
      city: "Machala",
      phone: "+593700000001",
      latitude: -3.258111,
      longitude: -79.955392,
      locationSource: "DEVICE",
      locationCapturedAt: capturedAt,
      fruitIds: ["50000000-0000-4000-8000-000000000001"],
    };
    const created = await request(app)
      .post("/api/v1/commercial-accounts")
      .set(auth)
      .set("idempotency-key", "gps-fruit-account-create-0001")
      .send(input);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      latitude: input.latitude,
      longitude: input.longitude,
      locationSource: "DEVICE",
      locationCapturedAt: capturedAt,
      fruitIds: input.fruitIds,
      fruits: [{ id: input.fruitIds[0], name: "Banano" }],
    });
    const createReplay = await request(app)
      .post("/api/v1/commercial-accounts")
      .set(auth)
      .set("idempotency-key", "gps-fruit-account-create-0001")
      .send(input);
    expect(createReplay.status).toBe(201);
    expect(createReplay.body.id).toBe(created.body.id);

    const persisted = await pool.query<{
      location_captured_by: string;
      selected_fruits: number;
    }>(
      `select a.location_captured_by,
        (select count(*)::integer from commercial_account_fruits af where af.account_id=a.id) selected_fruits
       from commercial_accounts a where a.id=$1`,
      [created.body.id],
    );
    expect(persisted.rows[0]).toEqual({
      location_captured_by: "00000000-0000-4000-8000-000000000002",
      selected_fruits: 1,
    });

    const partialGps = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set(auth)
      .send({ latitude: -2, version: created.body.version });
    expect(partialGps.status).toBe(422);
    expect(partialGps.body.code).toBe("GPS_COORDINATES_REQUIRED");

    const inactiveFruit = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set(auth)
      .send({
        fruitIds: ["50000000-0000-4000-8000-000000000003"],
        version: created.body.version,
      });
    expect(inactiveFruit.status).toBe(422);
    expect(inactiveFruit.body.code).toBe("INVALID_ACCOUNT_FRUIT");

    const clearedInput = {
      latitude: null,
      longitude: null,
      locationSource: null,
      locationCapturedAt: null,
      fruitIds: ["50000000-0000-4000-8000-000000000002"],
      version: created.body.version,
    };
    const cleared = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set(auth)
      .set("idempotency-key", "gps-fruit-account-update-0001")
      .send(clearedInput);
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({
      latitude: null,
      longitude: null,
      locationSource: null,
      locationCapturedAt: null,
      fruitIds: ["50000000-0000-4000-8000-000000000002"],
    });
    const clearReplay = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set(auth)
      .set("idempotency-key", "gps-fruit-account-update-0001")
      .send(clearedInput);
    expect(clearReplay.status).toBe(200);
    expect(clearReplay.body.version).toBe(cleared.body.version);

    const bruno = await login("supervisor.bruno", "VicamDev!SupervisorB2026");
    const foreign = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set("authorization", `Bearer ${bruno.access}`)
      .send({ fruitIds: [], version: cleared.body.version });
    expect(foreign.status).toBe(404);

    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const reassigned = await request(app)
      .patch(`/api/v1/commercial-accounts/${created.body.id}`)
      .set("authorization", `Bearer ${manager.access}`)
      .set("idempotency-key", "gps-fruit-account-reassign-0001")
      .send({
        ownerUserId: "00000000-0000-4000-8000-000000000003",
        version: cleared.body.version,
      });
    expect(reassigned.status).toBe(200);
    const reassignmentAudit = await pool.query<{
      before_changes: Record<string, unknown>;
      after_changes: Record<string, unknown>;
    }>(
      "select before_changes,after_changes from audit_logs where action='ACCOUNT_UPDATED' and entity_id=$1 order by occurred_at desc limit 1",
      [created.body.id],
    );
    expect(reassignmentAudit.rows[0]?.before_changes).toMatchObject({
      ownerUserId: "00000000-0000-4000-8000-000000000002",
    });
    expect(reassignmentAudit.rows[0]?.after_changes).toMatchObject({
      ownerUserId: "00000000-0000-4000-8000-000000000003",
      changedFields: ["ownerUserId"],
    });
  });

  it("enforces Manager user RBAC and password policy", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    expect(
      (
        await request(app)
          .get("/api/v1/users?page=1&pageSize=2")
          .set("authorization", `Bearer ${supervisor.access}`)
      ).status,
    ).toBe(403);
    const users = await request(app)
      .get("/api/v1/users?page=1&pageSize=2&role=SUPERVISOR")
      .set("authorization", `Bearer ${manager.access}`);
    expect(users.status).toBe(200);
    expect(users.body.pagination.pageSize).toBe(2);
    const created = await request(app)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${manager.access}`)
      .set("idempotency-key", "temporary-user-create-0001")
      .send({
        username: "temporary.demo",
        fullName: "Usuario Temporal Ficticio",
        role: "SUPERVISOR",
        timezone: "America/Guayaquil",
      });
    expect(created.status).toBe(201);
    expect(created.body.user.mustChangePassword).toBe(true);
    expect(created.body.temporaryPassword).toMatch(/[A-Z].*[a-z]|[a-z].*[A-Z]/);
    const createdSession = await login("temporary.demo", created.body.temporaryPassword);
    const temporaryMe = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${createdSession.access}`);
    expect(temporaryMe.status).toBe(200);
    expect(temporaryMe.body.mustChangePassword).toBe(true);
    const blockedById = await request(app)
      .get("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001")
      .set("authorization", `Bearer ${createdSession.access}`);
    expect(blockedById.status).toBe(403);
    expect(blockedById.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const blockedSessions = await request(app)
      .get("/api/v1/auth/sessions")
      .set("authorization", `Bearer ${createdSession.access}`);
    expect(blockedSessions.status).toBe(403);
    expect(blockedSessions.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const duplicateCreate = await request(app)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${manager.access}`)
      .set("idempotency-key", "temporary-user-create-0001")
      .send({
        username: "temporary.demo",
        fullName: "Usuario Temporal Ficticio",
        role: "SUPERVISOR",
        timezone: "America/Guayaquil",
      });
    expect(duplicateCreate.status).toBe(409);
    expect(duplicateCreate.body.code).toBe("TEMPORARY_CREDENTIAL_ALREADY_ISSUED");

    const reset = await request(app)
      .post(`/api/v1/users/${created.body.user.id}/reset-password`)
      .set("authorization", `Bearer ${manager.access}`)
      .set("idempotency-key", "temporary-user-reset-0001")
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).not.toBe(created.body.temporaryPassword);
    expect(
      (
        await request(app)
          .get("/api/v1/auth/me")
          .set("authorization", `Bearer ${createdSession.access}`)
      ).status,
    ).toBe(401);
    const resetSession = await login("temporary.demo", reset.body.temporaryPassword);
    expect(resetSession.access).toEqual(expect.any(String));
    const duplicateReset = await request(app)
      .post(`/api/v1/users/${created.body.user.id}/reset-password`)
      .set("authorization", `Bearer ${manager.access}`)
      .set("idempotency-key", "temporary-user-reset-0001")
      .send({});
    expect(duplicateReset.status).toBe(409);
    const managerReset = await request(app)
      .post("/api/v1/users/00000000-0000-4000-8000-000000000001/reset-password")
      .set("authorization", `Bearer ${manager.access}`)
      .send({});
    expect(managerReset.status).toBe(403);

    const persistedSecret = await pool.query<{ exposed: boolean }>(
      `select exists(
         select 1 from audit_logs where before_changes::text like $1 or after_changes::text like $1
         union all
         select 1 from mutation_idempotency where response_body::text like $1
       ) exposed`,
      [`%${reset.body.temporaryPassword}%`],
    );
    expect(persistedSecret.rows[0]?.exposed).toBe(false);
    const changedTemporary = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${resetSession.access}`)
      .set("idempotency-key", "change-password-replay-0001")
      .send({
        currentPassword: reset.body.temporaryPassword,
        newPassword: "Temporary-User!2027",
      });
    expect(changedTemporary.status).toBe(204);
    const changedTemporaryReplay = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${resetSession.access}`)
      .set("idempotency-key", "change-password-replay-0001")
      .send({
        currentPassword: reset.body.temporaryPassword,
        newPassword: "Temporary-User!2027",
      });
    expect(changedTemporaryReplay.status).toBe(204);
    const businessAfterChange = await request(app)
      .get("/api/v1/commercial-accounts?page=1&pageSize=20")
      .set("authorization", `Bearer ${resetSession.access}`);
    expect(businessAfterChange.status).toBe(200);
    const inactive = await request(app)
      .patch(`/api/v1/users/${created.body.user.id}`)
      .set("authorization", `Bearer ${manager.access}`)
      .send({ status: "INACTIVE" });
    expect(inactive.status).toBe(200);
    const common = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${manager.access}`)
      .send({ currentPassword: "VicamDev!Manager2026", newPassword: "Password1!" });
    expect(common.status).toBe(422);
    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${manager.access}`)
      .send({
        currentPassword: "VicamDev!Manager2026",
        newPassword: "Unique-Vicam!Manager2027",
      });
    expect(changed.status).toBe(204);
    const withNewPassword = await login("manager.demo", "Unique-Vicam!Manager2027");
    const restored = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${withNewPassword.access}`)
      .send({
        currentPassword: "Unique-Vicam!Manager2027",
        newPassword: "VicamDev!Manager2026",
      });
    expect(restored.status).toBe(204);
  });

  it("keeps usernames case-insensitively unique and revokes access on deactivation", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const managerAuth = { authorization: `Bearer ${manager.access}` };
    const created = await request(app)
      .post("/api/v1/users")
      .set(managerAuth)
      .set("idempotency-key", "deactivation-user-create-0001")
      .send({
        username: "deactivation.demo",
        fullName: "Desactivación Ficticia",
        role: "SUPERVISOR",
      });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({
      role: "SUPERVISOR",
      status: "ACTIVE",
    });
    const duplicate = await request(app).post("/api/v1/users").set(managerAuth).send({
      username: "DEACTIVATION.DEMO",
      fullName: "Duplicado Ficticio",
      role: "SUPERVISOR",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("USERNAME_CONFLICT");

    const temporarySession = await login("deactivation.demo", created.body.temporaryPassword);
    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${temporarySession.access}`)
      .send({
        currentPassword: created.body.temporaryPassword,
        newPassword: "Deactivation-Demo!2027",
      });
    expect(changed.status).toBe(204);
    const sessionState = await pool.query<{ device_id: string }>(
      `select device_id from user_sessions
       where user_id=$1 and revoked_at is null order by created_at desc limit 1`,
      [created.body.user.id],
    );
    const deviceId = sessionState.rows[0]!.device_id;
    await pool.query(
      `insert into offline_grants(id,user_id,device_id,token_hash,scope_hash,expires_at)
       values($1,$2,$3,$4,$5,now()+interval '1 hour')`,
      [crypto.randomUUID(), created.body.user.id, deviceId, "a".repeat(64), "b".repeat(64)],
    );

    const inactive = await request(app)
      .patch(`/api/v1/users/${created.body.user.id}`)
      .set(managerAuth)
      .set("idempotency-key", "deactivation-user-update-0001")
      .send({ status: "INACTIVE" });
    expect(inactive.status).toBe(200);
    expect(inactive.body.status).toBe("INACTIVE");
    const revoked = await pool.query<{
      sessions: number;
      devices: number;
      grants: number;
      after_changes: Record<string, unknown>;
    }>(
      `select
         (select count(*)::integer from user_sessions where user_id=$1 and revoked_at is null) sessions,
         (select count(*)::integer from devices where user_id=$1 and status='ACTIVE') devices,
         (select count(*)::integer from offline_grants where user_id=$1 and revoked_at is null) grants,
         (select after_changes from audit_logs where action='USER_UPDATED' and entity_id=$1 order by occurred_at desc limit 1) after_changes`,
      [created.body.user.id],
    );
    expect(revoked.rows[0]).toMatchObject({ sessions: 0, devices: 0, grants: 0 });
    expect(revoked.rows[0]?.after_changes).toMatchObject({
      status: "INACTIVE",
      sessionsRevoked: true,
      devicesRevoked: true,
      offlineGrantsRevoked: true,
    });
    expect(
      (
        await request(app)
          .get("/api/v1/auth/me")
          .set("authorization", `Bearer ${temporarySession.access}`)
      ).status,
    ).toBe(401);
  });

  it("reprograms and cancels visits with validation, versioning, idempotency, ownership, audit and reminders", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const bruno = await login("supervisor.bruno", "VicamDev!SupervisorB2026");
    const anaAuth = { authorization: `Bearer ${ana.access}` };
    const scheduledAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const visit = await request(app).post("/api/v1/visits").set(anaAuth).send({
      accountId: "10000000-0000-4000-8000-000000000001",
      responsibleUserId: "00000000-0000-4000-8000-000000000002",
      scheduledAt,
      timezone: "America/Guayaquil",
      reason: "Validar reprogramación ficticia",
      priority: "MEDIUM",
    });
    expect(visit.status).toBe(201);
    const initialReminders = await pool.query<{ id: string }>(
      "select id from reminders where visit_id=$1 and status='PENDING' order by id",
      [visit.body.id],
    );
    expect(initialReminders.rows).toHaveLength(2);

    const unchanged = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .set("idempotency-key", "visit-reschedule-unchanged-0001")
      .send({
        scheduledAt,
        timezone: "America/Guayaquil",
        reason: "No existe cambio real",
        version: visit.body.version,
      });
    expect(unchanged.status).toBe(422);
    expect(unchanged.body.code).toBe("VISIT_RESCHEDULE_UNCHANGED");

    const invalidZone = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .send({
        scheduledAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        timezone: "Invalid/Timezone",
        reason: "Zona inválida",
        version: visit.body.version,
      });
    expect(invalidZone.status).toBe(422);
    expect(invalidZone.body.code).toBe("INVALID_TIMEZONE");

    const newScheduledAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const rescheduleInput = {
      scheduledAt: newScheduledAt,
      timezone: "America/New_York",
      reason: "Cambio operativo ficticio",
      version: visit.body.version,
    };
    const rescheduled = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .set("idempotency-key", "visit-reschedule-complete-0001")
      .send(rescheduleInput);
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body).toMatchObject({
      status: "PENDING",
      scheduledAt: newScheduledAt,
      timezone: "America/New_York",
      version: visit.body.version + 1,
    });
    const replay = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .set("idempotency-key", "visit-reschedule-complete-0001")
      .send(rescheduleInput);
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(rescheduled.body.version);
    const wrongReuse = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .set("idempotency-key", "visit-reschedule-complete-0001")
      .send({ ...rescheduleInput, reason: "Otro motivo" });
    expect(wrongReuse.status).toBe(409);
    expect(wrongReuse.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const stale = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(anaAuth)
      .set("idempotency-key", "visit-reschedule-stale-0001")
      .send({
        ...rescheduleInput,
        scheduledAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VISIT_VERSION_CONFLICT");
    const foreign = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/cancel`)
      .set("authorization", `Bearer ${bruno.access}`)
      .send({ reason: "Sin propiedad", version: rescheduled.body.version });
    expect(foreign.status).toBe(404);

    const reminderState = await pool.query<{ old_pending: number; new_pending: number }>(
      `select
         count(*) filter (where id=any($2::uuid[]) and status='PENDING')::integer old_pending,
         count(*) filter (where not (id=any($2::uuid[])) and status='PENDING')::integer new_pending
       from reminders where visit_id=$1`,
      [visit.body.id, initialReminders.rows.map((row) => row.id)],
    );
    expect(reminderState.rows[0]).toEqual({ old_pending: 0, new_pending: 2 });
    const history = await pool.query<{ total: number }>(
      "select count(*)::integer total from visit_reschedules where visit_id=$1",
      [visit.body.id],
    );
    expect(history.rows[0]?.total).toBe(1);

    const cancelInput = { reason: "Visita cancelada ficticia", version: rescheduled.body.version };
    const cancelKey = "visit-cancel-expired-key-0001";
    await pool.query(
      `insert into mutation_idempotency(actor_user_id,idempotency_key,operation,request_hash,status_code,response_body,expires_at)
       values($1,$2,$3,$4,200,'{}',now()-interval '1 minute')`,
      [
        "00000000-0000-4000-8000-000000000002",
        cancelKey,
        `visit.cancel:${visit.body.id}`,
        requestHash(cancelInput),
      ],
    );
    const cancelled = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/cancel`)
      .set(anaAuth)
      .set("idempotency-key", cancelKey)
      .send(cancelInput);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: "CANCELLED",
      version: rescheduled.body.version + 1,
    });
    const cancelReplay = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/cancel`)
      .set(anaAuth)
      .set("idempotency-key", cancelKey)
      .send(cancelInput);
    expect(cancelReplay.status).toBe(200);
    expect(cancelReplay.body.version).toBe(cancelled.body.version);

    const effects = await pool.query<{
      pending_reminders: number;
      reschedule_audits: number;
      cancel_audits: number;
      before_changes: Record<string, unknown>;
      after_changes: Record<string, unknown>;
    }>(
      `select
         (select count(*)::integer from reminders where visit_id=$1 and status='PENDING') pending_reminders,
         (select count(*)::integer from audit_logs where entity_id=$1 and action='VISIT_RESCHEDULED') reschedule_audits,
         (select count(*)::integer from audit_logs where entity_id=$1 and action='VISIT_CANCELLED') cancel_audits,
         (select before_changes from audit_logs where entity_id=$1 and action='VISIT_CANCELLED') before_changes,
         (select after_changes from audit_logs where entity_id=$1 and action='VISIT_CANCELLED') after_changes`,
      [visit.body.id],
    );
    expect(effects.rows[0]).toMatchObject({
      pending_reminders: 0,
      reschedule_audits: 1,
      cancel_audits: 1,
      before_changes: {
        scheduledAt: newScheduledAt,
        timezone: "America/New_York",
        status: "PENDING",
        version: rescheduled.body.version,
      },
      after_changes: {
        scheduledAt: newScheduledAt,
        timezone: "America/New_York",
        status: "CANCELLED",
        version: cancelled.body.version,
        reasonProvided: true,
      },
    });
    expect(JSON.stringify(effects.rows[0])).not.toContain(cancelInput.reason);
    const detail = await request(app).get(`/api/v1/visits/${visit.body.id}`).set(anaAuth);
    expect(detail.status).toBe(200);
    expect(detail.body.history.map((event: { type: string }) => event.type)).toEqual([
      "CREATED",
      "RESCHEDULED",
      "CANCELLED",
    ]);
    expect(detail.body.history[0].scheduledAt).toBe(scheduledAt);
    expect(detail.body.history[1]).toMatchObject({
      oldScheduledAt: scheduledAt,
      newScheduledAt,
      reason: rescheduleInput.reason,
      actorFullName: "Ana Supervisora",
    });
  });

  it("runs account, contact, visit and task mutations with ownership and idempotency", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const auth = { authorization: `Bearer ${ana.access}` };
    const foreignCancel = await request(app)
      .post("/api/v1/tasks/40000000-0000-4000-8000-000000000002/cancel")
      .set(auth)
      .send({ reason: "No autorizada", version: 1 });
    expect(foreignCancel.status).toBe(404);
    const accountInput = {
      displayName: "Cuenta Vertical Ficticia",
      accountType: "COMPANY",
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      countryCode: "EC",
      city: "Guayaquil",
      phone: "+593400000099",
    };
    const account = await request(app)
      .post("/api/v1/commercial-accounts")
      .set(auth)
      .set("idempotency-key", "vertical-account-create-0001")
      .send(accountInput);
    expect(account.status).toBe(201);
    const accountReplay = await request(app)
      .post("/api/v1/commercial-accounts")
      .set(auth)
      .set("idempotency-key", "vertical-account-create-0001")
      .send(accountInput);
    expect(accountReplay.status).toBe(201);
    expect(accountReplay.body.id).toBe(account.body.id);
    const keyConflict = await request(app)
      .post("/api/v1/commercial-accounts")
      .set(auth)
      .set("idempotency-key", "vertical-account-create-0001")
      .send({ ...accountInput, displayName: "Otro nombre" });
    expect(keyConflict.status).toBe(409);
    const contact = await request(app)
      .post(`/api/v1/commercial-accounts/${account.body.id}/contacts`)
      .set(auth)
      .send({ fullName: "Contacto Vertical", phone: "+593400000098", isPrimary: false });
    expect(contact.status).toBe(201);
    expect(contact.body.isPrimary).toBe(true);
    const visit = await request(app)
      .post("/api/v1/visits")
      .set(auth)
      .send({
        accountId: account.body.id,
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        timezone: "America/Guayaquil",
        reason: "Visita vertical",
        priority: "HIGH",
      });
    expect(visit.status).toBe(201);
    const rescheduled = await request(app)
      .post(`/api/v1/visits/${visit.body.id}/reschedule`)
      .set(auth)
      .send({
        scheduledAt: new Date(Date.now() + 4 * 86400000).toISOString(),
        timezone: "America/New_York",
        reason: "Cambio ficticio",
        version: visit.body.version,
      });
    expect(rescheduled.status).toBe(200);
    const task = await request(app)
      .post("/api/v1/tasks")
      .set(auth)
      .send({
        accountId: account.body.id,
        visitId: visit.body.id,
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        title: "Seguimiento vertical",
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        dueTime: "10:00",
        timezone: "America/New_York",
        priority: "MEDIUM",
      });
    expect(task.status).toBe(201);
    const patchClose = await request(app)
      .patch(`/api/v1/tasks/${task.body.id}`)
      .set(auth)
      .send({ status: "CANCELLED", version: task.body.version });
    expect(patchClose.status).toBe(422);
    const completed = await request(app)
      .post(`/api/v1/tasks/${task.body.id}/complete`)
      .set(auth)
      .send({ version: task.body.version });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");

    const cancellable = await request(app)
      .post("/api/v1/tasks")
      .set(auth)
      .send({
        accountId: account.body.id,
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        title: "Tarea cancelable",
        dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        dueTime: "12:00",
        timezone: "America/Guayaquil",
        priority: "LOW",
      });
    expect(cancellable.status).toBe(201);
    const cancellationInput = {
      reason: "La actividad ficticia dejó de ser necesaria",
      version: cancellable.body.version,
    };
    const cancelled = await request(app)
      .post(`/api/v1/tasks/${cancellable.body.id}/cancel`)
      .set(auth)
      .set("idempotency-key", "task-cancel-double-submit-0001")
      .send(cancellationInput);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    const duplicateCancellation = await request(app)
      .post(`/api/v1/tasks/${cancellable.body.id}/cancel`)
      .set(auth)
      .set("idempotency-key", "task-cancel-double-submit-0001")
      .send(cancellationInput);
    expect(duplicateCancellation.status).toBe(200);
    expect(duplicateCancellation.body.version).toBe(cancelled.body.version);
    const persistedCancellation = await pool.query<{
      cancellation_reason: string;
      pending_reminders: number;
    }>(
      `select t.cancellation_reason,
         (select count(*)::integer from reminders r where r.task_id=t.id and r.status='PENDING') pending_reminders
       from tasks t where t.id=$1`,
      [cancellable.body.id],
    );
    expect(persistedCancellation.rows[0]).toEqual({
      cancellation_reason: cancellationInput.reason,
      pending_reminders: 0,
    });
    const cancellationAudit = await pool.query<{ after_changes: Record<string, unknown> }>(
      "select after_changes from audit_logs where action='TASK_CANCELLED' and entity_id=$1",
      [cancellable.body.id],
    );
    expect(JSON.stringify(cancellationAudit.rows[0]?.after_changes)).not.toContain(
      cancellationInput.reason,
    );
  });

  it("serializes Supervisor visit/task mutations behind account reassignment", async () => {
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const auth = { authorization: `Bearer ${ana.access}` };
    const account = await request(app).post("/api/v1/commercial-accounts").set(auth).send({
      displayName: "Cuenta Carrera Ficticia",
      accountType: "COMPANY",
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      countryCode: "EC",
      city: "Guayaquil",
      phone: "+593400000077",
    });
    expect(account.status).toBe(201);
    const visit = await request(app)
      .post("/api/v1/visits")
      .set(auth)
      .send({
        accountId: account.body.id,
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        scheduledAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        timezone: "America/Guayaquil",
        reason: "Prueba de carrera",
        priority: "MEDIUM",
      });
    const task = await request(app)
      .post("/api/v1/tasks")
      .set(auth)
      .send({
        accountId: account.body.id,
        responsibleUserId: "00000000-0000-4000-8000-000000000002",
        title: "Tarea de carrera",
        dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        dueTime: "15:00",
        timezone: "America/Guayaquil",
        priority: "MEDIUM",
      });
    expect(visit.status).toBe(201);
    expect(task.status).toBe(201);
    const before = await pool.query<{
      visit_version: number;
      task_version: number;
      reminder_state: unknown;
      audit_count: number;
    }>(
      `select
         (select version from visits where id=$1) visit_version,
         (select version from tasks where id=$2) task_version,
         (select jsonb_agg(jsonb_build_object('id',id,'status',status) order by id)
            from reminders where visit_id=$1 or task_id=$2) reminder_state,
         (select count(*)::integer from audit_logs
            where entity_id in ($1,$2) and action in ('VISIT_RESCHEDULED','TASK_CANCELLED')) audit_count`,
      [visit.body.id, task.body.id],
    );

    const reassignment = await pool.connect();
    try {
      await reassignment.query("begin");
      await reassignment.query("select id from commercial_accounts where id=$1 for update", [
        account.body.id,
      ]);
      await reassignment.query(
        "update commercial_accounts set owner_user_id=$2,version=version+1 where id=$1",
        [account.body.id, "00000000-0000-4000-8000-000000000003"],
      );

      const visitMutation = request(app)
        .post(`/api/v1/visits/${visit.body.id}/reschedule`)
        .set(auth)
        .send({
          scheduledAt: new Date(Date.now() + 6 * 86400000).toISOString(),
          timezone: "America/Guayaquil",
          reason: "No debe aplicarse",
          version: visit.body.version,
        });
      const taskMutation = request(app)
        .post(`/api/v1/tasks/${task.body.id}/cancel`)
        .set(auth)
        .send({ reason: "No debe aplicarse", version: task.body.version });
      const pendingResponses = Promise.all([visitMutation, taskMutation]);
      await waitForBlockedTransactions(pool, 2);
      await reassignment.query("commit");
      const [visitResponse, taskResponse] = await pendingResponses;
      expect(visitResponse.status).toBe(404);
      expect(taskResponse.status).toBe(404);
    } catch (error) {
      await reassignment.query("rollback");
      throw error;
    } finally {
      reassignment.release();
    }

    const after = await pool.query<{
      visit_version: number;
      task_version: number;
      reminder_state: unknown;
      audit_count: number;
    }>(
      `select
         (select version from visits where id=$1) visit_version,
         (select version from tasks where id=$2) task_version,
         (select jsonb_agg(jsonb_build_object('id',id,'status',status) order by id)
            from reminders where visit_id=$1 or task_id=$2) reminder_state,
         (select count(*)::integer from audit_logs
            where entity_id in ($1,$2) and action in ('VISIT_RESCHEDULED','TASK_CANCELLED')) audit_count`,
      [visit.body.id, task.body.id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("resets an exact active Manager through the safe CLI and blocks business until change", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const invalidOutput: string[] = [];
    await expect(
      executeManagerPasswordReset(pool, "supervisor.ana", (value) => invalidOutput.push(value)),
    ).rejects.toMatchObject({ code: "ACTIVE_MANAGER_NOT_FOUND" });
    expect(invalidOutput).toEqual([]);

    const output: string[] = [];
    await executeManagerPasswordReset(pool, "manager.demo", (value) => output.push(value));
    expect(output).toHaveLength(1);
    const temporaryPassword = output[0]!.trim();
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(
      (await request(app).get("/api/v1/auth/me").set("authorization", `Bearer ${manager.access}`))
        .status,
    ).toBe(401);
    const resetState = await pool.query<{
      plaintext_persisted: boolean;
      active_devices: number;
      audit_actor: string | null;
    }>(
      `select
         exists(select 1 from users where username='manager.demo' and password_hash=$1) plaintext_persisted,
         (select count(*)::integer from devices d join users u on u.id=d.user_id where u.username='manager.demo' and d.status='ACTIVE') active_devices,
         (select actor_user_id from audit_logs where action='MANAGER_PASSWORD_RESET_CLI' order by occurred_at desc limit 1) audit_actor`,
      [temporaryPassword],
    );
    expect(resetState.rows[0]).toEqual({
      plaintext_persisted: false,
      active_devices: 0,
      audit_actor: null,
    });
    const auditExposure = await pool.query<{ exposed: boolean }>(
      `select exists(select 1 from audit_logs
       where action='MANAGER_PASSWORD_RESET_CLI'
         and (before_changes::text like $1 or after_changes::text like $1)) exposed`,
      [`%${temporaryPassword}%`],
    );
    expect(auditExposure.rows[0]?.exposed).toBe(false);

    const temporarySession = await login("manager.demo", temporaryPassword);
    const blockedBusiness = await request(app)
      .get("/api/v1/users/00000000-0000-4000-8000-000000000002")
      .set("authorization", `Bearer ${temporarySession.access}`);
    expect(blockedBusiness.status).toBe(403);
    expect(blockedBusiness.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const managerMe = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${temporarySession.access}`);
    expect(managerMe.status).toBe(200);
    expect(managerMe.body.mustChangePassword).toBe(true);
    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set("authorization", `Bearer ${temporarySession.access}`)
      .send({ currentPassword: temporaryPassword, newPassword: "VicamDev!Manager2026" });
    expect(changed.status).toBe(204);
    const businessAfterChange = await request(app)
      .get("/api/v1/users?page=1&pageSize=20")
      .set("authorization", `Bearer ${temporarySession.access}`);
    expect(businessAfterChange.status).toBe(200);
  });
});
