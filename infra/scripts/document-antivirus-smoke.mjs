#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.env.VICAM_SMOKE_BASE_URL ?? "http://127.0.0.1:8080");
const username = process.env.VICAM_SMOKE_USERNAME;
const password = process.env.VICAM_SMOKE_PASSWORD;
const timeoutMs = Number(process.env.VICAM_SMOKE_TIMEOUT_MS ?? 60_000);

if (!username || !password) {
  throw new Error("VICAM_SMOKE_USERNAME y VICAM_SMOKE_PASSWORD son obligatorios.");
}

async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    ...options,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
  });
}

async function expectJson(path, status, options = {}) {
  const response = await request(path, options);
  if (response.status !== status) {
    throw new Error(`${path} devolvió HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function crc32(body) {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [filename, contents] of files) {
    const name = Buffer.from(filename);
    const body = Buffer.from(contents);
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const login = await expectJson("/api/v1/auth/login", 200, {
  method: "POST",
  headers: { "content-type": "application/json", origin: baseUrl.origin },
  body: JSON.stringify({
    username,
    password,
    deviceName: "VICAM antivirus smoke",
    platform: "operations-smoke",
  }),
});
if (login.user?.role !== "MANAGER" || typeof login.accessToken !== "string") {
  throw new Error("El smoke antivirus requiere un Manager ficticio.");
}

const authorization = { authorization: `Bearer ${login.accessToken}` };
const accounts = await expectJson("/api/v1/commercial-accounts?page=1&pageSize=1", 200, {
  headers: authorization,
});
const accountId = accounts.items?.[0]?.id;
if (typeof accountId !== "string") throw new Error("No existe una cuenta ficticia para el smoke.");

const categories = await expectJson("/api/v1/document-categories", 200, {
  headers: authorization,
});
let category = categories.find((item) => item.active);
if (!category) {
  category = await expectJson("/api/v1/document-categories", 201, {
    method: "POST",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ name: `Antivirus smoke ${new Date().toISOString()}` }),
  });
}

const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const workbook = storedZip([
  ["[Content_Types].xml", "<Types></Types>"],
  ["xl/eicar.txt", eicar],
]);
const form = new FormData();
form.set("categoryId", category.id);
form.set(
  "file",
  new Blob([workbook], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  `eicar-smoke-${randomUUID()}.xlsx`,
);
const uploaded = await expectJson(`/api/v1/commercial-accounts/${accountId}/documents`, 202, {
  method: "POST",
  headers: { ...authorization, "idempotency-key": randomUUID() },
  body: form,
});

const deadline = Date.now() + timeoutMs;
let document;
while (Date.now() < deadline) {
  const page = await expectJson(
    `/api/v1/documents?accountId=${encodeURIComponent(accountId)}&page=1&pageSize=100`,
    200,
    { headers: authorization },
  );
  document = page.items?.find((item) => item.id === uploaded.id);
  if (document?.status === "REJECTED") break;
  if (document?.status === "AVAILABLE") throw new Error("ClamAV marcó EICAR como disponible.");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (document?.status !== "REJECTED") {
  throw new Error(`El documento no fue rechazado antes del timeout: ${document?.status ?? "N/A"}.`);
}

const download = await request(`/api/v1/documents/${uploaded.id}/download`, {
  headers: authorization,
});
if (download.status !== 404) {
  throw new Error(`La descarga de un documento rechazado devolvió HTTP ${download.status}.`);
}

process.stdout.write(
  `${JSON.stringify({
    event: "document_antivirus_smoke_ok",
    at: new Date().toISOString(),
    documentId: uploaded.id,
    status: document.status,
    rejectedReason: document.rejectedReason,
    downloadStatus: download.status,
  })}\n`,
);
