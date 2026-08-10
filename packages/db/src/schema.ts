import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["MANAGER", "SUPERVISOR"]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "INACTIVE"]);
export const deviceStatus = pgEnum("device_status", ["ACTIVE", "REVOKED"]);
export const accountStatus = pgEnum("account_status", ["ACTIVE", "ARCHIVED"]);
export const visitStatus = pgEnum("visit_status", ["PENDING", "COMPLETED", "CANCELLED"]);
export const visitResult = pgEnum("visit_result", [
  "INTERESTED",
  "FOLLOW_UP_REQUIRED",
  "PROPOSAL_REQUESTED",
  "NEGOTIATION",
  "NOT_INTERESTED",
  "NO_RESULT",
]);
export const taskStatus = pgEnum("task_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export const priority = pgEnum("priority", ["LOW", "MEDIUM", "HIGH"]);
export const documentStatus = pgEnum("document_status", [
  "QUARANTINED",
  "SCANNING",
  "AVAILABLE",
  "REJECTED",
  "DELETED",
]);
export const documentFormat = pgEnum("document_format", ["PDF", "DOCX", "XLSX"]);
export const syncOperationStatus = pgEnum("sync_operation_status", [
  "RECEIVED",
  "APPLIED",
  "REJECTED",
  "CONFLICT",
]);
export const syncConflictStatus = pgEnum("sync_conflict_status", ["OPEN", "RESOLVED"]);
export const changeOperation = pgEnum("change_operation", ["UPSERT", "DELETE", "REVOKE"]);
export const reminderStatus = pgEnum("reminder_status", ["PENDING", "CANCELLED", "DELIVERED"]);
export const reportExportStatus = pgEnum("report_export_status", [
  "QUEUED",
  "PROCESSING",
  "AVAILABLE",
  "FAILED",
  "EXPIRED",
]);
export const importFormat = pgEnum("import_format", ["XLSX", "CSV"]);
export const importStatus = pgEnum("import_status", [
  "UPLOADED",
  "VALIDATING",
  "READY",
  "CONFIRMING",
  "COMPLETED",
  "FAILED",
]);
export const importRowAction = pgEnum("import_row_action", ["CREATE", "UPDATE", "SKIP", "ERROR"]);
export const pushDeliveryStatus = pgEnum("push_delivery_status", ["PENDING", "SENT", "FAILED"]);

const auditColumns = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    username: varchar("username", { length: 100 }).notNull(),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    role: userRole("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: userStatus("status").notNull().default("ACTIVE"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("users_username_lower_uq").on(sql`lower(${table.username})`),
    check("users_username_not_blank", sql`btrim(${table.username}) <> ''`),
    check("users_full_name_not_blank", sql`btrim(${table.fullName}) <> ''`),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    platform: varchar("platform", { length: 100 }).notNull(),
    status: deviceStatus("status").notNull().default("ACTIVE"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns(),
  },
  (table) => [index("devices_user_status_idx").on(table.userId, table.status)],
);

export const offlineGrants = pgTable(
  "offline_grants",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    scopeHash: varchar("scope_hash", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("offline_grants_token_hash_format", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("offline_grants_scope_hash_format", sql`${table.scopeHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "offline_grants_maximum_lifetime",
      sql`${table.expiresAt} > ${table.issuedAt} and ${table.expiresAt} <= ${table.issuedAt} + interval '72 hours'`,
    ),
    index("offline_grants_user_device_active_idx").on(
      table.userId,
      table.deviceId,
      table.expiresAt,
    ),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    csrfTokenHash: varchar("csrf_token_hash", { length: 64 }),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBySessionId: uuid("replaced_by_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "user_sessions_replaced_by_fk",
      columns: [table.replacedBySessionId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    unique("user_sessions_refresh_hash_uq").on(table.refreshTokenHash),
    index("user_sessions_user_active_idx")
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    attemptKey: varchar("attempt_key", { length: 64 }).primaryKey(),
    failureCount: integer("failure_count").notNull().default(0),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("login_attempts_key_format", sql`${table.attemptKey} ~ '^[0-9a-f]{64}$'`),
    check("login_attempts_failure_count_nonnegative", sql`${table.failureCount} >= 0`),
  ],
);

export const commercialAccounts = pgTable(
  "commercial_accounts",
  {
    id: uuid("id").primaryKey(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    normalizedDisplayName: varchar("normalized_display_name", { length: 200 }).notNull(),
    legalName: varchar("legal_name", { length: 250 }),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: accountStatus("status").notNull().default("ACTIVE"),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    stateProvince: varchar("state_province", { length: 150 }),
    city: varchar("city", { length: 150 }).notNull(),
    address: text("address"),
    postalCode: varchar("postal_code", { length: 30 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 320 }),
    timezone: varchar("timezone", { length: 100 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    locationSource: varchar("location_source", { length: 20 }),
    locationCapturedAt: timestamp("location_captured_at", { withTimezone: true }),
    locationCapturedBy: uuid("location_captured_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    check(
      "commercial_accounts_contact_required",
      sql`${table.phone} is not null or ${table.email} is not null`,
    ),
    check("commercial_accounts_version_positive", sql`${table.version} > 0`),
    check(
      "commercial_accounts_latitude_range",
      sql`${table.latitude} is null or ${table.latitude} between -90 and 90`,
    ),
    check(
      "commercial_accounts_longitude_range",
      sql`${table.longitude} is null or ${table.longitude} between -180 and 180`,
    ),
    check(
      "commercial_accounts_location_source",
      sql`${table.locationSource} is null or ${table.locationSource} in ('MANUAL', 'DEVICE', 'MAP')`,
    ),
    check(
      "commercial_accounts_location_pair",
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
    check(
      "commercial_accounts_location_metadata",
      sql`(${table.latitude} is null and ${table.locationSource} is null and ${table.locationCapturedAt} is null and ${table.locationCapturedBy} is null)
        or (${table.latitude} is not null and ${table.longitude} is not null and ${table.locationSource} is not null
          and ${table.locationCapturedAt} is not null and ${table.locationCapturedBy} is not null)`,
    ),
    index("commercial_accounts_owner_status_idx").on(table.ownerUserId, table.status),
    index("commercial_accounts_country_city_idx").on(table.countryCode, table.city),
    index("commercial_accounts_name_trgm_idx").using(
      "gin",
      table.normalizedDisplayName.asc().op("gin_trgm_ops"),
    ),
    index("commercial_accounts_page_idx").on(table.normalizedDisplayName, table.id),
  ],
);

export const fruits = pgTable(
  "fruits",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 150 }).notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...auditColumns(),
  },
  (table) => [
    unique("fruits_normalized_name_uq").on(table.normalizedName),
    check("fruits_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("fruits_normalized_name_not_blank", sql`btrim(${table.normalizedName}) <> ''`),
    index("fruits_active_name_idx").on(table.active, table.normalizedName),
  ],
);

export const commercialAccountFruits = pgTable(
  "commercial_account_fruits",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => commercialAccounts.id, { onDelete: "cascade" }),
    fruitId: uuid("fruit_id")
      .notNull()
      .references(() => fruits.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.fruitId] }),
    index("commercial_account_fruits_fruit_idx").on(table.fruitId, table.accountId),
  ],
);

export const commercialContacts = pgTable(
  "commercial_contacts",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => commercialAccounts.id, { onDelete: "restrict" }),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    normalizedFullName: varchar("normalized_full_name", { length: 200 }).notNull(),
    title: varchar("title", { length: 150 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 320 }),
    notes: text("notes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    check(
      "commercial_contacts_channel_required",
      sql`${table.phone} is not null or ${table.email} is not null`,
    ),
    check("commercial_contacts_version_positive", sql`${table.version} > 0`),
    uniqueIndex("commercial_contacts_primary_uq")
      .on(table.accountId)
      .where(sql`${table.isPrimary} and ${table.deletedAt} is null`),
    index("commercial_contacts_account_idx").on(table.accountId),
    index("commercial_contacts_name_trgm_idx").using(
      "gin",
      table.normalizedFullName.asc().op("gin_trgm_ops"),
    ),
  ],
);

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => commercialAccounts.id, { onDelete: "restrict" }),
    responsibleUserId: uuid("responsible_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    reason: text("reason").notNull(),
    priority: priority("priority").notNull().default("MEDIUM"),
    notes: text("notes"),
    status: visitStatus("status").notNull().default("PENDING"),
    observation: text("observation"),
    result: visitResult("result"),
    actualStartedAt: timestamp("actual_started_at", { withTimezone: true }),
    actualEndedAt: timestamp("actual_ended_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "restrict" }),
    cancellationReason: text("cancellation_reason"),
    version: integer("version").notNull().default(1),
    ...auditColumns(),
  },
  (table) => [
    unique("visits_id_account_uq").on(table.id, table.accountId),
    check("visits_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check("visits_version_positive", sql`${table.version} > 0`),
    check(
      "visits_completed_fields",
      sql`${table.status} <> 'COMPLETED' or (${table.observation} is not null and btrim(${table.observation}) <> '' and ${table.result} is not null and ${table.actualEndedAt} is not null and ${table.completedAt} is not null and ${table.completedBy} is not null)`,
    ),
    check(
      "visits_completion_state",
      sql`(${table.status} = 'COMPLETED') = (${table.result} is not null and ${table.completedAt} is not null)`,
    ),
    check(
      "visits_cancelled_fields",
      sql`${table.status} <> 'CANCELLED' or (${table.cancelledAt} is not null and ${table.cancelledBy} is not null and ${table.cancellationReason} is not null and btrim(${table.cancellationReason}) <> '')`,
    ),
    index("visits_responsible_pending_idx")
      .on(table.responsibleUserId, table.scheduledAt)
      .where(sql`${table.status} = 'PENDING'`),
    index("visits_account_scheduled_idx").on(table.accountId, table.scheduledAt),
    index("visits_page_idx").on(table.scheduledAt, table.id),
  ],
);

export const visitReschedules = pgTable(
  "visit_reschedules",
  {
    id: uuid("id").primaryKey(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "restrict" }),
    oldScheduledAt: timestamp("old_scheduled_at", { withTimezone: true }).notNull(),
    newScheduledAt: timestamp("new_scheduled_at", { withTimezone: true }).notNull(),
    oldTimezone: varchar("old_timezone", { length: 100 }).notNull(),
    newTimezone: varchar("new_timezone", { length: 100 }).notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("visit_reschedules_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check(
      "visit_reschedules_schedule_changed",
      sql`${table.oldScheduledAt} is distinct from ${table.newScheduledAt} or ${table.oldTimezone} is distinct from ${table.newTimezone}`,
    ),
    index("visit_reschedules_visit_created_idx").on(table.visitId, table.createdAt),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => commercialAccounts.id, { onDelete: "restrict" }),
    visitId: uuid("visit_id"),
    responsibleUserId: uuid("responsible_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    dueDate: date("due_date").notNull(),
    dueTime: time("due_time"),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    priority: priority("priority").notNull().default("MEDIUM"),
    status: taskStatus("status").notNull().default("PENDING"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "restrict" }),
    cancellationReason: text("cancellation_reason"),
    version: integer("version").notNull().default(1),
    ...auditColumns(),
  },
  (table) => [
    unique("tasks_id_account_uq").on(table.id, table.accountId),
    foreignKey({
      name: "tasks_visit_same_account_fk",
      columns: [table.visitId, table.accountId],
      foreignColumns: [visits.id, visits.accountId],
    }).onDelete("restrict"),
    check("tasks_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("tasks_version_positive", sql`${table.version} > 0`),
    check(
      "tasks_completed_fields",
      sql`${table.status} <> 'COMPLETED' or (${table.completedAt} is not null and ${table.completedBy} is not null)`,
    ),
    check(
      "tasks_cancelled_fields",
      sql`${table.status} <> 'CANCELLED' or (${table.cancelledAt} is not null and ${table.cancelledBy} is not null and ${table.cancellationReason} is not null and btrim(${table.cancellationReason}) <> '')`,
    ),
    index("tasks_responsible_open_idx")
      .on(table.responsibleUserId, table.dueDate)
      .where(sql`${table.status} in ('PENDING', 'IN_PROGRESS')`),
    index("tasks_account_idx").on(table.accountId),
    index("tasks_account_created_idx").on(table.accountId, table.createdAt.desc()),
    index("tasks_visit_due_idx").on(table.visitId, table.dueDate, table.id),
    index("tasks_page_idx").on(table.dueDate, table.dueTime, table.id),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey(),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: reminderStatus("status").notNull().default("PENDING"),
    jobKey: varchar("job_key", { length: 255 }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    pushAttemptedAt: timestamp("push_attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("reminders_exactly_one_target", sql`num_nonnulls(${table.visitId}, ${table.taskId}) = 1`),
    unique("reminders_job_key_uq").on(table.jobKey),
    check(
      "reminders_cancelled_timestamp",
      sql`${table.status} <> 'CANCELLED' or ${table.cancelledAt} is not null`,
    ),
    check(
      "reminders_delivered_timestamp",
      sql`${table.status} <> 'DELIVERED' or ${table.deliveredAt} is not null`,
    ),
    index("reminders_visit_status_idx").on(table.visitId, table.status),
    index("reminders_task_status_idx").on(table.taskId, table.status),
    index("reminders_pending_schedule_idx")
      .on(table.scheduledAt)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

export const mutationIdempotency = pgTable(
  "mutation_idempotency",
  {
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    operation: varchar("operation", { length: 200 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorUserId, table.idempotencyKey, table.operation] }),
    check("mutation_idempotency_request_hash", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("mutation_idempotency_status_code", sql`${table.statusCode} between 200 and 299`),
    index("mutation_idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const documentCategories = pgTable(
  "document_categories",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 150 }).notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...auditColumns(),
  },
  (table) => [unique("document_categories_normalized_name_uq").on(table.normalizedName)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => commercialAccounts.id, { onDelete: "restrict" }),
    visitId: uuid("visit_id"),
    taskId: uuid("task_id"),
    categoryId: uuid("category_id").references(() => documentCategories.id, {
      onDelete: "restrict",
    }),
    title: varchar("title", { length: 200 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    storageKey: varchar("storage_key", { length: 255 }).notNull(),
    format: documentFormat("format").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    status: documentStatus("status").notNull().default("QUARANTINED"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    rejectedReason: varchar("rejected_reason", { length: 300 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    ...auditColumns(),
  },
  (table) => [
    foreignKey({
      name: "documents_visit_same_account_fk",
      columns: [table.visitId, table.accountId],
      foreignColumns: [visits.id, visits.accountId],
    }).onDelete("restrict"),
    foreignKey({
      name: "documents_task_same_account_fk",
      columns: [table.taskId, table.accountId],
      foreignColumns: [tasks.id, tasks.accountId],
    }).onDelete("restrict"),
    unique("documents_storage_key_uq").on(table.storageKey),
    check("documents_single_context", sql`num_nonnulls(${table.visitId}, ${table.taskId}) <= 1`),
    check("documents_size_range", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 10485760`),
    check("documents_checksum_sha256", sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_version_positive", sql`${table.version} > 0`),
    index("documents_account_category_created_idx").on(
      table.accountId,
      table.categoryId,
      table.createdAt,
    ),
    index("documents_checksum_idx").on(table.checksumSha256),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 80 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: varchar("body", { length: 500 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }),
    resourceId: uuid("resource_id"),
    sourceKey: varchar("source_key", { length: 255 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_read_created_idx").on(t.userId, t.readAt, t.createdAt),
    index("notifications_created_at_idx").on(t.createdAt),
    uniqueIndex("notifications_source_key_uq")
      .on(t.sourceKey)
      .where(sql`${t.sourceKey} is not null`),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    unique("push_subscriptions_endpoint_hash_uq").on(t.endpointHash),
    index("push_subscriptions_user_device_idx").on(t.userId, t.deviceId),
  ],
);

export const notificationPushDeliveries = pgTable(
  "notification_push_deliveries",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    status: pushDeliveryStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
  },
  (t) => [
    primaryKey({ columns: [t.notificationId, t.subscriptionId] }),
    index("notification_push_pending_idx")
      .on(t.notificationId, t.status)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);

export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").primaryKey(),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reportGroup: varchar("report_group", { length: 20 }).notNull(),
    template: varchar("template", { length: 100 }).notNull(),
    format: varchar("format", { length: 10 }).notNull(),
    filters: jsonb("filters").notNull().default({}),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    status: reportExportStatus("status").notNull().default("QUEUED"),
    storageKey: varchar("storage_key", { length: 255 }),
    errorCode: varchar("error_code", { length: 100 }),
    requesterRole: userRole("requester_role").notNull().default("MANAGER"),
    scopeUserId: uuid("scope_user_id").references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_exports_requester_created_idx").on(t.requesterUserId, t.createdAt)],
);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey(),
  requesterUserId: uuid("requester_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  format: importFormat("format").notNull(),
  storageKey: varchar("storage_key", { length: 255 }).notNull(),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  status: importStatus("status").notNull().default("UPLOADED"),
  confirmationId: uuid("confirmation_id"),
  totalRows: integer("total_rows").notNull().default(0),
  createRows: integer("create_rows").notNull().default(0),
  updateRows: integer("update_rows").notNull().default(0),
  skipRows: integer("skip_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  errorStorageKey: varchar("error_storage_key", { length: 255 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    action: importRowAction("action").notNull(),
    errors: jsonb("errors").notNull().default([]),
    duplicateOfAccountId: uuid("duplicate_of_account_id").references(() => commercialAccounts.id, {
      onDelete: "restrict",
    }),
    valuesJson: jsonb("values_json").notNull().default({}),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [unique("import_rows_batch_number_uq").on(t.batchId, t.rowNumber)],
);

export const appSettings = pgTable("app_settings", {
  settingsKey: varchar("settings_key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id"),
    beforeChanges: jsonb("before_changes"),
    afterChanges: jsonb("after_changes"),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "restrict" }),
    ipAddress: varchar("ip_address", { length: 64 }),
    retentionClass: varchar("retention_class", { length: 20 }).notNull().default("FUNCTIONAL"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_occurred_idx").on(table.actorUserId, table.occurredAt),
    index("audit_logs_entity_occurred_idx").on(table.entityType, table.entityId, table.occurredAt),
    index("audit_logs_request_id_idx").on(table.requestId),
  ],
);

export const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    clientOperationId: uuid("client_operation_id").notNull(),
    sequence: integer("sequence").notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 20 }).notNull(),
    baseVersion: integer("base_version"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    changedFields: text("changed_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: syncOperationStatus("status").notNull().default("RECEIVED"),
    resultCode: varchar("result_code", { length: 100 }),
    resultEntityVersion: integer("result_entity_version"),
    resultStatus: varchar("result_status", { length: 20 }),
    conflictId: uuid("conflict_id"),
    resultBody: jsonb("result_body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    unique("sync_operations_device_client_uq").on(table.deviceId, table.clientOperationId),
    unique("sync_operations_device_sequence_uq").on(table.deviceId, table.sequence),
    check("sync_operations_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "sync_operations_base_version_positive",
      sql`${table.baseVersion} is null or ${table.baseVersion} > 0`,
    ),
    check("sync_operations_payload_hash", sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const changeLog = pgTable(
  "change_log",
  {
    cursor: bigserial("cursor", { mode: "bigint" }).primaryKey(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: changeOperation("operation").notNull(),
    version: integer("version").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
    changedFields: text("changed_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    data: jsonb("data"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    requestId: varchar("request_id", { length: 100 }).notNull(),
  },
  (table) => [
    check("change_log_version_positive", sql`${table.version} > 0`),
    index("change_log_entity_version_idx").on(table.entityType, table.entityId, table.version),
    index("change_log_owner_cursor_idx").on(table.ownerUserId, table.cursor),
  ],
);

export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => syncOperations.id, { onDelete: "restrict" }),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    baseVersion: integer("base_version").notNull(),
    serverVersion: integer("server_version").notNull(),
    conflictingFields: text("conflicting_fields").array().notNull(),
    code: varchar("code", { length: 100 }).notNull().default("SAME_FIELD_CHANGED"),
    baseSnapshot: jsonb("base_snapshot").notNull().default({}),
    clientSnapshot: jsonb("client_snapshot").notNull().default({}),
    serverSnapshot: jsonb("server_snapshot").notNull().default({}),
    baseSnapshotHash: varchar("base_snapshot_hash", { length: 64 }).notNull(),
    clientSnapshotHash: varchar("client_snapshot_hash", { length: 64 }).notNull(),
    serverSnapshotHash: varchar("server_snapshot_hash", { length: 64 }).notNull(),
    status: syncConflictStatus("status").notNull().default("OPEN"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
    resolution: varchar("resolution", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sync_conflicts_operation_uq").on(table.operationId),
    check(
      "sync_conflicts_versions_positive",
      sql`${table.baseVersion} > 0 and ${table.serverVersion} > 0`,
    ),
    index("sync_conflicts_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const syncOperationDependencies = pgTable(
  "sync_operation_dependencies",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => syncOperations.id, { onDelete: "cascade" }),
    dependsOnOperationId: uuid("depends_on_operation_id")
      .notNull()
      .references(() => syncOperations.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.dependsOnOperationId] }),
    check(
      "sync_operation_dependencies_not_self",
      sql`${table.operationId} <> ${table.dependsOnOperationId}`,
    ),
  ],
);
