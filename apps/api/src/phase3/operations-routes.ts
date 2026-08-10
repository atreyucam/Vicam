import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import multer from "multer";
import {
  confirmImportRequestSchema,
  createReportExportRequestSchema,
  importBatchDetailSchema,
  importBatchSchema,
  reportExportSchema,
  reportExportsPageSchema,
} from "@vicam/contracts";
import { Router, type Request } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { authenticate, requireAuth, requirePasswordChangeComplete } from "../auth/authenticate.js";
import type { ApiConfig } from "../config.js";
import type { DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import { pagination, type Actor } from "../domain/shared.js";
import { AppError } from "../errors.js";
import { assertReportTemplate, parseReportFilters } from "./report-filters.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const importMime = {
  CSV: "text/csv",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
type ImportRow = {
  row_number: number;
  action: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
  errors: string[];
  duplicate_of_account_id: string | null;
  values_json: Record<string, unknown>;
};
type Batch = {
  id: string;
  format: "CSV" | "XLSX";
  status: "UPLOADED" | "VALIDATING" | "READY" | "CONFIRMING" | "COMPLETED" | "FAILED";
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skip_rows: number;
  error_rows: number;
  confirmation_id: string | null;
  completed_at: Date | null;
  created_at: Date;
};
type Export = {
  id: string;
  report_group: "VISITS" | "TASKS" | "ACCOUNTS" | "DOCUMENTS" | "MANAGEMENT";
  template: string;
  format: "PDF" | "XLSX";
  filters: Record<string, unknown>;
  status: "QUEUED" | "PROCESSING" | "AVAILABLE" | "FAILED" | "EXPIRED";
  created_at: Date;
  expires_at: Date;
  error_code: string | null;
  storage_key: string | null;
  requester_role?: "MANAGER" | "SUPERVISOR";
  scope_user_id?: string | null;
};
export function importConfirmationDisposition(
  row: Pick<Batch, "status" | "confirmation_id">,
  confirmationId: string,
) {
  if (row.confirmation_id && row.confirmation_id !== confirmationId)
    throw new AppError(
      409,
      "IMPORT_CONFIRMATION_CONFLICT",
      "La importación ya usa otra confirmación.",
    );
  if (
    row.confirmation_id === confirmationId &&
    (row.status === "CONFIRMING" || row.status === "COMPLETED")
  )
    return "REPLAY" as const;
  if (row.status !== "READY")
    throw new AppError(409, "IMPORT_NOT_READY", "La importación aún no está lista para confirmar.");
  return "QUEUE" as const;
}
const meta = (r: Request) => ({
  requestId: r.requestId,
  idempotencyKey:
    typeof r.headers["idempotency-key"] === "string" ? r.headers["idempotency-key"] : undefined,
});
const mapBatch = (r: Batch) =>
  importBatchSchema.parse({
    id: r.id,
    format: r.format,
    status: r.status,
    totalRows: r.total_rows,
    createRows: r.create_rows,
    updateRows: r.update_rows,
    skipRows: r.skip_rows,
    errorRows: r.error_rows,
    confirmationId: r.confirmation_id,
    completedAt: r.completed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  });
const mapExport = (r: Export) =>
  reportExportSchema.parse({
    id: r.id,
    group: r.report_group,
    template: r.template,
    format: r.format,
    filters: r.filters,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    error: r.error_code,
  });
function manager(actor: Actor) {
  if (actor.role !== "MANAGER")
    throw new AppError(403, "MANAGER_REQUIRED", "No tiene permiso para esta operación.");
}
function storageRoot(config: ApiConfig) {
  return join(resolve(config.DOCUMENT_STORAGE_ROOT), "operations");
}
async function save(root: string, folder: string, body: Buffer) {
  const key = randomUUID();
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const finalPath = join(dir, key),
    tmp = join(dir, `.${key}.tmp`);
  await writeFile(tmp, body, { flag: "wx", mode: 0o600 });
  await rename(tmp, finalPath);
  return `${folder}/${key}`;
}
function validImport(file: Express.Multer.File) {
  const extension = basename(file.originalname).split(".").pop()?.toLowerCase();
  const format = extension === "csv" ? "CSV" : extension === "xlsx" ? "XLSX" : undefined;
  if (
    !format ||
    !file.buffer.length ||
    file.size > 10 * 1024 * 1024 ||
    file.mimetype !== importMime[format] ||
    (format === "XLSX" && !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
  )
    throw new AppError(
      422,
      "IMPORT_TYPE_INVALID",
      "El archivo debe ser CSV o XLSX válido y no superar 10 MB.",
    );
  return format;
}
async function supervisorReportsAllowed(pool: DbPool) {
  const result = await pool.query<{ value: { supervisorReportsEnabled?: boolean } }>(
    "select value from app_settings where settings_key='application'",
  );
  return result.rows[0]?.value.supervisorReportsEnabled === true;
}
export function createOperationsRouter(pool: DbPool, config: ApiConfig): ExpressRouter {
  const router = Router();
  router.use(authenticate(pool, config.AUTH_SECRET), requirePasswordChangeComplete);
  router.post("/imports", upload.single("file"), async (r, s, n) => {
    try {
      const actor = requireAuth(r);
      manager(actor);
      if (!r.file) throw new AppError(422, "IMPORT_FILE_REQUIRED", "Debe adjuntar un archivo.");
      const format = validImport(r.file),
        root = storageRoot(config),
        checksum = createHash("sha256").update(r.file.buffer).digest("hex");
      let savedKey: string | undefined;
      let result;
      try {
        result = await inTransaction(
          pool,
          async (c) =>
            (
              await idempotentMutation(
                c,
                {
                  actorUserId: actor.userId,
                  key: meta(r).idempotencyKey,
                  operation: "import.upload",
                  request: { checksum, format },
                  statusCode: 202,
                },
                async () => {
                  const id = randomUUID();
                  savedKey = await save(root, "imports", r.file!.buffer);
                  const inserted = await c.query<Batch>(
                    "insert into import_batches(id,requester_user_id,format,storage_key,checksum_sha256,status) values($1,$2,$3,$4,$5,'UPLOADED') returning *",
                    [id, actor.userId, format, savedKey, checksum],
                  );
                  await writeAudit(c, {
                    actorUserId: actor.userId,
                    action: "IMPORT_UPLOADED",
                    entityType: "import_batch",
                    entityId: id,
                    requestId: meta(r).requestId,
                    after: { format, sizeBytes: r.file!.size, checksum },
                  });
                  return mapBatch(inserted.rows[0]!);
                },
              )
            ).value,
        );
      } catch (error) {
        if (savedKey) await rm(join(root, savedKey), { force: true }).catch(() => undefined);
        throw error;
      }
      s.status(202).json(result);
    } catch (e) {
      n(e);
    }
  });
  router.get("/imports/:id", async (r, s, n) => {
    try {
      const actor = requireAuth(r);
      manager(actor);
      const id = z.uuid().parse(r.params.id);
      const batch = await pool.query<Batch>(
        "select * from import_batches where id=$1 and requester_user_id=$2",
        [id, actor.userId],
      );
      if (!batch.rows[0])
        throw new AppError(404, "IMPORT_NOT_FOUND", "La importación no está disponible.");
      const rows = await pool.query<ImportRow>(
        "select row_number,action,errors,duplicate_of_account_id,values_json from import_rows where batch_id=$1 order by row_number",
        [id],
      );
      s.json(
        importBatchDetailSchema.parse({
          ...mapBatch(batch.rows[0]),
          rows: rows.rows.map((x) => ({
            rowNumber: x.row_number,
            action: x.action,
            errors: x.errors,
            duplicateOfAccountId: x.duplicate_of_account_id,
            values: x.values_json,
          })),
        }),
      );
    } catch (e) {
      n(e);
    }
  });
  router.get("/imports/:id/errors", async (r, s, n) => {
    try {
      const actor = requireAuth(r);
      manager(actor);
      const id = z.uuid().parse(r.params.id);
      const found = await pool.query<{ error_storage_key: string | null }>(
        "select error_storage_key from import_batches where id=$1 and requester_user_id=$2",
        [id, actor.userId],
      );
      const key = found.rows[0]?.error_storage_key;
      if (!key)
        throw new AppError(
          404,
          "IMPORT_ERRORS_NOT_FOUND",
          "La importación no tiene un archivo de errores disponible.",
        );
      const file = await readFile(join(storageRoot(config), key));
      s.setHeader("Content-Type", "text/csv; charset=utf-8");
      s.setHeader("Content-Disposition", `attachment; filename="errores-importacion-${id}.csv"`);
      s.setHeader("X-Content-Type-Options", "nosniff");
      s.send(file);
    } catch (error) {
      n(error);
    }
  });
  router.post("/imports/:id/confirm", async (r, s, n) => {
    try {
      const actor = requireAuth(r);
      manager(actor);
      const id = z.uuid().parse(r.params.id),
        input = confirmImportRequestSchema.parse(r.body);
      const result = await inTransaction(
        pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: actor.userId,
                key: meta(r).idempotencyKey,
                operation: `import.confirm:${id}`,
                request: input,
                statusCode: 202,
              },
              async () => {
                const b = await c.query<
                    Batch & { requester_user_id: string; confirmation_id: string | null }
                  >("select * from import_batches where id=$1 for update", [id]),
                  row = b.rows[0];
                if (!row || row.requester_user_id !== actor.userId)
                  throw new AppError(404, "IMPORT_NOT_FOUND", "La importación no está disponible.");
                if (importConfirmationDisposition(row, input.confirmationId) === "REPLAY")
                  return mapBatch(row);
                const updated = await c.query<Batch>(
                  "update import_batches set status='CONFIRMING',confirmation_id=$2,updated_at=now() where id=$1 returning *",
                  [id, input.confirmationId],
                );
                await writeAudit(c, {
                  actorUserId: actor.userId,
                  action: "IMPORT_CONFIRM_QUEUED",
                  entityType: "import_batch",
                  entityId: id,
                  requestId: meta(r).requestId,
                  after: { confirmationId: input.confirmationId },
                });
                return mapBatch(updated.rows[0]!);
              },
            )
          ).value,
      );
      s.status(202).json(result);
    } catch (e) {
      n(e);
    }
  });
  router.get("/reports/exports", async (r, s, n) => {
    try {
      const a = requireAuth(r);
      const page = z.coerce.number().int().min(1).default(1).parse(r.query.page),
        pageSize = z.coerce.number().int().min(1).max(100).default(25).parse(r.query.pageSize);
      const count = await pool.query<{ total: number }>(
        "select count(*)::int total from report_exports where requester_user_id=$1",
        [a.userId],
      );
      const rows = await pool.query<Export>(
        "select * from report_exports where requester_user_id=$1 order by created_at desc,id limit $2 offset $3",
        [a.userId, pageSize, (page - 1) * pageSize],
      );
      s.json(
        reportExportsPageSchema.parse({
          items: rows.rows.map(mapExport),
          pagination: pagination(page, pageSize, count.rows[0]?.total ?? 0),
        }),
      );
    } catch (e) {
      n(e);
    }
  });
  router.post("/reports/exports", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        input = createReportExportRequestSchema.parse(r.body);
      if (a.role === "SUPERVISOR" && !(await supervisorReportsAllowed(pool)))
        throw new AppError(
          403,
          "REPORTS_NOT_ENABLED",
          "Los reportes propios no están habilitados.",
        );
      if (a.role === "SUPERVISOR" && input.group === "MANAGEMENT")
        throw new AppError(
          403,
          "MANAGEMENT_REPORT_MANAGER_ONLY",
          "El resumen gerencial está disponible únicamente para Manager.",
        );
      assertReportTemplate(input.group, input.template);
      const filters = parseReportFilters(input.group, input.filters);
      if (
        a.role === "SUPERVISOR" &&
        "responsibleUserId" in filters &&
        filters.responsibleUserId !== a.userId
      )
        throw new AppError(403, "REPORT_SCOPE_INVALID", "El reporte debe usar su alcance propio.");
      const result = await inTransaction(
        pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: a.userId,
                key: meta(r).idempotencyKey,
                operation: "report.export.create",
                request: { ...input, filters },
                statusCode: 202,
              },
              async () => {
                const id = randomUUID(),
                  row = await c.query<Export>(
                    "insert into report_exports(id,requester_user_id,report_group,template,format,filters,timezone,status,expires_at,requester_role,scope_user_id) values($1,$2,$3,$4,$5,$6,$7,'QUEUED',now()+interval '7 days',$8,$9) returning *",
                    [
                      id,
                      a.userId,
                      input.group,
                      input.template,
                      input.format,
                      filters,
                      input.timezone,
                      a.role,
                      a.role === "SUPERVISOR" ? a.userId : null,
                    ],
                  );
                await writeAudit(c, {
                  actorUserId: a.userId,
                  action: "REPORT_EXPORT_QUEUED",
                  entityType: "report_export",
                  entityId: id,
                  requestId: meta(r).requestId,
                  after: { group: input.group, template: input.template, format: input.format },
                });
                return mapExport(row.rows[0]!);
              },
            )
          ).value,
      );
      s.status(202).json(result);
    } catch (e) {
      n(e);
    }
  });
  router.get("/reports/exports/:id/download", async (r, s, n) => {
    try {
      const a = requireAuth(r),
        id = z.uuid().parse(r.params.id);
      const found = await pool.query<Export & { current_role: "MANAGER" | "SUPERVISOR" }>(
        `select r.*,u.role current_role from report_exports r join users u on u.id=r.requester_user_id
         where r.id=$1 and r.requester_user_id=$2 and r.status='AVAILABLE'
           and r.expires_at>now() and u.status='ACTIVE'`,
        [id, a.userId],
      );
      const row = found.rows[0];
      if (!row || !row.storage_key)
        throw new AppError(404, "REPORT_EXPORT_NOT_FOUND", "La exportación no está disponible.");
      if (
        row.current_role === "SUPERVISOR" &&
        (row.requester_role !== "SUPERVISOR" ||
          row.scope_user_id !== a.userId ||
          row.report_group === "MANAGEMENT" ||
          !(await supervisorReportsAllowed(pool)))
      )
        throw new AppError(404, "REPORT_EXPORT_NOT_FOUND", "La exportación no está disponible.");
      const file = await readFile(join(storageRoot(config), row.storage_key));
      s.setHeader(
        "Content-Type",
        row.format === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      s.setHeader(
        "Content-Disposition",
        `attachment; filename="reporte-${id}.${row.format.toLowerCase()}"`,
      );
      s.setHeader("X-Content-Type-Options", "nosniff");
      s.send(file);
    } catch (e) {
      n(e);
    }
  });
  return router;
}
