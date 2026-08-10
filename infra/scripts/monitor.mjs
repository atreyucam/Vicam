#!/usr/bin/env node

import tls from "node:tls";

const monitorUrl = new URL(process.env.VICAM_MONITOR_URL ?? "https://staging.app.vicamproduce.com");
const webhookUrl = process.env.VICAM_MONITOR_WEBHOOK_URL;
const timeoutMs = positiveInteger("VICAM_MONITOR_TIMEOUT_MS", 10_000);
const minimumCertificateDays = positiveInteger("VICAM_MONITOR_MIN_CERT_DAYS", 14);

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} debe ser entero positivo.`);
  return parsed;
}

function certificateExpiry() {
  if (monitorUrl.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: monitorUrl.hostname,
        port: Number(monitorUrl.port || 443),
        servername: monitorUrl.hostname,
        timeout: timeoutMs,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        socket.end();
        if (!certificate.valid_to) return reject(new Error("TLS no presentó fecha de expiración."));
        const expiry = new Date(certificate.valid_to);
        if (Number.isNaN(expiry.getTime())) return reject(new Error("Expiración TLS inválida."));
        resolve(expiry);
      },
    );
    socket.once("timeout", () => socket.destroy(new Error("Timeout TLS.")));
    socket.once("error", reject);
  });
}

async function probe(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, monitorUrl), {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "vicam-external-monitor/1" },
    });
    const body = await response.text();
    if (response.status !== 200) throw new Error(`${path} devolvió HTTP ${response.status}.`);
    const parsed = JSON.parse(body);
    return { path, durationMs: Math.round(performance.now() - started), body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function notify(payload) {
  if (!webhookUrl) return;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Webhook devolvió HTTP ${response.status}.`);
}

async function run() {
  const startedAt = new Date().toISOString();
  try {
    const [live, ready, expiry] = await Promise.all([
      probe("/health/live"),
      probe("/api/v1/health/ready"),
      certificateExpiry(),
    ]);
    if (live.body.status !== "ok") throw new Error("Live no informó status=ok.");
    if (
      !["ok", "ready"].includes(ready.body.status) ||
      (ready.body.checks && ready.body.checks.database !== "up")
    ) {
      throw new Error("Readiness no informó estado operativo.");
    }
    const certificateDays =
      expiry === null ? null : Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
    if (certificateDays !== null && certificateDays < minimumCertificateDays) {
      throw new Error(`Certificado expira en ${certificateDays} días.`);
    }
    const result = {
      event: "vicam_monitor_ok",
      at: startedAt,
      target: monitorUrl.origin,
      liveMs: live.durationMs,
      readyMs: ready.durationMs,
      certificateDays,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.env.VICAM_MONITOR_NOTIFY_SUCCESS === "true") await notify(result);
  } catch (error) {
    const result = {
      event: "vicam_monitor_failed",
      at: startedAt,
      target: monitorUrl.origin,
      message: error instanceof Error ? error.message : String(error),
    };
    process.stderr.write(`${JSON.stringify(result)}\n`);
    try {
      await notify(result);
    } catch (notificationError) {
      process.stderr.write(
        `${JSON.stringify({
          event: "vicam_monitor_notification_failed",
          at: new Date().toISOString(),
          message:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        })}\n`,
      );
    }
    process.exitCode = 1;
  }
}

await run();
