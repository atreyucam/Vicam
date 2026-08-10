import { describe, expect, it } from "vitest";

import { readDatabaseConfig } from "./config.js";

describe("database configuration", () => {
  it("validates and maps safe pool settings", () => {
    expect(
      readDatabaseConfig({
        DATABASE_URL: "postgresql://vicam:vicam@localhost:5432/vicam",
        DATABASE_POOL_MAX: "7",
        DATABASE_SSL: "disable",
      }),
    ).toMatchObject({ max: 7, ssl: false });
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() => readDatabaseConfig({ DATABASE_URL: "https://example.com/database" })).toThrow();
  });
});
