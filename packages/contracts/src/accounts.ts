import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { prioritySchema } from "./visits.js";
import { z } from "./zod.js";

export const accountStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

const accountFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(250).nullable().optional(),
  accountType: z.string().trim().min(1).max(50),
  ownerUserId: z.uuid(),
  countryCode: z.string().trim().length(2).toUpperCase(),
  stateProvince: z.string().trim().max(150).nullable().optional(),
  city: z.string().trim().min(1).max(150),
  address: z.string().trim().max(1_000).nullable().optional(),
  postalCode: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationSource: z.enum(["MANUAL", "DEVICE"]).nullable().optional(),
  locationCapturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  fruitIds: z.array(z.uuid()).max(100).optional(),
});

export const accountFruitSchema = z
  .object({ id: z.uuid(), name: z.string().min(1).max(150) })
  .meta({ id: "AccountFruit" });

export const commercialAccountSchema = accountFieldsSchema
  .extend({
    id: z.uuid(),
    status: accountStatusSchema,
    version: z.number().int().positive(),
    ownerFullName: z.string().min(1),
    primaryContactName: z.string().nullable(),
    fruits: z.array(accountFruitSchema),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "CommercialAccount" });

export const createCommercialAccountRequestSchema = accountFieldsSchema
  .extend({ fruitIds: z.array(z.uuid()).max(100).default([]) })
  .refine((value) => Boolean(value.phone || value.email), {
    message: "La cuenta requiere teléfono o correo electrónico.",
    path: ["phone"],
  })
  .meta({ id: "CreateCommercialAccountRequest" });

export const updateCommercialAccountRequestSchema = accountFieldsSchema
  .partial()
  .extend({ status: accountStatusSchema.optional(), version: z.number().int().positive() })
  .refine((value) => Object.keys(value).length > 1, "Se requiere al menos un cambio.")
  .meta({ id: "UpdateCommercialAccountRequest" });

export const accountsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: accountStatusSchema.optional(),
  ownerUserId: z.uuid().optional(),
  city: z.string().trim().max(150).optional(),
});

export const commercialAccountsPageSchema = z
  .object({ items: z.array(commercialAccountSchema), pagination: paginationMetaSchema })
  .meta({ id: "CommercialAccountsPage" });

export const commercialActivityItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum([
      "VISIT_CREATED",
      "VISIT_RESCHEDULED",
      "VISIT_COMPLETED",
      "VISIT_CANCELLED",
      "TASK_CREATED",
      "TASK_COMPLETED",
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    resourceType: z.enum(["VISIT", "TASK"]),
    resourceId: z.uuid(),
  })
  .meta({ id: "CommercialActivityItem" });

export const commercialAccountSummarySchema = z
  .object({
    nextVisit: z
      .object({
        id: z.uuid(),
        scheduledAt: z.iso.datetime({ offset: true }),
        reason: z.string().min(1),
        responsibleFullName: z.string().min(1),
        priority: prioritySchema,
      })
      .nullable(),
    openTaskCount: z.number().int().nonnegative(),
    dueTodayTaskCount: z.number().int().nonnegative(),
    recentActivity: z.array(commercialActivityItemSchema).max(10),
  })
  .meta({ id: "CommercialAccountSummary" });

export const commercialContactSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    fullName: z.string().min(1).max(200),
    title: z.string().max(150).nullable(),
    phone: z.string().max(50).nullable(),
    email: z.string().max(320).nullable(),
    notes: z.string().max(2_000).nullable(),
    isPrimary: z.boolean(),
    version: z.number().int().positive(),
  })
  .meta({ id: "CommercialContact" });

const contactFieldsSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  title: z.string().trim().max(150).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export const createCommercialContactRequestSchema = contactFieldsSchema
  .refine((value) => Boolean(value.phone || value.email), {
    message: "El contacto requiere teléfono o correo electrónico.",
    path: ["phone"],
  })
  .meta({ id: "CreateCommercialContactRequest" });
export const updateCommercialContactRequestSchema = contactFieldsSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .meta({ id: "UpdateCommercialContactRequest" });

export type CommercialAccount = z.infer<typeof commercialAccountSchema>;
export type CommercialContact = z.infer<typeof commercialContactSchema>;
export type CommercialAccountSummary = z.infer<typeof commercialAccountSummarySchema>;
