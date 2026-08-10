import { z } from "zod";

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const uuid = z.uuid();
const priority = z.enum(["LOW", "MEDIUM", "HIGH"]);
const dateRange = {
  from: civilDate.optional(),
  to: civilDate.optional(),
};

const schemas = {
  VISITS: z
    .object({
      ...dateRange,
      responsibleUserId: uuid.optional(),
      accountId: uuid.optional(),
      city: z.string().trim().min(1).max(150).optional(),
      status: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(),
      priority: priority.optional(),
    })
    .strict(),
  TASKS: z
    .object({
      ...dateRange,
      responsibleUserId: uuid.optional(),
      accountId: uuid.optional(),
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
      priority: priority.optional(),
      overdue: z.boolean().optional(),
      origin: z.enum(["VISIT", "MANUAL"]).optional(),
    })
    .strict(),
  ACCOUNTS: z
    .object({
      status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
      accountType: z.string().trim().min(1).max(50).optional(),
      countryCode: z
        .string()
        .trim()
        .length(2)
        .transform((value) => value.toUpperCase())
        .optional(),
      city: z.string().trim().min(1).max(150).optional(),
      fruitId: uuid.optional(),
      responsibleUserId: uuid.optional(),
      noVisitSince: civilDate.optional(),
    })
    .strict(),
  DOCUMENTS: z
    .object({
      ...dateRange,
      accountId: uuid.optional(),
      categoryId: uuid.optional(),
      authorUserId: uuid.optional(),
      format: z.enum(["PDF", "DOCX", "XLSX"]).optional(),
    })
    .strict(),
  MANAGEMENT: z
    .object({
      ...dateRange,
      responsibleUserId: uuid.optional(),
    })
    .strict(),
} as const;
const templates = {
  VISITS: ["agenda", "completed", "cancelled-rescheduled", "productivity"],
  TASKS: ["open", "overdue", "completed", "workload"],
  ACCOUNTS: ["directory", "stale", "by-fruit-location-owner"],
  DOCUMENTS: ["inventory", "by-category", "review-due"],
  MANAGEMENT: ["kpis", "period-activity"],
} as const;

export type ReportGroup = keyof typeof schemas;
export type ReportFilters = Record<string, string | boolean>;

export function parseReportFilters(group: ReportGroup, value: unknown): ReportFilters {
  const parsed = schemas[group].parse(value);
  if ("from" in parsed && parsed.from && parsed.to && parsed.from > parsed.to) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "La fecha inicial no puede ser posterior a la final.",
        path: ["from"],
      },
    ]);
  }
  return parsed as ReportFilters;
}

export function assertReportTemplate(group: ReportGroup, template: string) {
  if (!(templates[group] as readonly string[]).includes(template))
    throw new z.ZodError([
      {
        code: "custom",
        message: "La plantilla no corresponde al grupo solicitado.",
        path: ["template"],
      },
    ]);
}
