#!/usr/bin/env node

const baseUrl = new URL(process.env.VICAM_SMOKE_BASE_URL ?? "http://127.0.0.1:8080");
const timeoutMs = numberFromEnvironment("VICAM_SMOKE_TIMEOUT_MS", 10_000);
const username = process.env.VICAM_SMOKE_USERNAME;
const password = process.env.VICAM_SMOKE_PASSWORD;

if ((username && !password) || (!username && password)) {
  fail("VICAM_SMOKE_USERNAME y VICAM_SMOKE_PASSWORD deben definirse juntos.");
}

function numberFromEnvironment(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${name} debe ser un entero positivo.`);
  return parsed;
}

function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ event, at: new Date().toISOString(), baseUrl: baseUrl.origin, ...fields })}\n`,
  );
}

function fail(message) {
  throw new Error(message);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      redirect: "manual",
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
    log("smoke_http", {
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function expectJson(path, expectedStatus = 200, options = {}) {
  const response = await request(path, options);
  if (response.status !== expectedStatus) fail(`${path} devolvió HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    fail(`${path} no devolvió application/json.`);
  }
  return { response, body: await response.json() };
}

function cookieHeader(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function run() {
  const gateway = await expectJson("/health/live");
  if (gateway.body.status !== "ok") fail("Gateway live no informó status=ok.");

  const apiLive = await expectJson("/api/v1/health/live");
  if (apiLive.body.status !== "ok") fail("API live no informó status=ok.");

  const apiReady = await expectJson("/api/v1/health/ready");
  if (
    !["ok", "ready"].includes(apiReady.body.status) ||
    (apiReady.body.checks && apiReady.body.checks.database !== "up")
  ) {
    fail("API readiness no informó estado operativo.");
  }

  const home = await request("/", { headers: { accept: "text/html" } });
  if (home.status !== 200) fail(`/ devolvió HTTP ${home.status}.`);
  const requiredHeaders = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  for (const [name, expected] of Object.entries(requiredHeaders)) {
    if ((home.headers.get(name) ?? "").toLowerCase() !== expected) {
      fail(`Falta header ${name}: ${expected}.`);
    }
  }
  if (baseUrl.protocol === "https:" && !home.headers.get("strict-transport-security")) {
    fail("HTTPS no devolvió Strict-Transport-Security.");
  }

  if (!username) {
    log("smoke_complete", { authenticated: false });
    return;
  }

  const login = await expectJson("/api/v1/auth/login", 200, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl.origin },
    body: JSON.stringify({
      username,
      password,
      deviceName: "VICAM smoke automatizado",
      platform: "operations-smoke",
    }),
  });
  const accessToken = login.body.accessToken;
  const csrfToken = login.body.csrfToken;
  if (typeof accessToken !== "string" || typeof csrfToken !== "string") {
    fail("Login no devolvió tokens con la forma esperada.");
  }
  const authorization = { authorization: `Bearer ${accessToken}` };
  for (const path of [
    "/api/v1/commercial-accounts?page=1&pageSize=5",
    "/api/v1/visits?page=1&pageSize=5",
    "/api/v1/tasks?page=1&pageSize=5",
  ]) {
    const probe = await expectJson(path, 200, { headers: authorization });
    if (!Array.isArray(probe.body.items)) fail(`${path} no devolvió una página válida.`);
  }

  const cookies = cookieHeader(login.response);
  const logout = await request("/api/v1/auth/logout", {
    method: "POST",
    headers: {
      ...authorization,
      "x-csrf-token": csrfToken,
      "content-type": "application/json",
      origin: baseUrl.origin,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: "{}",
  });
  if (logout.status !== 204) fail(`Logout del usuario smoke devolvió HTTP ${logout.status}.`);
  log("smoke_complete", { authenticated: true });
}

run().catch((error) => {
  log("smoke_failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
