import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { documentStatusSchema } from "./phase3.js";
import { accountStatusSchema } from "./accounts.js";
import { taskStatusSchema } from "./tasks.js";
import { prioritySchema, visitStatusSchema } from "./visits.js";
import { z } from "./zod.js";

export const reportAnalyticsViewSchema = z.enum([
  "summary",
  "visits",
  "tasks",
  "accounts",
  "documents",
]);

export const reportAnalyticsQuerySchema = paginationQuerySchema
  .extend({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    timezone: z.literal("America/Guayaquil").default("America/Guayaquil"),
    responsibleUserId: z.uuid().optional(),
    accountId: z.uuid().optional(),
    city: z.string().trim().min(1).max(150).optional(),
    visitStatus: visitStatusSchema.optional(),
    taskStatus: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    overdue: z.stringbool().optional(),
    accountStatus: accountStatusSchema.optional(),
    categoryId: z.uuid().optional(),
    documentStatus: documentStatusSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
    path: ["from"],
  });

export const reportKpiSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    value: z.number().finite(),
    format: z.enum(["NUMBER", "PERCENT"]),
  })
  .meta({ id: "ReportKpi" });

export const reportSeriesPointSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    value: z.number().finite(),
    secondaryValue: z.number().finite().optional(),
  })
  .meta({ id: "ReportSeriesPoint" });

export const reportResponsibleActivitySchema = z
  .object({
    userId: z.uuid(),
    name: z.string().min(1).max(200),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    compliancePercent: z.number().min(0).max(100).nullable(),
  })
  .meta({ id: "ReportResponsibleActivity" });

export const reportAttentionItemSchema = z
  .object({
    kind: z.enum(["VISIT", "TASK", "ACCOUNT", "DOCUMENT"]),
    id: z.uuid(),
    title: z.string().min(1).max(250),
    detail: z.string().min(1).max(500),
    date: z.string().nullable(),
    href: z.string().startsWith("/app/"),
  })
  .meta({ id: "ReportAttentionItem" });

export const reportTableRowSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["VISIT", "TASK", "ACCOUNT", "DOCUMENT"]),
    title: z.string().min(1).max(250),
    date: z.string().nullable(),
    accountName: z.string().max(250).nullable(),
    responsibleName: z.string().max(200).nullable(),
    status: z.string().max(80).nullable(),
    priority: z.string().max(80).nullable(),
    city: z.string().max(150).nullable(),
    category: z.string().max(150).nullable(),
    format: z.string().max(20).nullable(),
    total: z.number().int().nonnegative().nullable(),
    secondary: z.string().max(250).nullable(),
    href: z.string().startsWith("/app/"),
  })
  .meta({ id: "ReportTableRow" });

export const reportAnalyticsResponseSchema = z
  .object({
    view: reportAnalyticsViewSchema,
    kpis: z.array(reportKpiSchema),
    trend: z.array(reportSeriesPointSchema),
    distribution: z.array(reportSeriesPointSchema),
    secondaryDistribution: z.array(reportSeriesPointSchema),
    responsibleActivity: z.array(reportResponsibleActivitySchema),
    attention: z.array(reportAttentionItemSchema),
    rows: z.array(reportTableRowSchema),
    pagination: paginationMetaSchema,
  })
  .meta({ id: "ReportAnalyticsResponse" });

export type ReportAnalyticsQuery = z.infer<typeof reportAnalyticsQuerySchema>;
export type ReportAnalyticsResponse = z.infer<typeof reportAnalyticsResponseSchema>;
export type ReportAnalyticsView = z.infer<typeof reportAnalyticsViewSchema>;
