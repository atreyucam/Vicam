import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { inspectDocument } from "./storage.js";

const zip = (folder: "word/" | "xl/") =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`[Content_Types].xml\0${folder}document.xml`),
  ]);

describe("document inspection", () => {
  it("validates extension, MIME, signature, configured size and checksum", () => {
    const pdf = Buffer.from("%PDF-1.7\ncontenido técnico");
    expect(inspectDocument("reporte.pdf", "application/pdf", pdf, pdf.length)).toEqual({
      format: "PDF",
      mimeType: "application/pdf",
      checksum: createHash("sha256").update(pdf).digest("hex"),
    });
    expect(
      inspectDocument(
        "cuentas.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zip("xl/"),
      ).format,
    ).toBe("XLSX");
    expect(
      inspectDocument(
        "acuerdo.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        zip("word/"),
      ).format,
    ).toBe("DOCX");
    expect(() => inspectDocument("reporte.pdf", "application/pdf", pdf, pdf.length - 1)).toThrow(
      "no superar",
    );
  });

  it("rejects MIME, extension and OOXML package mismatches", () => {
    expect(() => inspectDocument("reporte.pdf", "text/plain", Buffer.from("%PDF-1.7"))).toThrow(
      "no coinciden",
    );
    expect(() =>
      inspectDocument(
        "falso.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        zip("xl/"),
      ),
    ).toThrow("no coinciden");
    expect(() => inspectDocument("imagen.png", "image/png", Buffer.from("PNG"))).toThrow(
      "PDF, DOCX o XLSX",
    );
  });
});
