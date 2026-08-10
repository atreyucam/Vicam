import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { z } from "./zod.js";

export const auditLogSchema = z
  .object({
    id: z.string(),
    actorUserId: z.uuid().nullable(),
    action: z.string().min(1),
    entityType: z.string().min(1),
    entityId: z.uuid().nullable(),
    changedFields: z.array(z.string()),
    requestId: z.string().min(1),
    ipAddress: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "AuditLog" });

export const auditQuerySchema = paginationQuerySchema.extend({
  actorUserId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const auditPageSchema = z
  .object({ items: z.array(auditLogSchema), pagination: paginationMetaSchema })
  .meta({ id: "AuditPage" });
