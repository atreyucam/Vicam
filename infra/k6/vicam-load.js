/* global __ENV, __ITER, __VU */

import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.K6_BASE_URL || "http://host.docker.internal:8080").replace(/\/$/, "");
const requestOrigin = (__ENV.K6_ORIGIN || baseUrl).replace(/\/$/, "");
const username = __ENV.K6_USERNAME;
const password = __ENV.K6_PASSWORD;
const duration = __ENV.VICAM_LOAD_DURATION || "5m";
const virtualUsers = Number(__ENV.VICAM_LOAD_VUS || 20);
const thinkTimeSeconds = Number(__ENV.VICAM_LOAD_THINK_TIME_SECONDS || 1.5);
const mutatingSync = __ENV.K6_MUTATING_SYNC === "true";

const businessErrors = new Rate("business_errors");
const crudDuration = new Trend("crud_duration", true);
const searchDuration = new Trend("search_duration", true);
const syncBatchDuration = new Trend("sync_batch_duration", true);

const scenarios = {
  common_reads: {
    executor: "constant-vus",
    vus: virtualUsers,
    duration,
    exec: "commonReads",
  },
};
if (mutatingSync) {
  scenarios.sync_100_operations = {
    executor: "shared-iterations",
    vus: 1,
    iterations: 1,
    maxDuration: "2m",
    startTime: "5s",
    exec: "syncOneHundredOperations",
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    business_errors: ["rate<0.01"],
    crud_duration: ["p(95)<400"],
    search_duration: ["p(95)<700"],
    sync_batch_duration: ["p(95)<30000"],
  },
};

function jsonHeaders(accessToken) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    origin: requestOrigin,
  };
}

function requestJson(method, path, body, headers, tags) {
  const response = http.request(method, `${baseUrl}${path}`, body, { headers, tags });
  const ok = check(response, {
    [`${method} ${path} is successful`]: (result) => result.status >= 200 && result.status < 300,
  });
  businessErrors.add(!ok, tags);
  return response;
}

function login() {
  if (!username || !password) fail("K6_USERNAME y K6_PASSWORD son obligatorios.");
  const response = requestJson(
    "POST",
    "/api/v1/auth/login",
    JSON.stringify({
      username,
      password,
      deviceName: "VICAM k6 synthetic load",
      platform: "k6",
    }),
    {
      accept: "application/json",
      "content-type": "application/json",
      origin: requestOrigin,
    },
    { endpoint: "login" },
  );
  const body = response.json();
  if (!body.accessToken || !body.user?.id) fail("Login k6 no devolvió usuario y access token.");
  return { accessToken: body.accessToken, userId: body.user.id };
}

export function setup() {
  const session = login();
  if (!mutatingSync) return session;

  const deviceResponse = requestJson(
    "POST",
    "/api/v1/devices",
    JSON.stringify({ name: "VICAM k6 ephemeral device", platform: "k6" }),
    jsonHeaders(session.accessToken),
    { endpoint: "register_device" },
  );
  const device = deviceResponse.json();
  const grantResponse = requestJson(
    "POST",
    "/api/v1/auth/offline-grants",
    JSON.stringify({ deviceId: device.id }),
    jsonHeaders(session.accessToken),
    { endpoint: "offline_grant" },
  );
  const grant = grantResponse.json();
  if (!device.id || !grant.grantToken) fail("No fue posible crear identidad offline para k6.");
  return { ...session, deviceId: device.id, offlineGrant: grant.grantToken };
}

