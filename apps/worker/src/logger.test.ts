import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("worker logger", () => {
  it("redacts job payloads and secrets", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = createLogger("info", destination);

    logger.info({ password: "secret-password", job: { id: "job-1", data: "document-content" } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).not.toContain("secret-password");
    expect(output).not.toContain("document-content");
    expect(output).toContain("job-1");
  });
});
