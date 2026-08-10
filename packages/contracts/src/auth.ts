import { z } from "./zod.js";

export const userRoleSchema = z.enum(["MANAGER", "SUPERVISOR"]);
export const userStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const passwordSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/[A-Z]/, "Debe incluir una mayúscula.")
  .regex(/[a-z]/, "Debe incluir una minúscula.")
  .regex(/[0-9]/, "Debe incluir un número.")
  .regex(/[^A-Za-z0-9]/, "Debe incluir un símbolo.");

export const authenticatedUserSchema = z
  .object({
    id: z.uuid(),
    username: z.string().min(1).max(100),
    fullName: z.string().min(1).max(200),
    role: userRoleSchema,
    mustChangePassword: z.boolean(),
  })
  .meta({ id: "AuthenticatedUser" });

export const loginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(256),
    deviceName: z.string().trim().min(1).max(200).default("Navegador web"),
    platform: z.string().trim().min(1).max(100).default("web"),
  })
  .meta({ id: "LoginRequest" });

export const sessionTokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.iso.datetime({ offset: true }),
    csrfToken: z.string().min(32),
    user: authenticatedUserSchema,
  })
  .meta({ id: "SessionTokenResponse" });

export const userSessionSchema = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid(),
    deviceName: z.string().min(1),
    platform: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }),
    current: z.boolean(),
  })
  .meta({ id: "UserSession" });

export const changePasswordRequestSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema })
  .meta({ id: "ChangePasswordRequest" });

export const csrfHeaderSchema = z.object({ "x-csrf-token": z.string().min(32) });

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionTokenResponse = z.infer<typeof sessionTokenResponseSchema>;
