export const offlineChannelStorageKey = "vicam.offline-channel";

let rememberedChannelId: string | undefined;

export function getOfflineChannelId(): string {
  try {
    const stored = localStorage.getItem(offlineChannelStorageKey);
    if (stored) rememberedChannelId = stored;
    rememberedChannelId ??= crypto.randomUUID();
    localStorage.setItem(offlineChannelStorageKey, rememberedChannelId);
    return rememberedChannelId;
  } catch {
    return "unavailable-storage";
  }
}

export function clearLocalStoragePreservingOfflineChannel(): void {
  const channelId = getOfflineChannelId();
  localStorage.clear();
  if (channelId !== "unavailable-storage")
    localStorage.setItem(offlineChannelStorageKey, channelId);
}
