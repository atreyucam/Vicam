import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  documentSchema,
  documentsPageSchema,
  fruitSchema,
  importBatchSchema,
  reportAnalyticsResponseSchema,
  reportExportSchema,
  sessionTokenResponseSchema,
} from "@vicam/contracts";
import { migrateDatabase, seedDevelopmentData } from "@vicam/db";
import pino from "pino";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { readApiConfig } from "./config.js";

const integration = process.env.VICAM_RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:5173";

integration("Phase 3 operational API", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let storageRoot: string;
  let app: ReturnType<typeof createApp>;

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
    storageRoot = await mkdtemp(join(tmpdir(), "vicam-phase3-"));
    app = createApp({
      config: readApiConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
        DOCUMENT_STORAGE_ROOT: storageRoot,
      }),
      pool,
      databaseProbe: () => Promise.resolve(),
      logger: pino({ enabled: false }),
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  async function login(username: string, password: string) {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("origin", origin)
      .send({ username, password, deviceName: "Phase 3 integration", platform: "test" });
    expect(response.status).toBe(200);
    return sessionTokenResponseSchema.parse(response.body).accessToken;
  }

  it("enforces Manager catalog administration and optimistic versions", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");

    const forbidden = await request(app)
      .post("/api/v1/fruits")
      .set("authorization", `Bearer ${supervisor}`)
      .set("idempotency-key", crypto.randomUUID())
      .send({ name: "Granadilla" });
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post("/api/v1/fruits")
      .set("authorization", `Bearer ${manager}`)
      .set("idempotency-key", crypto.randomUUID())
      .send({ name: "Granadilla" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const fruit = fruitSchema.parse(created.body);
    expect(fruit).toMatchObject({ name: "Granadilla", active: true, version: 1 });

    const deactivated = await request(app)
      .patch(`/api/v1/fruits/${fruit.id}`)
      .set("authorization", `Bearer ${manager}`)
      .set("idempotency-key", crypto.randomUUID())
      .send({ active: false, version: 1 });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({ active: false, version: 2 });
  });

  it("deduplicates import upload and report creation by idempotency key", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const csv = [
      "displayName,accountType,ownerUserId,countryCode,city,phone,contactName,contactPhone,fruits",
      "Cliente Importado,COMPANY,00000000-0000-4000-8000-000000000002,EC,Guayaquil,+593400000099,Contacto Uno,+593400000098,Banano",
    ].join("\n");
    const importKey = crypto.randomUUID();
    const upload = () =>
      request(app)
        .post("/api/v1/imports")
        .set("authorization", `Bearer ${manager}`)
        .set("idempotency-key", importKey)
        .attach("file", Buffer.from(csv), { filename: "cuentas.csv", contentType: "text/csv" });
    const firstImport = await upload();
    const retriedImport = await upload();
    expect(firstImport.status).toBe(202);
    expect(retriedImport.status).toBe(202);
    expect(importBatchSchema.parse(retriedImport.body).id).toBe(
      importBatchSchema.parse(firstImport.body).id,
    );

    const reportKey = crypto.randomUUID();
    const reportBody = {
      group: "ACCOUNTS",
      template: "directory",
      format: "XLSX",
      filters: { city: "Guayaquil" },
      timezone: "America/Guayaquil",
    };
    const createReport = () =>
      request(app)
        .post("/api/v1/reports/exports")
        .set("authorization", `Bearer ${manager}`)
        .set("idempotency-key", reportKey)
        .send(reportBody);
    const firstReport = await createReport();
    const retriedReport = await createReport();
    expect(firstReport.status).toBe(202);
    expect(retriedReport.status).toBe(202);
    expect(reportExportSchema.parse(retriedReport.body).id).toBe(
      reportExportSchema.parse(firstReport.body).id,
    );
  });

  it("prevents a Supervisor from requesting management reports", async () => {
    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const response = await request(app)
      .post("/api/v1/reports/exports")
      .set("authorization", `Bearer ${supervisor}`)
      .set("idempotency-key", crypto.randomUUID())
      .send({
        group: "MANAGEMENT",
        template: "kpis",
        format: "PDF",
        filters: {},
        timezone: "America/Guayaquil",
      });
    expect(response.status).toBe(403);
  });

  it("calculates analytics in backend and keeps Supervisor ownership scope", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const managerResponse = await request(app)
      .get("/api/v1/reports/analytics/visits")
      .query({ timezone: "America/Guayaquil", page: 1, pageSize: 20 })
      .set("authorization", `Bearer ${manager}`);
    expect(managerResponse.status, JSON.stringify(managerResponse.body)).toBe(200);
    const managerAnalytics = reportAnalyticsResponseSchema.parse(managerResponse.body);
    expect(managerAnalytics.kpis).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "total", value: 2 })]),
    );
    expect(managerAnalytics.pagination.total).toBe(2);

    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    expect(
      (
        await request(app)
          .get("/api/v1/reports/analytics/visits")
          .query({ timezone: "America/Guayaquil" })
          .set("authorization", `Bearer ${supervisor}`)
      ).status,
    ).toBe(403);
    await pool.query(
      `update app_settings
       set value=jsonb_set(value,'{supervisorReportsEnabled}','true'::jsonb),version=version+1
       where settings_key='application'`,
    );
    const scopedResponse = await request(app)
      .get("/api/v1/reports/analytics/visits")
      .query({ timezone: "America/Guayaquil", page: 1, pageSize: 20 })
      .set("authorization", `Bearer ${supervisor}`);
    expect(scopedResponse.status, JSON.stringify(scopedResponse.body)).toBe(200);
    const scoped = reportAnalyticsResponseSchema.parse(scopedResponse.body);
    expect(scoped.kpis).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "total", value: 1 })]),
    );
    expect(scoped.rows).toEqual([
      expect.objectContaining({ accountName: "Exportadora Costa Demo" }),
    ]);
    await pool.query(
      `update app_settings
       set value=jsonb_set(value,'{supervisorReportsEnabled}','false'::jsonb),version=version+1
       where settings_key='application'`,
    );
  });

  it("invalidates a Supervisor export after an included account is reassigned", async () => {
    await pool.query(
      `update app_settings
       set value=jsonb_set(value,'{supervisorReportsEnabled}','true'::jsonb),version=version+1
       where settings_key='application'`,
    );
    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const created = await request(app)
      .post("/api/v1/reports/exports")
      .set("authorization", `Bearer ${supervisor}`)
      .send({
        group: "VISITS",
        template: "agenda",
        format: "PDF",
        filters: { accountId: "10000000-0000-4000-8000-000000000001" },
        timezone: "America/Guayaquil",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const report = reportExportSchema.parse(created.body);
    const storageKey = `reports/${report.id}.pdf`;
    await mkdir(join(storageRoot, "operations", "reports"), { recursive: true });
    await writeFile(join(storageRoot, "operations", storageKey), "%PDF-1.7\nreporte autorizado");
    await pool.query("update report_exports set status='AVAILABLE',storage_key=$2 where id=$1", [
      report.id,
      storageKey,
    ]);
    expect(
      (
        await request(app)
          .get(`/api/v1/reports/exports/${report.id}/download`)
          .set("authorization", `Bearer ${supervisor}`)
      ).status,
    ).toBe(200);

    await pool.query(
      `insert into audit_logs(id,actor_user_id,action,entity_type,entity_id,before_changes,after_changes,request_id)
       values($1,$2,'ACCOUNT_UPDATED','commercial_account',$3,$4,$5,$6)`,
      [
        crypto.randomUUID(),
        "00000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000001",
        { ownerUserId: "00000000-0000-4000-8000-000000000002" },
        { ownerUserId: "00000000-0000-4000-8000-000000000003", changedFields: ["ownerUserId"] },
        `phase3-reassignment-${crypto.randomUUID()}`,
      ],
    );
    expect(
      (
        await request(app)
          .get(`/api/v1/reports/exports/${report.id}/download`)
          .set("authorization", `Bearer ${supervisor}`)
      ).status,
    ).toBe(404);
    await pool.query(
      `update app_settings
       set value=jsonb_set(value,'{supervisorReportsEnabled}','false'::jsonb),version=version+1
       where settings_key='application'`,
    );
  });

  it("uses the generated confirmation id for replay-safe import confirmation", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const uploaded = await request(app)
      .post("/api/v1/imports")
      .set("authorization", `Bearer ${manager}`)
      .attach("file", Buffer.from("displayName,accountType,countryCode,city,phone\n"), {
        filename: "confirmacion.csv",
        contentType: "text/csv",
      });
    expect(uploaded.status).toBe(202);
    const batch = importBatchSchema.parse(uploaded.body);
    const confirmationId = crypto.randomUUID();
    await pool.query(
      `update import_batches
       set status='READY',confirmation_id=$2,updated_at=now()
       where id=$1`,
      [batch.id, confirmationId],
    );
    const confirm = () =>
      request(app)
        .post(`/api/v1/imports/${batch.id}/confirm`)
        .set("authorization", `Bearer ${manager}`)
        .send({ confirmationId });
    const first = await confirm();
    const replay = await confirm();
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ id: batch.id, status: "CONFIRMING", confirmationId });
    await pool.query(
      "update import_batches set status='COMPLETED',completed_at=now() where id=$1",
      [batch.id],
    );
    const completedReplay = await confirm();
    expect(completedReplay.status).toBe(202);
    expect(completedReplay.body).toMatchObject({ status: "COMPLETED", confirmationId });
  });

  it("enforces document MIME/signature/checksum, ownership, settings limit and download RBAC", async () => {
    const manager = await login("manager.demo", "VicamDev!Manager2026");
    const supervisor = await login("supervisor.ana", "VicamDev!SupervisorA2026");
    const categoryId = crypto.randomUUID();
    await pool.query(
      `insert into document_categories(id,name,normalized_name,created_by,updated_by)
       values($1,'Contrato de prueba','contrato de prueba',$2,$2)`,
      [categoryId, "00000000-0000-4000-8000-000000000001"],
    );
    const invalid = await request(app)
      .post("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001/documents")
      .set("authorization", `Bearer ${supervisor}`)
      .field("categoryId", categoryId)
      .attach("file", Buffer.from("no es pdf"), {
        filename: "falso.pdf",
        contentType: "application/pdf",
      });
    expect(invalid.status).toBe(422);

    const foreign = await request(app)
      .post("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000002/documents")
      .set("authorization", `Bearer ${supervisor}`)
      .field("categoryId", categoryId)
      .attach("file", Buffer.from("%PDF-1.7\narchivo ajeno"), {
        filename: "ajeno.pdf",
        contentType: "application/pdf",
      });
    expect(foreign.status).toBe(404);

    const body = Buffer.from("%PDF-1.7\narchivo ficticio autorizado");
    const uploaded = await request(app)
      .post("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001/documents")
      .set("authorization", `Bearer ${supervisor}`)
      .field("categoryId", categoryId)
      .attach("file", body, {
        filename: "autorizado.pdf",
        contentType: "application/pdf",
      });
    expect(uploaded.status).toBe(202);
    const document = documentSchema.parse(uploaded.body);
    expect(document.checksum).toBe(createHash("sha256").update(body).digest("hex"));
    const listed = await request(app)
      .get("/api/v1/documents?accountId=10000000-0000-4000-8000-000000000001&page=1&pageSize=100")
      .set("authorization", `Bearer ${supervisor}`);
    expect(listed.status).toBe(200);
    expect(documentsPageSchema.parse(listed.body).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: document.id, status: "QUARANTINED" })]),
    );
    await pool.query("update documents set status='AVAILABLE',scanned_at=now() where id=$1", [
      document.id,
    ]);
    expect(
      (
        await request(app)
          .get(`/api/v1/documents/${document.id}/download`)
          .set("authorization", `Bearer ${supervisor}`)
      ).status,
    ).toBe(200);

    await pool.query(
      `update app_settings
       set value=jsonb_set(value,'{documentLimitBytes}','10'::jsonb),version=version+1
       where settings_key='application'`,
    );
    const limited = await request(app)
      .post("/api/v1/commercial-accounts/10000000-0000-4000-8000-000000000001/documents")
      .set("authorization", `Bearer ${manager}`)
      .field("categoryId", categoryId)
      .attach("file", body, {
        filename: "limitado.pdf",
        contentType: "application/pdf",
      });
    expect(limited.status).toBe(422);
  });
});
