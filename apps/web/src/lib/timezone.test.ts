import { describe, expect, it } from "vitest";
import { formatInstantInZone, toDateTimeLocalValue, zonedDateTimeToIso } from "./timezone";

describe("helpers de zona horaria IANA", () => {
  it("interpreta y formatea hora civil de America/Guayaquil", () => {
    const instant = zonedDateTimeToIso("2026-07-22T15:30", "America/Guayaquil");
    expect(instant).toBe("2026-07-22T20:30:00.000Z");
    expect(toDateTimeLocalValue(instant, "America/Guayaquil")).toBe("2026-07-22T15:30");
    expect(
      formatInstantInZone(instant, "America/Guayaquil", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toContain("15:30");
  });

  it("respeta offsets de verano e invierno en una zona DST", () => {
    expect(zonedDateTimeToIso("2026-07-22T15:30", "America/New_York")).toBe(
      "2026-07-22T19:30:00.000Z",
    );
    expect(zonedDateTimeToIso("2026-01-22T15:30", "America/New_York")).toBe(
      "2026-01-22T20:30:00.000Z",
    );
  });

  it("rechaza una hora inexistente durante el salto DST", () => {
    expect(() => zonedDateTimeToIso("2026-03-08T02:30", "America/New_York")).toThrow("no existe");
  });
});
