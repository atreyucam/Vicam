export const pwaUpdateReadyEvent = "vicam:pwa-update-ready";

let applyUpdate: (() => Promise<void>) | undefined;

export function setPwaShellUpdater(updater: (reloadPage?: boolean) => Promise<void>): void {
  applyUpdate = () => updater(true);
}

export async function applyPwaShellUpdate(): Promise<void> {
  await applyUpdate?.();
}

export async function applyPwaShellUpdateWhenSafe(waitForIdle: () => Promise<void>): Promise<void> {
  await waitForIdle();
  await applyPwaShellUpdate();
}
