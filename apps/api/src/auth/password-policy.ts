import { passwordSchema } from "@vicam/contracts";

import { AppError } from "../errors.js";
import { isCompromisedPassword } from "./compromised-password-denylist-v2.js";

const commonPasswords = new Set([
  "password",
  "password1",
  "password123",
  "qwerty123",
  "12345678",
  "123456789",
  "admin123",
  "welcome1",
  "contraseña",
  "vicam123",
  "abc12345",
]);

export function assertStrongPassword(password: string): void {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    throw new AppError(422, "WEAK_PASSWORD", "La contraseña no cumple la política de seguridad.", {
      fields: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const normalized = password.normalize("NFKC").toLocaleLowerCase("en-US");
  if (isCompromisedPassword(password)) {
    throw new AppError(
      422,
      "COMPROMISED_PASSWORD",
      "La contraseña aparece en la lista local de credenciales comprometidas.",
    );
  }
  if (
    commonPasswords.has(normalized) ||
    /(password|contrase(?:n|ñ)a|qwerty|123456)/i.test(normalized)
  ) {
    throw new AppError(422, "COMMON_PASSWORD", "La contraseña es demasiado común.");
  }
}