export function commonReads(data) {
  const headers = jsonHeaders(data.accessToken);
  const page = ((__VU * 17 + __ITER) % 1000) + 1;
  const selector = (__VU + __ITER) % 4;
  let response;
  if (selector === 0) {
    response = requestJson(
      "GET",
      `/api/v1/commercial-accounts?page=${page}&pageSize=100`,
      null,
      headers,
      { endpoint: "accounts_page" },
    );
    crudDuration.add(response.timings.duration, { endpoint: "accounts_page" });
  } else if (selector === 1) {
    response = requestJson("GET", `/api/v1/visits?page=${page}&pageSize=100`, null, headers, {
      endpoint: "visits_page",
    });
    crudDuration.add(response.timings.duration, { endpoint: "visits_page" });
  } else if (selector === 2) {
    response = requestJson("GET", `/api/v1/tasks?page=${page}&pageSize=100`, null, headers, {
      endpoint: "tasks_page",
    });
    crudDuration.add(response.timings.duration, { endpoint: "tasks_page" });
  } else {
    const search = encodeURIComponent(`Cuenta sintética ${((__VU * 997 + __ITER) % 100000) + 1}`);
    response = requestJson(
      "GET",
      `/api/v1/commercial-accounts?page=1&pageSize=20&search=${search}`,
      null,
      headers,
      { endpoint: "account_search" },
    );
    searchDuration.add(response.timings.duration, { endpoint: "account_search" });
  }
  sleep(thinkTimeSeconds * (0.75 + Math.random() * 0.5));
}

function syntheticUuid(prefix, index, batch) {
  const suffix = (batch + index).toString(16).padStart(12, "0").slice(-12);
  return `${prefix}0000000-0000-4000-8000-${suffix}`;
}

export function syncOneHundredOperations(data) {
  if (!mutatingSync || !data.deviceId || !data.offlineGrant) return;
  const batch = Date.now();
  const occurredAt = new Date().toISOString();
  const operations = Array.from({ length: 100 }, (_, index) => ({
    clientOperationId: syntheticUuid("2", index, batch),
    sequence: index + 1,
    entityType: "ACCOUNT",
    entityId: syntheticUuid("1", index, batch),
    action: "CREATE",
    baseVersion: null,
    changedFields: ["displayName", "accountType", "ownerUserId", "countryCode", "city", "phone"],
    dependsOn: [],
    payload: {
      displayName: `Cuenta sync k6 ${batch}-${index}`,
      accountType: "DISTRIBUTOR",
      ownerUserId: data.userId,
      countryCode: "EC",
      city: "Quito",
      phone: `+593200${String(index).padStart(4, "0")}`,
      fruitIds: [],
    },
    occurredAt,
  }));
  const response = requestJson(
    "POST",
    "/api/v1/sync/push",
    JSON.stringify({ deviceId: data.deviceId, operations }),
    {
      ...jsonHeaders(data.accessToken),
      "x-offline-grant": data.offlineGrant,
    },
    { endpoint: "sync_100_operations" },
  );
  syncBatchDuration.add(response.timings.duration, { endpoint: "sync_100_operations" });
  const results = response.json("results");
  const accepted =
    Array.isArray(results) &&
    results.length === 100 &&
    results.every((result) => result.status === "APPLIED");
  businessErrors.add(!accepted, { endpoint: "sync_100_operations" });
  check(response, { "100 sync operations applied": () => accepted });

  const retry = requestJson(
    "POST",
    "/api/v1/sync/push",
    JSON.stringify({ deviceId: data.deviceId, operations }),
    {
      ...jsonHeaders(data.accessToken),
      "x-offline-grant": data.offlineGrant,
    },
    { endpoint: "sync_100_duplicate_retry" },
  );
  const retryResults = retry.json("results");
  const deduplicated =
    Array.isArray(retryResults) &&
    retryResults.length === 100 &&
    retryResults.every((result) => result.status === "DUPLICATE");
  businessErrors.add(!deduplicated, { endpoint: "sync_100_duplicate_retry" });
  check(retry, { "100 sync retries are duplicates": () => deduplicated });

  const persisted = requestJson(
    "GET",
    `/api/v1/commercial-accounts?page=1&pageSize=100&search=${encodeURIComponent(`Cuenta sync k6 ${batch}-`)}`,
    null,
    jsonHeaders(data.accessToken),
    { endpoint: "sync_100_persisted_effects" },
  );
  const uniqueEffects = persisted.json("pagination.total") === 100;
  businessErrors.add(!uniqueEffects, { endpoint: "sync_100_persisted_effects" });
  check(persisted, { "100 sync operations have one persisted effect": () => uniqueEffects });
}
