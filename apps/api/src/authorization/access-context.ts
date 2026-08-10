import { z } from "zod";

const accessContextSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["MANAGER", "SUPERVISOR"]),
  deviceId: z.string().uuid().optional(),
});

export type AccessContext = z.infer<typeof accessContextSchema>;

export function parseAccessContext(value: unknown): AccessContext {
  return accessContextSchema.parse(value);
}

export function canAccessOwner(context: AccessContext, ownerUserId: string): boolean {
  return context.role === "MANAGER" || context.userId === ownerUserId;
}

export function canAssignOwner(context: AccessContext, targetUserId: string): boolean {
  return context.role === "MANAGER" || context.userId === targetUserId;
}
