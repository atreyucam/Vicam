import type { CipherEnvelope } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const pbkdf2Iterations = 310_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function additionalData(scope: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`vicam:${scope}:schema:1`);
}

export function randomSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveKek(pin: string, salt: string, iterations = pbkdf2Iterations) {
  if (!/^\d{6}$/.test(pin)) throw new Error("El PIN debe tener seis dígitos.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generateDek(): Promise<{
  persistedBytes: ArrayBuffer;
  runtimeKey: CryptoKey;
}> {
  const temporary = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const persistedBytes = await crypto.subtle.exportKey("raw", temporary);
  const runtimeKey = await crypto.subtle.importKey(
    "raw",
    persistedBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { persistedBytes, runtimeKey };
}

export async function importRuntimeDek(bytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(
  key: CryptoKey,
  bytes: BufferSource,
  scope: string,
): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(scope) },
    key,
    bytes,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    schemaVersion: 1,
  };
}

export async function decryptBytes(
  key: CryptoKey,
  envelope: CipherEnvelope,
  scope: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: additionalData(scope) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
}

export async function encryptJson(key: CryptoKey, value: unknown, scope: string) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)), scope);
}

export async function decryptJson<T>(key: CryptoKey, value: CipherEnvelope, scope: string) {
  return JSON.parse(decoder.decode(await decryptBytes(key, value, scope))) as T;
}
