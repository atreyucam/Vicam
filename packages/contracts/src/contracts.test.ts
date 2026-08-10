import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "./openapi-document.js";

describe("OpenAPI document", () => {
  it("uses OpenAPI 3.1 and exposes the complete online vertical flow", () => {
    const document = createOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/health/live");
    expect(document.paths).toHaveProperty("/health/ready");
    expect(document.paths).toHaveProperty("/auth/login");
    expect(document.paths).toHaveProperty("/auth/refresh");
    expect(document.paths).toHaveProperty("/auth/logout");
    expect(document.paths).toHaveProperty("/auth/me");
    expect(document.paths).toHaveProperty("/users");
    expect(document.paths).toHaveProperty("/commercial-accounts");
    expect(document.paths).toHaveProperty("/commercial-accounts/{id}/contacts");
    expect(document.paths).toHaveProperty("/commercial-accounts/{id}/commercial-summary");
    expect(document.paths).toHaveProperty("/visits");
    expect(document.paths).toHaveProperty("/visits/{id}");
    expect(document.paths).toHaveProperty("/visits/{id}/reschedule");
    expect(document.paths).toHaveProperty("/visits/{id}/cancel");
    expect(document.paths).toHaveProperty("/visits/{id}/complete");
    expect(document.paths).toHaveProperty("/tasks");
    expect(document.paths).toHaveProperty("/tasks/{id}");
    expect(document.paths).toHaveProperty("/tasks/{id}/complete");
    expect(document.paths).toHaveProperty("/audit");
    expect(document.paths).toHaveProperty("/fruits");
    expect(document.paths).toHaveProperty("/auth/offline-grants");
    expect(document.paths).toHaveProperty("/sync/push");
    expect(document.paths).toHaveProperty("/sync/pull");
    expect(document.paths).toHaveProperty("/sync/conflicts/{id}/resolve");
  });
});
