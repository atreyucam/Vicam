import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { AppError } from "../errors.js";

const accessPayloadSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  did: z.uuid(),
  role: z.enum(["MANAGER", "SUPERVISOR"]),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessPayload = z.infer<typeof accessPayloadSchema>;

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueAccessToken(
  identity: Pick<AccessPayload, "sub" | "sid" | "did" | "role">,
  secret: string,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = new Date((issuedAt + 15 * 60) * 1_000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify({ ...identity, iat: issuedAt, exp: issuedAt + 15 * 60 }));
  const unsigned = `${header}.${payload}`;
  return { token: `${unsigned}.${signature(unsigned, secret)}`, expiresAt };
}

export function verifyAccessToken(token: string, secret: string, now = new Date()): AccessPayload {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "La sesión no es válida.");
  const [header, payload, supplied] = parts as [string, string, string];
  const expected = signature(`${header}.${payload}`, secret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "La sesión no es válida.");
  }
  try {
    const parsed = accessPayloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (parsed.exp <= Math.floor(now.getTime() / 1_000)) {
      throw new AppError(401, "ACCESS_TOKEN_EXPIRED", "La sesión ha vencido.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "La sesión no es válida.");
  }
}
