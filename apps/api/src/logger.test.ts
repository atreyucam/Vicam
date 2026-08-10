import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("safe logger", () => {
  it("redacts authentication material", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = createLogger("info", destination);

    logger.info({
      password: "secret-password",
      temporaryPassword: "one-time-secret",
      token: "secret-token",
      req: { headers: { authorization: "Bearer secret" } },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).not.toContain("secret-password");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("one-time-secret");
    expect(output).not.toContain("Bearer secret");
  });
});
