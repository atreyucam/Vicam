import type { AuthenticatedUser } from "@vicam/contracts";
import Dexie from "dexie";
import { maximumPinAttempts, offlineDatabaseName, offlineEnabled } from "./config";
import {
  decryptBytes,
  decryptJson,
  deriveKek,
  encryptBytes,
  encryptJson,
  generateDek,
  importRuntimeDek,
  pbkdf2Iterations,
  randomSalt,
} from "./crypto";
import { closeOfflineDb, offlineDb } from "./db";
import { clearLocalStoragePreservingOfflineChannel } from "./channel";
import { notifyOfflineChange, notifyOfflinePurge, onOfflinePurge, withOfflineLock } from "./locks";
import type { OfflineAuthRecord } from "./types";

let runtimeDek: CryptoKey | null = null;

export function isOfflineVaultUnlocked(): boolean {
  return runtimeDek !== null;
}

export function getRuntimeDek(): CryptoKey {
  if (!runtimeDek) throw new Error("Los datos offline están bloqueados.");
  return runtimeDek;
}

export async function getDecryptedOfflineGrant(now = Date.now()): Promise<string> {
  const auth = await offlineDb().auth.get("authorization");
  if (!auth || !runtimeDek) throw new Error("Los datos offline están bloqueados.");
  if (Date.parse(auth.grantExpiresAt) <= now) {
    await purgeOfflineData("expired");
    throw new Error("La autorización offline venció. Conéctate para ingresar nuevamente.");
  }
  return decryptJson<string>(runtimeDek, auth.grantToken, "auth:grant");
}

export function lockOfflineVault(): void {
  runtimeDek = null;
  notifyOfflineChange("locked");
}

export async function hasOfflineAuthorization(): Promise<boolean> {
  if (!offlineEnabled) return false;
  return Boolean(await offlineDb().auth.get("authorization"));
}

export async function enrollOfflineDevice(input: {
  deviceId: string;
  expiresAt: string;
  grantToken: string;
  issuedAt: string;
  pin: string;
  user: AuthenticatedUser;
}): Promise<void> {
  if (!/^\d{6}$/.test(input.pin)) throw new Error("El PIN debe tener seis dígitos.");
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt - issuedAt > 72 * 60 * 60 * 1000
  )
    throw new Error("La autorización offline excede la vigencia máxima de 72 horas.");
  await withOfflineLock(async () => {
    const { persistedBytes, runtimeKey } = await generateDek();
    const salt = randomSalt();
    const kek = await deriveKek(input.pin, salt);
    const record: OfflineAuthRecord = {
      key: "authorization",
      cryptoVersion: 1,
      deviceId: input.deviceId,
      grantExpiresAt: input.expiresAt,
      grantIssuedAt: input.issuedAt,
      grantToken: await encryptJson(runtimeKey, input.grantToken, "auth:grant"),
      kdf: { algorithm: "PBKDF2-SHA-256", iterations: pbkdf2Iterations, salt },
      pinAttempts: 0,
      profile: await encryptJson(runtimeKey, input.user, "auth:profile"),
      wrappedDek: await encryptBytes(kek, persistedBytes, "auth:dek"),
    };
    await offlineDb().auth.put(record);
    runtimeDek = runtimeKey;
    notifyOfflineChange("enrolled");
  });
}

export async function unlockOfflineVault(
  pin: string,
  now = Date.now(),
): Promise<AuthenticatedUser> {
  if (!/^\d{6}$/.test(pin)) throw new Error("El PIN debe tener seis dígitos.");
  return withOfflineLock(async () => {
    const db = offlineDb();
    const auth = await db.auth.get("authorization");
    if (!auth) throw new Error("Este dispositivo no tiene acceso offline configurado.");
    if (Date.parse(auth.grantExpiresAt) <= now) {
      await purgeOfflineData("expired");
      throw new Error("La autorización offline venció. Conéctate para ingresar nuevamente.");
    }
    try {
      const kek = await deriveKek(pin, auth.kdf.salt, auth.kdf.iterations);
      const rawDek = await decryptBytes(kek, auth.wrappedDek, "auth:dek");
      runtimeDek = await importRuntimeDek(rawDek);
      const profile = await decryptJson<AuthenticatedUser>(
        runtimeDek,
        auth.profile,
        "auth:profile",
      );
      await db.auth.update("authorization", { pinAttempts: 0 });
      notifyOfflineChange("unlocked");
      return profile;
    } catch {
      runtimeDek = null;
      const attempts = auth.pinAttempts + 1;
      if (attempts >= maximumPinAttempts) {
        await purgeOfflineData("pin-attempts");
        throw new Error("Se alcanzaron cinco intentos. Los datos locales fueron eliminados.");
      }
      await db.auth.update("authorization", { pinAttempts: attempts });
      throw new Error(`PIN incorrecto. Quedan ${maximumPinAttempts - attempts} intentos.`);
    }
  });
}

export async function getOfflineAuthorization(): Promise<OfflineAuthRecord | undefined> {
  return offlineEnabled ? offlineDb().auth.get("authorization") : undefined;
}

export async function purgeAccountOwnership(accountIds: string[]): Promise<void> {
  if (!offlineEnabled || accountIds.length === 0) return;
  const db = offlineDb();
  await db.transaction("rw", db.entities, db.operations, async () => {
    await db.entities.where("accountId").anyOf(accountIds).delete();
    await db.entities.bulkDelete(accountIds.map((accountId) => `ACCOUNT:${accountId}`));
    const operations = await db.operations.toArray();
    const related = operations
      .filter(
        (operation) =>
          accountIds.includes(operation.accountId) ||
          (operation.entityType === "ACCOUNT" && accountIds.includes(operation.entityId)),
      )
      .map((operation) => operation.clientOperationId);
    await db.operations.bulkDelete(related);
  });
  notifyOfflineChange("ownership-purged");
}

async function clearOfflineData(reason: string, emitSessionPurge = true): Promise<void> {
  runtimeDek = null;
  closeOfflineDb();
  await Dexie.delete(offlineDatabaseName).catch(() => undefined);
  try {
    clearLocalStoragePreservingOfflineChannel();
    sessionStorage.clear();
  } catch {
    /* almacenamiento no disponible */
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if (emitSessionPurge)
    window.dispatchEvent(new CustomEvent("vicam:offline-purged", { detail: reason }));
}

export async function purgeOfflineData(reason: string): Promise<void> {
  notifyOfflinePurge(reason);
  await clearOfflineData(reason, reason !== "pin-attempts");
}

onOfflinePurge((reason) => {
  void clearOfflineData(reason);
});

window.addEventListener("vicam:offline-purged", () => {
  runtimeDek = null;
});
