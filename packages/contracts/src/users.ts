import { userRoleSchema, userStatusSchema } from "./auth.js";
import { paginationMetaSchema, paginationQuerySchema } from "./pagination.js";
import { z } from "./zod.js";

export const userSchema = z
  .object({
    id: z.uuid(),
    username: z.string().min(1).max(100),
    fullName: z.string().min(1).max(200),
    role: userRoleSchema,
    status: userStatusSchema,
    mustChangePassword: z.boolean(),
    lastLoginAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "User" });

export const usersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
});

export const usersPageSchema = z
  .object({ items: z.array(userSchema), pagination: paginationMetaSchema })
  .meta({ id: "UsersPage" });

export const createUserRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    fullName: z.string().trim().min(1).max(200),
    role: userRoleSchema,
  })
  .meta({ id: "CreateUserRequest" });

export const temporaryCredentialSchema = z
  .object({
    user: userSchema,
    temporaryPassword: z.string().min(8),
  })
  .meta({ id: "TemporaryCredential" });

export const resetUserPasswordRequestSchema = z.object({}).meta({ id: "ResetUserPasswordRequest" });

export const updateUserRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Se requiere al menos un cambio.")
  .meta({ id: "UpdateUserRequest" });

export type User = z.infer<typeof userSchema>;
export type TemporaryCredential = z.infer<typeof temporaryCredentialSchema>;
