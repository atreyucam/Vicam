import { argon2id, hash, needsRehash, verify, type HashOptions } from "argon2";

export const passwordHashOptions: HashOptions = {
  type: argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordHashOptions);
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(encodedHash: string): boolean {
  try {
    return needsRehash(encodedHash, passwordHashOptions);
  } catch {
    return true;
  }
}
