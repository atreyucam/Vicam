import { registerSW } from "virtual:pwa-register";
import { pwaUpdateReadyEvent, setPwaShellUpdater } from "./pwaUpdateState";

export function registerPwaShell(): void {
  const updater = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event(pwaUpdateReadyEvent));
    },
  });
  setPwaShellUpdater(updater);
}
