/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrateDatabase, seedDevelopmentData } from "@vicam/db";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";
import { closeIntegrationPool } from "./integration-test-support.js";
import { createLogger } from "./logger.js";

const integration = process.env.VICAM_RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:5173";
const managerId = "00000000-0000-4000-8000-000000000001";
const anaId = "00000000-0000-4000-8000-000000000002";
const anaAccountId = "10000000-0000-4000-8000-000000000001";
const brunoAccountId = "10000000-0000-4000-8000-000000000002";
const concurrency = 12;

integration("Phase 4 backend validation", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let storageRoot: string;
  let logs = "";
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const connectionString = container.getConnectionUri();
    await migrateDatabase({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 20,
      ssl: false,
    });
    pool = new Pool({ connectionString, max: 20 });
    await seedDevelopmentData(pool);
    storageRoot = await mkdtemp(join(tmpdir(), "vicam-phase4-"));
    const destination = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        logs += chunk.toString();
        callback();
      },
    });
    app = createApp({
      config: readApiConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        AUTH_SECRET: "phase4-test-secret-with-at-least-32-characters",
        DOCUMENT_STORAGE_ROOT: storageRoot,
      }),
      pool,
      databaseProbe: async () => {
        await pool.query("select 1");
      },
      logger: createLogger("info", destination),
    });
  }, 120_000);

  afterAll(async () => {
    if (pool) await closeIntegrationPool(pool);
    await container?.stop();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  async function login(username: string, password: string) {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .send({ username, password, deviceName: "Phase 4 load", platform: "test" });
    expect(response.status).toBe(200);
    return response.body.accessToken as string;
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it("keeps RBAC, ownership, sessions, sync, documents, reports and imports isolated under moderate concurrency", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const ana = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const bruno = await login("supervisor.bruno", "VicamDev!SupervisorB2026");

    const managerSessionId = (
      JSON.parse(Buffer.from(manager.split(".")[1]!, "base64url").toString("utf8")) as {
        sid: string;
      }
    ).sid;
    const sessionIsolation = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app)
          .delete(`/api/v1/auth/sessions/${managerSessionId}`)
          .set(auth(ana))
          .set("idempotency-key", crypto.randomUUID()),
      ),
    );
    expect(sessionIsolation.map((response) => response.status)).toEqual(
      Array.from({ length: concurrency }, () => 404),
    );
    expect((await request(app).get("/api/v1/auth/me").set(auth(manager))).status).toBe(200);
    const ownSessions = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app).get("/api/v1/auth/sessions").set(auth(ana)),
      ),
    );
    expect(ownSessions.every((response) => response.status === 200)).toBe(true);
    expect(
      ownSessions.every((response) => {
        const sessions = response.body as Array<{ id: string }>;
        return sessions.every((session) => session.id !== managerSessionId);
      }),
    ).toBe(true);

    const accountChecks = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const [own, foreign, otherForeign] = await Promise.all([
          request(app).get(`/api/v1/commercial-accounts/${anaAccountId}`).set(auth(ana)),
          request(app).get(`/api/v1/commercial-accounts/${brunoAccountId}`).set(auth(ana)),
          request(app).get(`/api/v1/commercial-accounts/${anaAccountId}`).set(auth(bruno)),
        ]);
        return [own.status, foreign.status, otherForeign.status];
      }),
    );
    expect(accountChecks).toEqual(Array.from({ length: concurrency }, () => [200, 404, 404]));

    const categoryId = crypto.randomUUID();
    await pool.query(
      `insert into document_categories(id,name,normalized_name,created_by,updated_by)
       values($1,'Carga fase cuatro','carga fase cuatro',$2,$2)`,
      [categoryId, managerId],
    );
    const documentContent = "%PDF-1.7\ncontenido documental fase cuatro no registrable";
    const uploaded = await request(app)
      .post(`/api/v1/commercial-accounts/${anaAccountId}/documents`)
      .set(auth(ana))
      .field("categoryId", categoryId)
      .attach("file", Buffer.from(documentContent), {
        filename: "fase-cuatro.pdf",
        contentType: "application/pdf",
      });
    expect(uploaded.status).toBe(202);
    await pool.query("update documents set status='AVAILABLE',scanned_at=now() where id=$1", [
      uploaded.body.id,
    ]);
    const documentChecks = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const [own, foreign] = await Promise.all([
          request(app).get(`/api/v1/documents/${uploaded.body.id}/download`).set(auth(ana)),
          request(app).get(`/api/v1/documents/${uploaded.body.id}/download`).set(auth(bruno)),
        ]);
        return [own.status, foreign.status];
      }),
    );
    expect(documentChecks.every((statuses) => statuses.join(",") === "200,404")).toBe(true);

    const reportKey = crypto.randomUUID();
    const reportRequests = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app)
          .post("/api/v1/reports/exports")
          .set(auth(manager))
          .set("idempotency-key", reportKey)
          .send({
            group: "ACCOUNTS",
            template: "directory",
            format: "XLSX",
            filters: { city: "Guayaquil" },
            timezone: "America/Guayaquil",
          }),
      ),
    );
    expect(reportRequests.every((response) => response.status === 202)).toBe(true);
    const reportIds = new Set(reportRequests.map((response) => response.body.id as string));
    expect(reportIds.size).toBe(1);

    const csv = [
      "displayName,accountType,ownerUserId,countryCode,city,phone",
      `Carga Fase 4,COMPANY,${anaId},EC,Guayaquil,+593400009999`,
    ].join("\n");
    const importKey = crypto.randomUUID();
    const importRequests = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app)
          .post("/api/v1/imports")
          .set(auth(manager))
          .set("idempotency-key", importKey)
          .attach("file", Buffer.from(csv), {
            filename: "fase-cuatro.csv",
            contentType: "text/csv",
          }),
      ),
    );
    expect(importRequests.every((response) => response.status === 202)).toBe(true);
    const importIds = new Set(importRequests.map((response) => response.body.id as string));
    expect(importIds.size).toBe(1);
    expect(
      (
        await pool.query<{ count: string }>(
          "select count(*) from import_batches where requester_user_id=$1 and checksum_sha256=$2",
          [managerId, createHash("sha256").update(csv).digest("hex")],
        )
      ).rows[0]?.count,
    ).toBe("1");

    const importId = [...importIds][0]!;
    const managerImport = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app).get(`/api/v1/imports/${importId}`).set(auth(manager)),
      ),
    );
    const supervisorImport = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app).get(`/api/v1/imports/${importId}`).set(auth(ana)),
      ),
    );
    expect(managerImport.every((response) => response.status === 200)).toBe(true);
    expect(supervisorImport.every((response) => response.status === 403)).toBe(true);

    const reportId = [...reportIds][0]!;
    const reportStorageKey = "reports/phase4-load.xlsx";
    await mkdir(join(storageRoot, "operations", "reports"), { recursive: true });
    await writeFile(join(storageRoot, "operations", reportStorageKey), "reporte fase cuatro");
    await pool.query("update report_exports set status='AVAILABLE',storage_key=$2 where id=$1", [
      reportId,
      reportStorageKey,
    ]);
    const reportChecks = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const [own, foreign] = await Promise.all([
          request(app).get(`/api/v1/reports/exports/${reportId}/download`).set(auth(manager)),
          request(app).get(`/api/v1/reports/exports/${reportId}/download`).set(auth(ana)),
        ]);
        return [own.status, foreign.status];
      }),
    );
    expect(reportChecks.every((statuses) => statuses.join(",") === "200,404")).toBe(true);

    const deviceId = (
      await pool.query<{ id: string }>(
        "select id from devices where user_id=$1 order by created_at desc limit 1",
        [anaId],
      )
    ).rows[0]!.id;
    const grant = await request(app)
      .post("/api/v1/auth/offline-grants")
      .set(auth(ana))
      .send({ deviceId });
    expect(grant.status).toBe(201);
    const pulls = await Promise.all(
      Array.from({ length: concurrency }, () =>
        request(app)
          .get("/api/v1/sync/pull")
          .query({ deviceId, cursor: "0", limit: 100 })
          .set({ ...auth(ana), "x-offline-grant": grant.body.grantToken as string }),
      ),
    );
    expect(pulls.every((response) => response.status === 200)).toBe(true);
    expect(
      pulls.every((response) => {
        const body = response.body as { changes: Array<{ entityId: string }> };
        return body.changes.every((change) => change.entityId !== brunoAccountId);
      }),
    ).toBe(true);

    const readiness = await Promise.all(
      Array.from({ length: concurrency }, () => request(app).get("/api/v1/health/ready")),
    );
    expect(readiness.every((response) => response.status === 200)).toBe(true);
    expect(readiness.every((response) => response.body.checks.database === "up")).toBe(true);

    expect(logs).not.toContain("VicamDev!Manager2026");
    expect(logs).not.toContain(manager);
    expect(logs).not.toContain(grant.body.grantToken);
    expect(logs).not.toContain(documentContent);
  }, 180_000);
});
