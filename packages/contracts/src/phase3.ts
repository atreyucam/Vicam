import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { z } from "./zod.js";

export const documentFormatSchema = z.enum(["PDF", "DOCX", "XLSX"]);
export const documentStatusSchema = z.enum([
  "QUARANTINED",
  "SCANNING",
  "AVAILABLE",
  "REJECTED",
  "DELETED",
]);
export const documentCategorySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(150),
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .meta({ id: "DocumentCategory" });
export const documentSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    visitId: z.uuid().nullable(),
    taskId: z.uuid().nullable(),
    categoryId: z.uuid(),
    categoryName: z.string().min(1),
    originalName: z.string().min(1).max(255),
    format: documentFormatSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    status: documentStatusSchema,
    rejectedReason: z.string().nullable(),
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
  })
  .meta({ id: "Document" });
export const documentsQuerySchema = paginationQuerySchema.extend({
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  status: documentStatusSchema.optional(),
});
export const documentsPageSchema = z
  .object({ items: z.array(documentSchema), pagination: paginationMetaSchema })
  .meta({ id: "DocumentsPage" });
export const createDocumentCategoryRequestSchema = z
  .object({ name: z.string().trim().min(1).max(150) })
  .meta({ id: "CreateDocumentCategoryRequest" });
export const updateDocumentCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    active: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => Object.keys(value).length > 1, "Se requiere al menos un cambio.")
  .meta({ id: "UpdateDocumentCategoryRequest" });

export const notificationSchema = z
  .object({
    id: z.uuid(),
    type: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(500),
    resourceType: z.string().max(80).nullable(),
    resourceId: z.uuid().nullable(),
    readAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "Notification" });
export const notificationsPageSchema = z
  .object({ items: z.array(notificationSchema), pagination: paginationMetaSchema })
  .meta({ id: "NotificationsPage" });
export const notificationsQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(15).max(15).default(15),
  unread: z.coerce.boolean().optional(),
});
export const pushSubscriptionRequestSchema = z
  .object({
    deviceId: z.uuid(),
    endpoint: z.url().max(2_000),
    p256dh: z.string().min(1).max(1_000),
    auth: z.string().min(1).max(1_000),
  })
  .meta({ id: "PushSubscriptionRequest" });

export const reportGroupSchema = z.enum(["VISITS", "TASKS", "ACCOUNTS", "DOCUMENTS", "MANAGEMENT"]);
export const reportFormatSchema = z.enum(["PDF", "XLSX"]);
export const reportExportStatusSchema = z.enum([
  "QUEUED",
  "PROCESSING",
  "AVAILABLE",
  "FAILED",
  "EXPIRED",
]);
export const createReportExportRequestSchema = z
  .object({
    group: reportGroupSchema,
    template: z.string().trim().min(1).max(100),
    format: reportFormatSchema,
    filters: z.record(z.string(), z.unknown()).default({}),
    timezone: z.string().min(1).max(100),
  })
  .meta({ id: "CreateReportExportRequest" });
export const reportExportSchema = z
  .object({
    id: z.uuid(),
    group: reportGroupSchema,
    template: z.string(),
    format: reportFormatSchema,
    status: reportExportStatusSchema,
    filters: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    error: z.string().nullable(),
  })
  .meta({ id: "ReportExport" });
export const reportExportsPageSchema = z
  .object({ items: z.array(reportExportSchema), pagination: paginationMetaSchema })
  .meta({ id: "ReportExportsPage" });

export const importFormatSchema = z.enum(["XLSX", "CSV"]);
export const importStatusSchema = z.enum([
  "UPLOADED",
  "VALIDATING",
  "READY",
  "CONFIRMING",
  "COMPLETED",
  "FAILED",
]);
export const importRowActionSchema = z.enum(["CREATE", "UPDATE", "SKIP", "ERROR"]);
export const importBatchSchema = z
  .object({
    id: z.uuid(),
    format: importFormatSchema,
    status: importStatusSchema,
    totalRows: z.number().int().nonnegative(),
    createRows: z.number().int().nonnegative(),
    updateRows: z.number().int().nonnegative(),
    skipRows: z.number().int().nonnegative(),
    errorRows: z.number().int().nonnegative(),
    confirmationId: z.uuid().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "ImportBatch" });
export const importRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    action: importRowActionSchema,
    errors: z.array(z.string()),
    duplicateOfAccountId: z.uuid().nullable(),
    values: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "ImportRow" });
export const importBatchDetailSchema = importBatchSchema
  .extend({ rows: z.array(importRowSchema) })
  .meta({ id: "ImportBatchDetail" });
export const confirmImportRequestSchema = z
  .object({ confirmationId: z.uuid() })
  .meta({ id: "ConfirmImportRequest" });

export const appSettingsSchema = z
  .object({
    offlineWindowHours: z.number().int().min(1).max(72),
    visitReminderOffsetsMinutes: z.array(z.number().int().positive()).max(5),
    taskReminderOffsetsMinutes: z.array(z.number().int().positive()).max(5),
    supervisorReportsEnabled: z.boolean(),
    documentLimitBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    defaultTimezone: z.string().min(1).max(100),
    retentionDays: z.object({
      exports: z.literal(7),
      documentsTrash: z.literal(30),
      jobs: z.literal(90),
    }),
    version: z.number().int().positive(),
  })
  .meta({ id: "AppSettings" });
export const updateAppSettingsRequestSchema = appSettingsSchema
  .pick({
    offlineWindowHours: true,
    visitReminderOffsetsMinutes: true,
    taskReminderOffsetsMinutes: true,
    supervisorReportsEnabled: true,
    documentLimitBytes: true,
    defaultTimezone: true,
    version: true,
  })
  .meta({ id: "UpdateAppSettingsRequest" });

export type Document = z.infer<typeof documentSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type ReportExport = z.infer<typeof reportExportSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
