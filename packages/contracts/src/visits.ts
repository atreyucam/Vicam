import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { z } from "./zod.js";

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const visitStatusSchema = z.enum(["PENDING", "COMPLETED", "CANCELLED"]);
export const visitResultSchema = z.enum([
  "INTERESTED",
  "FOLLOW_UP_REQUIRED",
  "PROPOSAL_REQUESTED",
  "NEGOTIATION",
  "NOT_INTERESTED",
  "NO_RESULT",
]);

export const visitSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    accountDisplayName: z.string().min(1),
    responsibleUserId: z.uuid(),
    responsibleFullName: z.string().min(1),
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    reason: z.string().min(1),
    priority: prioritySchema,
    notes: z.string().nullable(),
    status: visitStatusSchema,
    result: visitResultSchema.nullable(),
    observation: z.string().nullable(),
    actualStartedAt: z.iso.datetime({ offset: true }).nullable(),
    actualEndedAt: z.iso.datetime({ offset: true }).nullable(),
    cancellationReason: z.string().nullable(),
    version: z.number().int().positive(),
  })
  .meta({ id: "Visit" });

export const visitsQuerySchema = paginationQuerySchema.extend({
  responsibleUserId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  status: visitStatusSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const visitsPageSchema = z
  .object({ items: z.array(visitSchema), pagination: paginationMetaSchema })
  .meta({ id: "VisitsPage" });

export const createVisitRequestSchema = z
  .object({
    accountId: z.uuid(),
    responsibleUserId: z.uuid(),
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    reason: z.string().trim().min(1).max(2_000),
    priority: prioritySchema.default("MEDIUM"),
    notes: z.string().trim().max(5_000).nullable().optional(),
  })
  .meta({ id: "CreateVisitRequest" });

export const updateVisitRequestSchema = createVisitRequestSchema
  .pick({ reason: true, priority: true, notes: true })
  .partial()
  .extend({ version: z.number().int().positive() })
  .meta({ id: "UpdateVisitRequest" });

export const rescheduleVisitRequestSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    reason: z.string().trim().min(1).max(2_000),
    version: z.number().int().positive(),
  })
  .meta({ id: "RescheduleVisitRequest" });

export const cancelVisitRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(2_000), version: z.number().int().positive() })
  .meta({ id: "CancelVisitRequest" });

export const completeVisitRequestSchema = z
  .object({
    result: visitResultSchema,
    observation: z.string().trim().min(1).max(10_000),
    actualStartedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    actualEndedAt: z.iso.datetime({ offset: true }),
    followUpTask: z
      .object({
        id: z.uuid(),
        title: z.string().trim().min(1).max(200),
        responsibleUserId: z.uuid(),
        dueDate: z.iso.date(),
        priority: prioritySchema.default("MEDIUM"),
      })
      .nullable()
      .optional(),
    version: z.number().int().positive(),
  })
  .meta({ id: "CompleteVisitRequest" });

export const visitRescheduleSchema = z
  .object({
    id: z.uuid(),
    visitId: z.uuid(),
    oldScheduledAt: z.iso.datetime({ offset: true }),
    newScheduledAt: z.iso.datetime({ offset: true }),
    oldTimezone: z.string(),
    newTimezone: z.string(),
    reason: z.string(),
    actorUserId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "VisitReschedule" });

export const visitHistoryEventSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum(["CREATED", "RESCHEDULED", "COMPLETED", "CANCELLED"]),
    occurredAt: z.iso.datetime({ offset: true }),
    actorUserId: z.uuid().nullable(),
    actorFullName: z.string().min(1).nullable(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable(),
    oldScheduledAt: z.iso.datetime({ offset: true }).nullable(),
    newScheduledAt: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().nullable(),
    result: visitResultSchema.nullable(),
  })
  .meta({ id: "VisitHistoryEvent" });

export const visitDetailSchema = visitSchema
  .extend({
    createdAt: z.iso.datetime({ offset: true }),
    createdByFullName: z.string().min(1).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    completedByFullName: z.string().min(1).nullable(),
    cancelledAt: z.iso.datetime({ offset: true }).nullable(),
    cancelledByFullName: z.string().min(1).nullable(),
    history: z.array(visitHistoryEventSchema),
  })
  .meta({ id: "VisitDetail" });

export type Visit = z.infer<typeof visitSchema>;
export type VisitDetail = z.infer<typeof visitDetailSchema>;
export type VisitHistoryEvent = z.infer<typeof visitHistoryEventSchema>;
