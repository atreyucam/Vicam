import { randomUUID } from "node:crypto";
import { documentSchema, documentsPageSchema, type documentsQuerySchema } from "@vicam/contracts";
import type { z } from "zod";
import type { DbClient, DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { pagination } from "../domain/shared.js";
import { AppError } from "../errors.js";
import { inspectDocument, PrivateStorage } from "./storage.js";
type Query = z.infer<typeof documentsQuerySchema>;
type Row = {
  id: string;
  account_id: string;
  visit_id: string | null;
  task_id: string | null;
  category_id: string;
  category_name: string;
  original_filename: string;
  format: "PDF" | "DOCX" | "XLSX";
  size_bytes: number;
  checksum_sha256: string;
  status: "QUARANTINED" | "SCANNING" | "AVAILABLE" | "REJECTED" | "DELETED";
  rejected_reason: string | null;
  deleted_at: Date | null;
  created_at: Date;
  created_by: string;
  storage_key: string;
  mime_type: string;
};
const map = (r: Row) =>
  documentSchema.parse({
    id: r.id,
    accountId: r.account_id,
    visitId: r.visit_id,
    taskId: r.task_id,
    categoryId: r.category_id,
    categoryName: r.category_name,
    originalName: r.original_filename,
    format: r.format,
    sizeBytes: r.size_bytes,
    checksum: r.checksum_sha256,
    status: r.status,
    rejectedReason: r.rejected_reason,
    deletedAt: r.deleted_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by,
  });
const select = `select d.*,c.name category_name from documents d join document_categories c on c.id=d.category_id join commercial_accounts a on a.id=d.account_id`;
export class DocumentsService {
  constructor(
    private readonly pool: DbPool,
    readonly storage: PrivateStorage,
  ) {}
  private scope(actor: Actor, values: unknown[], where: string[]) {
    if (actor.role === "SUPERVISOR") {
      values.push(actor.userId);
      where.push(`a.owner_user_id=$${values.length}`);
    }
  }
  async list(q: Query, actor: Actor) {
    const v: unknown[] = [],
      w: string[] = [];
    this.scope(actor, v, w);
    for (const [key, column] of [
      ["accountId", "d.account_id"],
      ["categoryId", "d.category_id"],
      ["status", "d.status"],
    ] as const) {
      if (q[key] !== undefined) {
        v.push(q[key]);
        w.push(`${column}=$${v.length}`);
      }
    }
    const clause = w.length ? `where ${w.join(" and ")}` : "";
    const count = await this.pool.query<{ total: number }>(
      `select count(*)::int total from documents d join commercial_accounts a on a.id=d.account_id ${clause}`,
      v,
    );
    v.push(q.pageSize, (q.page - 1) * q.pageSize);
    const rows = await this.pool.query<Row>(
      `${select} ${clause} order by d.created_at desc,d.id limit $${v.length - 1} offset $${v.length}`,
      v,
    );
    return documentsPageSchema.parse({
      items: rows.rows.map(map),
      pagination: pagination(q.page, q.pageSize, count.rows[0]?.total ?? 0),
    });
  }
  async get(id: string, actor: Actor, client: DbClient | DbPool = this.pool, lock = false) {
    const v: unknown[] = [id],
      w = ["d.id=$1"];
    this.scope(actor, v, w);
    const row = await client.query<Row>(
      `${select} where ${w.join(" and ")}${lock ? " for update of d" : ""}`,
      v,
    );
    if (!row.rows[0])
      throw new AppError(404, "DOCUMENT_NOT_FOUND", "El documento no está disponible.");
    return row.rows[0];
  }
  async upload(
    accountId: string,
    file: Express.Multer.File,
    categoryId: string,
    visitId: string | undefined,
    taskId: string | undefined,
    actor: Actor,
    meta: RequestMeta,
  ) {
    if (visitId && taskId)
      throw new AppError(
        422,
        "DOCUMENT_CONTEXT_INVALID",
        "El documento solo puede asociarse a una visita o tarea.",
      );
    const settings = await this.pool.query<{ document_limit_bytes: number }>(
      `select coalesce((value->>'documentLimitBytes')::integer,10485760) document_limit_bytes
       from app_settings where settings_key='application'`,
    );
    const documentLimitBytes = settings.rows[0]?.document_limit_bytes;
    if (documentLimitBytes === undefined)
      throw new AppError(500, "SETTINGS_UNAVAILABLE", "La configuración no está disponible.");
    const info = inspectDocument(file.originalname, file.mimetype, file.buffer, documentLimitBytes);
    let savedKey: string | undefined;
    try {
      return await inTransaction(
        this.pool,
        async (c) =>
          (
            await idempotentMutation(
              c,
              {
                actorUserId: actor.userId,
                key: meta.idempotencyKey,
                operation: `document.create:${accountId}`,
                request: { categoryId, visitId, taskId, checksum: info.checksum },
                statusCode: 202,
              },
              async () => {
                const account = await c.query<{ id: string }>(
                  `select a.id from commercial_accounts a where a.id=$1 ${actor.role === "SUPERVISOR" ? "and a.owner_user_id=$2" : ""} for update`,
                  actor.role === "SUPERVISOR" ? [accountId, actor.userId] : [accountId],
                );
                if (!account.rows[0])
                  throw new AppError(404, "ACCOUNT_NOT_FOUND", "La cuenta no está disponible.");
                const cat = await c.query(
                  "select id from document_categories where id=$1 and active for share",
                  [categoryId],
                );
                if (!cat.rows[0])
                  throw new AppError(
                    422,
                    "DOCUMENT_CATEGORY_INVALID",
                    "La categoría no está activa.",
                  );
                if (visitId || taskId) {
                  const table = visitId ? "visits" : "tasks",
                    context = visitId ?? taskId;
                  const found = await c.query(
                    `select id from ${table} where id=$1 and account_id=$2`,
                    [context, accountId],
                  );
                  if (!found.rows[0])
                    throw new AppError(
                      422,
                      "DOCUMENT_CONTEXT_INVALID",
                      "El contexto debe pertenecer a la cuenta.",
                    );
                }
                savedKey = await this.storage.saveQuarantine(file.buffer);
                const id = randomUUID();
                await c.query(
                  "insert into documents(id,account_id,visit_id,task_id,category_id,title,original_filename,storage_key,format,mime_type,size_bytes,checksum_sha256,status,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'QUARANTINED',$13,$13)",
                  [
                    id,
                    accountId,
                    visitId ?? null,
                    taskId ?? null,
                    categoryId,
                    file.originalname.slice(0, 200),
                    file.originalname.slice(0, 255),
                    savedKey,
                    info.format,
                    info.mimeType,
                    file.size,
                    info.checksum,
                    actor.userId,
                  ],
                );
                const row = await this.get(id, actor, c);
                await writeAudit(c, {
                  actorUserId: actor.userId,
                  action: "DOCUMENT_QUARANTINED",
                  entityType: "document",
                  entityId: id,
                  requestId: meta.requestId,
                  deviceId: actor.deviceId,
                  ipAddress: meta.ipAddress,
                  after: {
                    accountId,
                    categoryId,
                    format: info.format,
                    sizeBytes: file.size,
                    checksum: info.checksum,
                    status: "QUARANTINED",
                  },
                });
                return map(row);
              },
            )
          ).value,
      );
    } catch (error) {
      if (savedKey !== undefined) await this.storage.delete(savedKey).catch(() => undefined);
      throw error;
    }
  }
  async trash(id: string, actor: Actor, meta: RequestMeta) {
    return this.changeDeleted(id, actor, meta, true);
  }
  async restore(id: string, actor: Actor, meta: RequestMeta) {
    return this.changeDeleted(id, actor, meta, false);
  }
  private async changeDeleted(id: string, actor: Actor, meta: RequestMeta, deleted: boolean) {
    return inTransaction(
      this.pool,
      async (c) =>
        (
          await idempotentMutation(
            c,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `document.${deleted ? "delete" : "restore"}:${id}`,
              request: {},
              statusCode: 200,
            },
            async () => {
              const before = await this.get(id, actor, c, true);
              if (deleted && before.status !== "AVAILABLE")
                throw new AppError(
                  409,
                  "DOCUMENT_NOT_AVAILABLE",
                  "Solo se puede eliminar un documento disponible.",
                );
              if (
                !deleted &&
                (before.status !== "DELETED" ||
                  !before.deleted_at ||
                  Date.now() - before.deleted_at.getTime() > 30 * 86400000)
              )
                throw new AppError(
                  409,
                  "DOCUMENT_RESTORE_UNAVAILABLE",
                  "El documento no se puede restaurar.",
                );
              const result = await c.query<Row>(
                `update documents set status=$2,deleted_at=${deleted ? "now()" : "null"},deleted_by=${deleted ? "$3" : "null"},version=version+1,updated_at=now(),updated_by=$3 where id=$1 returning *`,
                [id, deleted ? "DELETED" : "AVAILABLE", actor.userId],
              );
              await writeAudit(c, {
                actorUserId: actor.userId,
                action: deleted ? "DOCUMENT_TRASHED" : "DOCUMENT_RESTORED",
                entityType: "document",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before: { status: before.status },
                after: { status: deleted ? "DELETED" : "AVAILABLE" },
              });
              return map({ ...result.rows[0]!, category_name: before.category_name });
            },
          )
        ).value,
    );
  }
}
