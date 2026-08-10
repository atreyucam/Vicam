import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";

import {
  commercialAccountSchema,
  commercialAccountsPageSchema,
  commercialContactSchema,
  createCommercialAccountRequestSchema,
  createCommercialContactRequestSchema,
  accountsQuerySchema,
  commercialAccountSummarySchema,
  updateCommercialAccountRequestSchema,
  updateCommercialContactRequestSchema,
} from "./accounts.js";
import { auditPageSchema, auditQuerySchema } from "./audit.js";
import {
  activeFruitsSchema,
  createFruitRequestSchema,
  fruitSchema,
  fruitsQuerySchema,
  updateFruitRequestSchema,
} from "./catalogs.js";
import {
  appSettingsSchema,
  confirmImportRequestSchema,
  createDocumentCategoryRequestSchema,
  createReportExportRequestSchema,
  documentCategorySchema,
  documentSchema,
  documentsPageSchema,
  documentsQuerySchema,
  importBatchDetailSchema,
  importBatchSchema,
  notificationSchema,
  notificationsPageSchema,
  notificationsQuerySchema,
  pushSubscriptionRequestSchema,
  reportExportSchema,
  reportExportsPageSchema,
  updateAppSettingsRequestSchema,
  updateDocumentCategoryRequestSchema,
} from "./phase3.js";
import {
  authenticatedUserSchema,
  changePasswordRequestSchema,
  csrfHeaderSchema,
  loginRequestSchema,
  sessionTokenResponseSchema,
  userSessionSchema,
} from "./auth.js";
import { errorEnvelopeSchema } from "./common.js";
import { liveHealthSchema, readyHealthSchema } from "./health.js";
import { paginationQuerySchema } from "./pagination.js";
import {
  createOfflineGrantRequestSchema,
  deviceSchema,
  offlineGrantSchema,
  offlineGrantHeaderSchema,
  registerDeviceRequestSchema,
  resolveSyncConflictRequestSchema,
  syncConflictSchema,
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
  syncStatusSchema,
} from "./sync.js";
import {
  completeTaskRequestSchema,
  cancelTaskRequestSchema,
  createTaskRequestSchema,
  taskSchema,
  taskDetailSchema,
  tasksQuerySchema,
  tasksPageSchema,
  updateTaskRequestSchema,
} from "./tasks.js";
import {
  createUserRequestSchema,
  resetUserPasswordRequestSchema,
  temporaryCredentialSchema,
  updateUserRequestSchema,
  userSchema,
  usersQuerySchema,
  usersPageSchema,
} from "./users.js";
import {
  cancelVisitRequestSchema,
  completeVisitRequestSchema,
  createVisitRequestSchema,
  rescheduleVisitRequestSchema,
  updateVisitRequestSchema,
  visitSchema,
  visitDetailSchema,
  visitsQuerySchema,
  visitsPageSchema,
} from "./visits.js";
import { z } from "./zod.js";

const registry = new OpenAPIRegistry();
const idParams = z.object({ id: z.uuid() });
const contactParams = z.object({ id: z.uuid(), contactId: z.uuid() });
const bearerSecurity = [{ bearerAuth: [] }];
const idempotencyHeaders = z.object({
  "idempotency-key": z.string().min(1).max(200).optional(),
});

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

for (const [name, schema] of [
  ["ErrorEnvelope", errorEnvelopeSchema],
  ["AuthenticatedUser", authenticatedUserSchema],
  ["SessionTokenResponse", sessionTokenResponseSchema],
  ["User", userSchema],
  ["CommercialAccount", commercialAccountSchema],
  ["CommercialContact", commercialContactSchema],
  ["CommercialAccountSummary", commercialAccountSummarySchema],
  ["Visit", visitSchema],
  ["VisitDetail", visitDetailSchema],
  ["Task", taskSchema],
  ["TaskDetail", taskDetailSchema],
  ["LiveHealth", liveHealthSchema],
  ["ReadyHealth", readyHealthSchema],
] as const) {
  registry.register(name, schema);
}

