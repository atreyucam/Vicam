import multer from "multer";
import { Router, type Request } from "express";
import type { Router as ExpressRouter } from "express";
import { documentsPageSchema, documentSchema, documentsQuerySchema } from "@vicam/contracts";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import { requestIp } from "../auth/http.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { DocumentsService } from "./service.js";
import { PrivateStorage } from "./storage.js";
import { AppError } from "../errors.js";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const meta = (r: Request) => ({
  requestId: r.requestId,
  ipAddress: requestIp(r),
  ...(typeof r.headers["idempotency-key"] === "string"
    ? { idempotencyKey: r.headers["idempotency-key"] }
    : {}),
});
const uploadFieldsSchema = z.object({
  categoryId: z.uuid(),
  visitId: z.uuid().optional(),
  taskId: z.uuid().optional(),
});
export function createDocumentsRouter(pool: DbPool, config: ApiConfig): ExpressRouter {
  const router = Router(),
    service = new DocumentsService(pool, new PrivateStorage(config));
  router.use(authenticate(pool, config.AUTH_SECRET), requirePasswordChangeComplete);
  router.get("/documents", async (r, s, n) => {
    try {
      s.json(
        documentsPageSchema.parse(
          await service.list(documentsQuerySchema.parse(r.query), requireAuth(r)),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  router.post("/commercial-accounts/:id/documents", upload.single("file"), async (r, s, n) => {
    try {
      if (!r.file) throw new AppError(422, "DOCUMENT_FILE_REQUIRED", "Debe adjuntar un archivo.");
      const fields = uploadFieldsSchema.parse(r.body);
      s.status(202).json(
        documentSchema.parse(
          await service.upload(
            z.uuid().parse(r.params.id),
            r.file,
            fields.categoryId,
            fields.visitId,
            fields.taskId,
            requireAuth(r),
            meta(r),
          ),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  router.get("/documents/:id/download", async (r, s, n) => {
    try {
      const row = await service.get(z.uuid().parse(r.params.id), requireAuth(r));
      if (row.status !== "AVAILABLE")
        throw new AppError(404, "DOCUMENT_NOT_FOUND", "El documento no está disponible.");
      const path = await service.storage.read(row.storage_key);
      s.setHeader("Content-Type", row.mime_type);
      s.setHeader(
        "Content-Disposition",
        `attachment; filename="${row.original_filename.replaceAll('"', "")}"`,
      );
      s.setHeader("X-Content-Type-Options", "nosniff");
      s.sendFile(path);
    } catch (e) {
      n(e);
    }
  });
  router.delete("/documents/:id", async (r, s, n) => {
    try {
      s.json(
        documentSchema.parse(
          await service.trash(z.uuid().parse(r.params.id), requireAuth(r), meta(r)),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  router.post("/documents/:id/restore", async (r, s, n) => {
    try {
      s.json(
        documentSchema.parse(
          await service.restore(z.uuid().parse(r.params.id), requireAuth(r), meta(r)),
        ),
      );
    } catch (e) {
      n(e);
    }
  });
  return router;
}
