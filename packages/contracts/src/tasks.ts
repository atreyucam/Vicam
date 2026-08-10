import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { prioritySchema } from "./visits.js";
import { z } from "./zod.js";

export const taskStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

export const taskSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    accountDisplayName: z.string().min(1),
    visitId: z.uuid().nullable(),
    responsibleUserId: z.uuid(),
    responsibleFullName: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().nullable(),
    dueDate: z.iso.date(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullable(),
    timezone: z.string().min(1).max(100),
    priority: prioritySchema,
    status: taskStatusSchema,
    overdue: z.boolean(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    visitScheduledAt: z.iso.datetime({ offset: true }).nullable(),
    visitReason: z.string().nullable(),
    version: z.number().int().positive(),
  })
  .meta({ id: "Task" });

export const tasksQuerySchema = paginationQuerySchema.extend({
  responsibleUserId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  visitId: z.uuid().optional(),
  status: taskStatusSchema.optional(),
  dueFrom: z.iso.date().optional(),
  dueTo: z.iso.date().optional(),
});

export const tasksPageSchema = z
  .object({ items: z.array(taskSchema), pagination: paginationMetaSchema })
  .meta({ id: "TasksPage" });

const taskFieldsSchema = z.object({
  accountId: z.uuid(),
  visitId: z.uuid().nullable().optional(),
  responsibleUserId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  dueDate: z.iso.date(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .nullable()
    .optional(),
  timezone: z.string().min(1).max(100),
  priority: prioritySchema.default("MEDIUM"),
});

export const createTaskRequestSchema = taskFieldsSchema.meta({ id: "CreateTaskRequest" });
export const updateTaskRequestSchema = taskFieldsSchema
  .partial()
  .extend({
    status: z.enum(["PENDING", "IN_PROGRESS"]).optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => Object.keys(value).length > 1, "Se requiere al menos un cambio.")
  .meta({ id: "UpdateTaskRequest" });
export const completeTaskRequestSchema = z
  .object({ version: z.number().int().positive() })
  .meta({ id: "CompleteTaskRequest" });
export const cancelTaskRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    version: z.number().int().positive(),
  })
  .meta({ id: "CancelTaskRequest" });

export const taskDetailSchema = taskSchema
  .extend({
    createdAt: z.iso.datetime({ offset: true }),
    createdByFullName: z.string().min(1).nullable(),
    completedByFullName: z.string().min(1).nullable(),
    cancelledAt: z.iso.datetime({ offset: true }).nullable(),
    cancelledByFullName: z.string().min(1).nullable(),
    cancellationReason: z.string().nullable(),
  })
  .meta({ id: "TaskDetail" });

export type Task = z.infer<typeof taskSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
