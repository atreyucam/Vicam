import { z } from "./zod.js";

export const requestIdSchema = z.string().min(1).meta({ example: "01JABCDEF0123456789ABCDE" });

export const errorEnvelopeSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: requestIdSchema,
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "ErrorEnvelope" });

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
