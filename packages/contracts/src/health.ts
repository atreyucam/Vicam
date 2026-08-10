import { z } from "./zod.js";

export const healthStatusSchema = z.enum(["ok", "degraded"]);

export const liveHealthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.string().min(1),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "LiveHealth" });

export const readyHealthSchema = z
  .object({
    status: healthStatusSchema,
    service: z.string().min(1),
    timestamp: z.iso.datetime({ offset: true }),
    checks: z.object({ database: z.enum(["up", "down"]) }),
  })
  .meta({ id: "ReadyHealth" });

export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ReadyHealth = z.infer<typeof readyHealthSchema>;
