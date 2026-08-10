#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const config = {
  offlineEnabled: process.env.VICAM_OFFLINE_SYNC_ENABLED === "true",
  mapStyleUrl: process.env.VICAM_MAPLIBRE_STYLE_URL ?? "",
  mapApiKey: process.env.VICAM_MAPLIBRE_API_KEY ?? "",
  webPushPublicKey: process.env.VICAM_VAPID_PUBLIC_KEY ?? "",
};

const root = resolve(fileURLToPath(new URL("../../apps/web/dist/", import.meta.url)));
const runtimeFile = resolve(root, "runtime/config.js");

await writeFile(runtimeFile, `globalThis.__VICAM_CONFIG__ = ${JSON.stringify(config)};\n`, {
  mode: 0o600,
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

async function selectedFile(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  try {
    if ((await stat(candidate)).isFile()) return candidate;
  } catch {
    // Client routes fall through to the SPA shell.
  }
  return extname(relative) ? null : resolve(root, "index.html");
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = await selectedFile(pathname);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(file);
    const extension = extname(file);
    const cacheControl =
      file === runtimeFile || extension === ".html"
        ? "no-store"
        : file.includes(`${sep}assets${sep}`)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
    response.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Length": body.byteLength,
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(4173, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