const errors = {
  401: {
    description: "Authentication required or session expired.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
  403: {
    description: "Insufficient role or ownership.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
  404: {
    description: "Resource does not exist or is not visible to the caller.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
  409: {
    description: "Version or state conflict.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
  422: {
    description: "Business validation failed.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
  503: {
    description: "Service unavailable or feature disabled by an operational rollback flag.",
    content: { "application/json": { schema: errorEnvelopeSchema } },
  },
} as const;

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  request: { body: { content: { "application/json": { schema: loginRequestSchema } } } },
  responses: {
    200: {
      description: "Authenticated online session; refresh cookie is set separately.",
      content: { "application/json": { schema: sessionTokenResponseSchema } },
    },
    401: errors[401],
    429: {
      description: "Progressive login delay is active.",
      content: { "application/json": { schema: errorEnvelopeSchema } },
    },
  },
});

for (const [path, description] of [
  ["/auth/refresh", "Rotate refresh token and issue a new access token."],
  ["/auth/logout", "Revoke the current session and clear its refresh cookie."],
] as const) {
  registry.registerPath({
    method: "post",
    path,
    tags: ["Auth"],
    request: {
      headers:
        path === "/auth/logout" ? csrfHeaderSchema.merge(idempotencyHeaders) : csrfHeaderSchema,
    },
    responses:
      path === "/auth/refresh"
        ? {
            200: {
              description,
              content: { "application/json": { schema: sessionTokenResponseSchema } },
            },
            401: errors[401],
            403: errors[403],
          }
        : { 204: { description }, 401: errors[401], 403: errors[403] },
  });
}

registry.registerPath({
  method: "get",
  path: "/fruits",
  tags: ["Catalogs"],
  security: bearerSecurity,
  request: { query: fruitsQuerySchema },
  responses: {
    200: {
      description: "Active fruits by default; Manager may include inactive entries.",
      content: {
        "application/json": {
          schema: z.union([activeFruitsSchema, z.array(fruitSchema)]),
        },
      },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/fruits",
  tags: ["Catalogs"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createFruitRequestSchema } } },
  },
  responses: {
    201: {
      description: "Fruit created.",
      content: { "application/json": { schema: fruitSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "patch",
  path: "/fruits/{id}",
  tags: ["Catalogs"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: updateFruitRequestSchema } } },
  },
  responses: {
    200: {
      description: "Fruit updated.",
      content: { "application/json": { schema: fruitSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "delete",
  path: "/push-subscriptions/{id}",
  tags: ["Notifications"],
  security: bearerSecurity,
  request: { params: idParams, headers: idempotencyHeaders },
  responses: {
    200: {
      description: "Current device push subscription removed.",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  security: bearerSecurity,
  responses: {
    200: {
      description: "Current authenticated user.",
      content: { "application/json": { schema: authenticatedUserSchema } },
    },
    401: errors[401],
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/sessions",
  tags: ["Auth"],
  security: bearerSecurity,
  responses: {
    200: {
      description: "Active sessions for the current user.",
      content: { "application/json": { schema: z.array(userSessionSchema) } },
    },
    401: errors[401],
  },
});

registry.registerPath({
  method: "delete",
  path: "/auth/sessions/{id}",
  tags: ["Auth"],
  security: bearerSecurity,
  request: { params: idParams, headers: idempotencyHeaders },
  responses: { 204: { description: "Session revoked." }, 401: errors[401], 404: errors[404] },
});

registry.registerPath({
  method: "post",
  path: "/auth/change-password",
  tags: ["Auth"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: changePasswordRequestSchema } } },
  },
  responses: { 204: { description: "Password changed." }, ...errors },
});

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  security: bearerSecurity,
  request: { query: usersQuerySchema },
  responses: {
    200: {
      description: "Manager-only user list.",
      content: { "application/json": { schema: usersPageSchema } },
    },
    401: errors[401],
    403: errors[403],
  },
});
registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createUserRequestSchema } } },
  },
  responses: {
    201: {
      description: "User created; the temporary password is returned once.",
      content: { "application/json": { schema: temporaryCredentialSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/users/{id}/reset-password",
  tags: ["Users"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: resetUserPasswordRequestSchema } } },
  },
  responses: {
    200: {
      description: "Manager reset for a Supervisor; the temporary password is returned once.",
      content: { "application/json": { schema: temporaryCredentialSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: updateUserRequestSchema } } },
  },
  responses: {
    200: { description: "User updated.", content: { "application/json": { schema: userSchema } } },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/commercial-accounts",
  tags: ["Accounts"],
  security: bearerSecurity,
  request: { query: accountsQuerySchema },
  responses: {
    200: {
      description: "Accounts visible to the current role and owner.",
      content: { "application/json": { schema: commercialAccountsPageSchema } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/commercial-accounts",
  tags: ["Accounts"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createCommercialAccountRequestSchema } } },
  },
  responses: {
    201: {
      description: "Commercial account created.",
      content: { "application/json": { schema: commercialAccountSchema } },
    },
    ...errors,
  },
});
for (const method of ["get", "patch"] as const) {
  registry.registerPath({
    method,
    path: "/commercial-accounts/{id}",
    tags: ["Accounts"],
    security: bearerSecurity,
    request:
      method === "patch"
        ? {
            params: idParams,
            headers: idempotencyHeaders,
            body: {
              content: { "application/json": { schema: updateCommercialAccountRequestSchema } },
            },
          }
        : { params: idParams },
    responses: {
      200: {
        description: method === "get" ? "Visible commercial account." : "Account updated.",
        content: { "application/json": { schema: commercialAccountSchema } },
      },
      ...errors,
    },
  });
}

for (const method of ["get", "post"] as const) {
  registry.registerPath({
    method,
    path: "/commercial-accounts/{id}/contacts",
    tags: ["Contacts"],
    security: bearerSecurity,
    request:
      method === "post"
        ? {
            params: idParams,
            headers: idempotencyHeaders,
            body: {
              content: { "application/json": { schema: createCommercialContactRequestSchema } },
            },
          }
        : { params: idParams },
    responses: {
      [method === "post" ? 201 : 200]: {
        description: method === "post" ? "Contact created." : "Visible account contacts.",
        content: {
          "application/json": {
            schema: method === "post" ? commercialContactSchema : z.array(commercialContactSchema),
          },
        },
      },
      ...errors,
    },
  });
}
registry.registerPath({
  method: "patch",
  path: "/commercial-accounts/{id}/contacts/{contactId}",
  tags: ["Contacts"],
  security: bearerSecurity,
  request: {
    params: contactParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: updateCommercialContactRequestSchema } } },
  },
  responses: {
    200: {
      description: "Contact updated atomically.",
      content: { "application/json": { schema: commercialContactSchema } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/commercial-accounts/{id}/commercial-summary",
  tags: ["Accounts"],
  security: bearerSecurity,
  request: { params: idParams },
  responses: {
    200: {
      description: "Commercial summary and recent activity for a visible account.",
      content: { "application/json": { schema: commercialAccountSummarySchema } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/visits",
  tags: ["Visits"],
  security: bearerSecurity,
  request: { query: visitsQuerySchema },
  responses: {
    200: {
      description: "Visible visits.",
      content: { "application/json": { schema: visitsPageSchema } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/visits",
  tags: ["Visits"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createVisitRequestSchema } } },
  },
  responses: {
    201: {
      description: "Visit created.",
      content: { "application/json": { schema: visitSchema } },
    },
    ...errors,
  },
});
for (const method of ["get", "patch"] as const) {
  registry.registerPath({
    method,
    path: "/visits/{id}",
    tags: ["Visits"],
    security: bearerSecurity,
    request:
      method === "patch"
        ? {
            params: idParams,
            headers: idempotencyHeaders,
            body: { content: { "application/json": { schema: updateVisitRequestSchema } } },
          }
        : { params: idParams },
    responses: {
      200: {
        description: "Visible visit.",
        content: {
          "application/json": { schema: method === "get" ? visitDetailSchema : visitSchema },
        },
      },
      ...errors,
    },
  });
}
for (const [action, schema, description] of [
  ["reschedule", rescheduleVisitRequestSchema, "Visit rescheduled with immutable history."],
  ["cancel", cancelVisitRequestSchema, "Visit cancelled."],
  ["complete", completeVisitRequestSchema, "Visit completed."],
] as const) {
  registry.registerPath({
    method: "post",
    path: `/visits/{id}/${action}`,
    tags: ["Visits"],
    security: bearerSecurity,
    request: {
      params: idParams,
      headers: idempotencyHeaders,
      body: { content: { "application/json": { schema } } },
    },
    responses: {
      200: { description, content: { "application/json": { schema: visitSchema } } },
      ...errors,
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/tasks",
  tags: ["Tasks"],
  security: bearerSecurity,
  request: { query: tasksQuerySchema },
  responses: {
    200: {
      description: "Visible tasks.",
      content: { "application/json": { schema: tasksPageSchema } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/tasks",
  tags: ["Tasks"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createTaskRequestSchema } } },
  },
  responses: {
    201: { description: "Task created.", content: { "application/json": { schema: taskSchema } } },
    ...errors,
  },
});
for (const method of ["get", "patch"] as const) {
  registry.registerPath({
    method,
    path: "/tasks/{id}",
    tags: ["Tasks"],
    security: bearerSecurity,
    request:
      method === "patch"
        ? {
            params: idParams,
            headers: idempotencyHeaders,
            body: { content: { "application/json": { schema: updateTaskRequestSchema } } },
          }
        : { params: idParams },
    responses: {
      200: {
        description: "Visible task.",
        content: {
          "application/json": { schema: method === "get" ? taskDetailSchema : taskSchema },
        },
      },
      ...errors,
    },
  });
}
registry.registerPath({
  method: "post",
  path: "/tasks/{id}/complete",
  tags: ["Tasks"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: completeTaskRequestSchema } } },
  },
  responses: {
    200: {
      description: "Task completed.",
      content: { "application/json": { schema: taskSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/tasks/{id}/cancel",
  tags: ["Tasks"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: cancelTaskRequestSchema } } },
  },
  responses: {
    200: {
      description: "Task cancelled with a required reason.",
      content: { "application/json": { schema: taskSchema } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/audit",
  tags: ["Audit"],
  security: bearerSecurity,
  request: { query: auditQuerySchema },
  responses: {
    200: {
      description: "Manager-only safe audit log.",
      content: { "application/json": { schema: auditPageSchema } },
    },
    401: errors[401],
    403: errors[403],
  },
});

registry.registerPath({
  method: "post",
  path: "/devices",
  tags: ["Sync"],
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: registerDeviceRequestSchema } } } },
  responses: {
    201: {
      description: "Device registered.",
      content: { "application/json": { schema: deviceSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "delete",
  path: "/devices/{id}",
  tags: ["Sync"],
  security: bearerSecurity,
  request: { params: idParams },
  responses: { 204: { description: "Device revoked." }, ...errors },
});
registry.registerPath({
  method: "post",
  path: "/auth/offline-grants",
  tags: ["Sync"],
  security: bearerSecurity,
  request: {
    body: { content: { "application/json": { schema: createOfflineGrantRequestSchema } } },
  },
  responses: {
    201: {
      description: "Offline grant valid for no more than 72 hours.",
      content: { "application/json": { schema: offlineGrantSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/sync/push",
  tags: ["Sync"],
  security: bearerSecurity,
  request: {
    headers: offlineGrantHeaderSchema,
    body: { content: { "application/json": { schema: syncPushRequestSchema } } },
  },
  responses: {
    200: {
      description: "Per-operation idempotent results.",
      content: { "application/json": { schema: syncPushResponseSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/sync/pull",
  tags: ["Sync"],
  security: bearerSecurity,
  request: { headers: offlineGrantHeaderSchema, query: syncPullQuerySchema },
  responses: {
    200: {
      description: "Incremental authorized changes.",
      content: { "application/json": { schema: syncPullResponseSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/sync/status",
  tags: ["Sync"],
  security: bearerSecurity,
  request: { query: z.object({ deviceId: z.uuid() }) },
  responses: {
    200: {
      description: "Device sync status.",
      content: { "application/json": { schema: syncStatusSchema } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/sync/conflicts",
  tags: ["Sync"],
  security: bearerSecurity,
  responses: {
    200: {
      description:
        "Open conflicts for Manager; a Supervisor receives only their own conflicts, with ACCESS_REVOKED snapshots redacted.",
      content: { "application/json": { schema: z.array(syncConflictSchema) } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/sync/conflicts/{id}/resolve",
  tags: ["Sync"],
  security: bearerSecurity,
  request: {
    params: idParams,
    body: { content: { "application/json": { schema: resolveSyncConflictRequestSchema } } },
  },
  responses: {
    200: {
      description: "Manager conflict resolution.",
      content: { "application/json": { schema: syncConflictSchema } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: "get",
  path: "/health/live",
  tags: ["Health"],
  responses: {
    200: {
      description: "The API process is alive.",
      content: { "application/json": { schema: liveHealthSchema } },
    },
  },
});
registry.registerPath({
  method: "get",
  path: "/health/ready",
  tags: ["Health"],
  responses: {
    200: {
      description: "The API and database are ready.",
      content: { "application/json": { schema: readyHealthSchema } },
    },
    503: {
      description: "A critical dependency is unavailable.",
      content: { "application/json": { schema: readyHealthSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/documents",
  tags: ["Documents"],
  security: bearerSecurity,
  request: { query: documentsQuerySchema },
  responses: {
    200: {
      description: "Authorized document metadata.",
      content: { "application/json": { schema: documentsPageSchema } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/commercial-accounts/{id}/documents",
  tags: ["Documents"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any(),
            categoryId: z.uuid(),
            visitId: z.uuid().optional(),
            taskId: z.uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "Document accepted into quarantine.",
      content: { "application/json": { schema: documentSchema } },
    },
    401: errors[401],
    403: errors[403],
    422: errors[422],
  },
});
for (const [path, method, description] of [
  ["/documents/{id}/download", "get", "Authorized binary document download."],
  ["/documents/{id}", "delete", "Move document to the 30-day trash."],
  ["/documents/{id}/restore", "post", "Restore a trashed document."],
] as const)
  registry.registerPath({
    method,
    path,
    tags: ["Documents"],
    security: bearerSecurity,
    request: { params: idParams, ...(method === "get" ? {} : { headers: idempotencyHeaders }) },
    responses:
      method === "get"
        ? {
            200: { description, content: { "application/octet-stream": { schema: z.any() } } },
            401: errors[401],
            403: errors[403],
          }
        : {
            200: { description, content: { "application/json": { schema: documentSchema } } },
            401: errors[401],
            403: errors[403],
          },
  });

registry.registerPath({
  method: "get",
  path: "/document-categories",
  tags: ["Catalogs"],
  security: bearerSecurity,
  responses: {
    200: {
      description: "Document categories.",
      content: { "application/json": { schema: z.array(documentCategorySchema) } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/document-categories",
  tags: ["Catalogs"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createDocumentCategoryRequestSchema } } },
  },
  responses: {
    201: {
      description: "Category created.",
      content: { "application/json": { schema: documentCategorySchema } },
    },
    403: errors[403],
    422: errors[422],
  },
});
registry.registerPath({
  method: "patch",
  path: "/document-categories/{id}",
  tags: ["Catalogs"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: updateDocumentCategoryRequestSchema } } },
  },
  responses: {
    200: {
      description: "Category updated.",
      content: { "application/json": { schema: documentCategorySchema } },
    },
    403: errors[403],
    409: errors[409],
  },
});

registry.registerPath({
  method: "get",
  path: "/notifications",
  tags: ["Notifications"],
  security: bearerSecurity,
  request: { query: notificationsQuerySchema },
  responses: {
    200: {
      description: "Notifications in the current user's scope.",
      content: { "application/json": { schema: notificationsPageSchema } },
    },
    401: errors[401],
  },
});
for (const path of ["/notifications/read-all", "/notifications/{id}/read"] as const)
  registry.registerPath({
    method: "post",
    path,
    tags: ["Notifications"],
    security: bearerSecurity,
    request: {
      ...(path.includes("{id}") ? { params: idParams } : {}),
      headers: idempotencyHeaders,
    },
    responses: {
      200: {
        description: "Notifications marked as read.",
        content: {
          "application/json": {
            schema: path.includes("{id}")
              ? notificationSchema
              : z.object({ updated: z.number().int().nonnegative() }),
          },
        },
      },
      401: errors[401],
    },
  });
registry.registerPath({
  method: "post",
  path: "/push-subscriptions",
  tags: ["Notifications"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: pushSubscriptionRequestSchema } } },
  },
  responses: {
    201: {
      description: "Push subscription stored.",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    422: errors[422],
  },
});

registry.registerPath({
  method: "get",
  path: "/reports/exports",
  tags: ["Reports"],
  security: bearerSecurity,
  request: { query: paginationQuerySchema },
  responses: {
    200: {
      description: "Report exports visible to the requester.",
      content: { "application/json": { schema: reportExportsPageSchema } },
    },
    401: errors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/reports/exports",
  tags: ["Reports"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: createReportExportRequestSchema } } },
  },
  responses: {
    202: {
      description: "Export queued.",
      content: { "application/json": { schema: reportExportSchema } },
    },
    403: errors[403],
  },
});
registry.registerPath({
  method: "get",
  path: "/reports/exports/{id}/download",
  tags: ["Reports"],
  security: bearerSecurity,
  request: { params: idParams },
  responses: {
    200: {
      description: "Authorized export download.",
      content: { "application/octet-stream": { schema: z.any() } },
    },
    403: errors[403],
    404: errors[404],
  },
});

registry.registerPath({
  method: "post",
  path: "/imports",
  tags: ["Imports"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "multipart/form-data": { schema: z.object({ file: z.any() }) } } },
  },
  responses: {
    202: {
      description: "Import validation queued.",
      content: { "application/json": { schema: importBatchSchema } },
    },
    403: errors[403],
    422: errors[422],
  },
});
registry.registerPath({
  method: "get",
  path: "/imports/{id}",
  tags: ["Imports"],
  security: bearerSecurity,
  request: { params: idParams },
  responses: {
    200: {
      description: "Import preview and rows.",
      content: { "application/json": { schema: importBatchDetailSchema } },
    },
    403: errors[403],
  },
});
registry.registerPath({
  method: "get",
  path: "/imports/{id}/errors",
  tags: ["Imports"],
  security: bearerSecurity,
  request: { params: idParams },
  responses: {
    200: {
      description: "Authorized CSV containing validation errors by import row.",
      content: { "text/csv": { schema: z.string() } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/imports/{id}/confirm",
  tags: ["Imports"],
  security: bearerSecurity,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: confirmImportRequestSchema } } },
  },
  responses: {
    202: {
      description: "Idempotent import commit queued.",
      content: { "application/json": { schema: importBatchSchema } },
    },
    403: errors[403],
    409: errors[409],
  },
});

registry.registerPath({
  method: "get",
  path: "/settings",
  tags: ["Settings"],
  security: bearerSecurity,
  responses: {
    200: {
      description: "Typed application settings.",
      content: { "application/json": { schema: appSettingsSchema } },
    },
    403: errors[403],
  },
});
registry.registerPath({
  method: "patch",
  path: "/settings",
  tags: ["Settings"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaders,
    body: { content: { "application/json": { schema: updateAppSettingsRequestSchema } } },
  },
  responses: {
    200: {
      description: "Settings updated and audited.",
      content: { "application/json": { schema: appSettingsSchema } },
    },
    403: errors[403],
    409: errors[409],
  },
});

export function createOpenApiDocument(): OpenAPIObject {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "VICAM API",
      version: "0.3.0",
      description: "Operational contracts for the VICAM modular monolith.",
    },
    servers: [{ url: "/api/v1" }],
  });
}
