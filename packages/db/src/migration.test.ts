import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { migrationsFolder } from "./migrate.js";

describe("initial migration", () => {
  it("contains the approved extensions, base tables, constraints and indexes", async () => {
    const migrationSql = await readFile(`${migrationsFolder}/0000_initial.sql`, "utf8");

    for (const fragment of [
      "CREATE EXTENSION IF NOT EXISTS unaccent",
      "CREATE EXTENSION IF NOT EXISTS pg_trgm",
      "CREATE TABLE users",
      "CREATE TABLE user_sessions",
      "CREATE TABLE devices",
      "CREATE TABLE commercial_accounts",
      "CREATE TABLE commercial_contacts",
      "CREATE TABLE visits",
      "CREATE TABLE tasks",
      "CREATE TABLE documents",
      "CREATE TABLE audit_logs",
      "CREATE TABLE sync_operations",
      "CREATE TABLE change_log",
      "CREATE UNIQUE INDEX commercial_contacts_primary_uq",
      "CREATE TRIGGER audit_logs_append_only",
    ]) {
      expect(migrationSql).toContain(fragment);
    }
  });

  it("does not introduce Redis or drizzle push", async () => {
    const migrationSql = await readFile(`${migrationsFolder}/0000_initial.sql`, "utf8");
    expect(migrationSql.toLowerCase()).not.toContain("redis");
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });

  it("versions GPS consistency and account fruit selection", async () => {
    const migrationSql = await readFile(`${migrationsFolder}/0002_accounts_gps_fruits.sql`, "utf8");
    expect(migrationSql).toContain("CREATE TABLE fruits");
    expect(migrationSql).toContain("CREATE TABLE commercial_account_fruits");
    expect(migrationSql).toContain("commercial_accounts_location_pair");
    expect(migrationSql).toContain("commercial_accounts_location_metadata");
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });

  it("versions Phase 2 grants, durable sync results and structured-only change capture", async () => {
    const migrationSql = await readFile(`${migrationsFolder}/0003_phase2_sync.sql`, "utf8");
    for (const fragment of [
      "CREATE TABLE offline_grants",
      "offline_grants_maximum_lifetime",
      "ADD COLUMN result_body jsonb",
      "ADD COLUMN data jsonb",
      "CREATE TRIGGER commercial_accounts_sync_change",
      "CREATE TRIGGER commercial_contacts_sync_change",
      "CREATE TRIGGER visits_sync_change",
      "CREATE TRIGGER tasks_sync_change",
    ]) {
      expect(migrationSql).toContain(fragment);
    }
    expect(migrationSql).not.toContain("documents_sync_change");
    expect(migrationSql.toLowerCase()).not.toContain("redis");
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });

  it("versions the Phase 3 reviewer fixes and exact retention classes", async () => {
    const migrationSql = await readFile(
      `${migrationsFolder}/0005_phase3_reviewer_fixes.sql`,
      "utf8",
    );
    for (const fragment of [
      "fruits_version_positive",
      "ADD COLUMN retention_class",
      "current_setting('vicam.retention_cleanup'",
      "ADD COLUMN delivered_at",
      "ADD COLUMN error_storage_key",
      "ADD COLUMN requester_role",
      "report_exports_scope_check",
    ]) {
      expect(migrationSql).toContain(fragment);
    }
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
    expect(migrationSql.toLowerCase()).not.toContain("redis");
  });

  it("versions idempotent push delivery and exact seven-day export expiry", async () => {
    const migrationSql = await readFile(
      `${migrationsFolder}/0006_phase3_delivery_retention.sql`,
      "utf8",
    );
    for (const fragment of [
      "notifications_source_key_uq",
      "CREATE TABLE notification_push_deliveries",
      "notification_push_pending_idx",
      "expires_at = created_at + interval '7 days'",
    ])
      expect(migrationSql).toContain(fragment);
    expect(migrationSql.toLowerCase()).not.toContain("redis");
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });

  it("versions the ordered pagination indexes used by the Phase 4 capacity dataset", async () => {
    const migrationSql = await readFile(
      `${migrationsFolder}/0007_phase4_capacity_indexes.sql`,
      "utf8",
    );
    for (const fragment of [
      "commercial_accounts(normalized_display_name,id)",
      "visits(scheduled_at,id)",
      "tasks(due_date,due_time,id)",
    ])
      expect(migrationSql).toContain(fragment);
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });

  it("versions the connected commercial flow without replacing reschedule history", async () => {
    const migrationSql = await readFile(
      `${migrationsFolder}/0010_connected_commercial_flow.sql`,
      "utf8",
    );
    for (const fragment of [
      "CREATE TYPE visit_result",
      "ADD COLUMN result visit_result",
      "ADD COLUMN completed_at timestamptz",
      "SET result = 'NO_RESULT'",
      "visits_completion_state",
      "tasks_account_created_idx",
      "tasks_visit_due_idx",
      "CREATE OR REPLACE FUNCTION sync_entity_data",
    ])
      expect(migrationSql).toContain(fragment);
    expect(migrationSql).not.toContain("DROP TABLE visit_reschedules");
    expect(migrationSql.toLowerCase()).not.toContain("drizzle push");
  });
});
