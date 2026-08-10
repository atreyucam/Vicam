import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLocalStoragePreservingOfflineChannel,
  getOfflineChannelId,
  offlineChannelStorageKey,
} from "./channel";

describe("canal técnico entre pestañas", () => {
  beforeEach(() => localStorage.clear());

  it("restaura el identificador recordado aunque otra pestaña lo borre durante la purga", () => {
    localStorage.setItem(offlineChannelStorageKey, "canal-compartido");
    expect(getOfflineChannelId()).toBe("canal-compartido");

    localStorage.removeItem(offlineChannelStorageKey);
    localStorage.setItem("vicam.sensible", "dato");
    clearLocalStoragePreservingOfflineChannel();

    expect(Object.keys(localStorage)).toEqual([offlineChannelStorageKey]);
    expect(localStorage.getItem(offlineChannelStorageKey)).toBe("canal-compartido");
  });
});
