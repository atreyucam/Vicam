import { z } from "./zod.js";

export const activeFruitSchema = z
  .object({ id: z.uuid(), name: z.string().min(1).max(150), active: z.literal(true) })
  .meta({ id: "ActiveFruit" });

export const activeFruitsSchema = z.array(activeFruitSchema).meta({ id: "ActiveFruits" });

export const fruitSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(150),
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .meta({ id: "Fruit" });

export const fruitsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});

export const createFruitRequestSchema = z
  .object({ name: z.string().trim().min(1).max(150) })
  .meta({ id: "CreateFruitRequest" });

export const updateFruitRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    active: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.name !== undefined || value.active !== undefined, {
    message: "Se requiere al menos un cambio.",
  })
  .meta({ id: "UpdateFruitRequest" });

export type ActiveFruit = z.infer<typeof activeFruitSchema>;
export type Fruit = z.infer<typeof fruitSchema>;
