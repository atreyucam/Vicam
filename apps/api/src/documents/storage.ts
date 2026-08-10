import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ApiConfig } from "../config.js";
import { AppError } from "../errors.js";
export const absoluteDocumentMaxBytes = 10 * 1024 * 1024;
const types = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type DocumentFormat = keyof typeof types;
export function inspectDocument(
  name: string,
  mime: string,
  body: Buffer,
  maxBytes = absoluteDocumentMaxBytes,
) {
  const extension = basename(name).split(".").pop()?.toLowerCase();
  const format =
    extension === "pdf"
      ? "PDF"
      : extension === "docx"
        ? "DOCX"
        : extension === "xlsx"
          ? "XLSX"
          : undefined;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > absoluteDocumentMaxBytes ||
    !format ||
    body.length === 0 ||
    body.length > maxBytes
  )
    throw new AppError(
      422,
      "DOCUMENT_INVALID",
      "El archivo debe ser PDF, DOCX o XLSX y no superar 10 MB.",
    );
  const isZip = body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const zipDirectory = isZip ? body.toString("latin1") : "";
  const signature =
    format === "PDF"
      ? body.subarray(0, 5).toString("ascii") === "%PDF-"
      : isZip &&
        zipDirectory.includes("[Content_Types].xml") &&
        (format === "DOCX" ? zipDirectory.includes("word/") : zipDirectory.includes("xl/"));
  if (!signature || mime !== types[format])
    throw new AppError(
      422,
      "DOCUMENT_TYPE_INVALID",
      "La extensión, MIME y firma del archivo no coinciden.",
    );
  return {
    format,
    mimeType: types[format],
    checksum: createHash("sha256").update(body).digest("hex"),
  };
}
export class PrivateStorage {
  readonly root: string;
  constructor(config: ApiConfig) {
    this.root = resolve(config.DOCUMENT_STORAGE_ROOT);
  }
  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key))
      throw new AppError(500, "STORAGE_KEY_INVALID", "No se pudo acceder al archivo.");
    return join(this.root, "documents", key);
  }
  async saveQuarantine(body: Buffer) {
    const key = randomUUID();
    const directory = join(this.root, "documents");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${key}.tmp`);
    await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.path(key));
    return key;
  }
  async read(key: string) {
    const file = this.path(key);
    try {
      await stat(file);
      return file;
    } catch {
      throw new AppError(404, "DOCUMENT_FILE_NOT_FOUND", "El documento no está disponible.");
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
