import { randomUUID } from "node:crypto";
import {
  documentCategorySchema,
  type createDocumentCategoryRequestSchema,
  type updateDocumentCategoryRequestSchema,
} from "@vicam/contracts";
import type { z } from "zod";
import type { DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { normalizeSearch } from "../domain/shared.js";
import { AppError } from "../errors.js";
type Create = z.infer<typeof createDocumentCategoryRequestSchema>;
type Update = z.infer<typeof updateDocumentCategoryRequestSchema>;
type CategoryRow = { id: string; name: string; active: boolean; version: number };
const map = (row: CategoryRow) =>
  documentCategorySchema.parse({
    id: row.id,
    name: row.name,
    active: row.active,
    version: row.version,
  });
export class DocumentCategoriesService {
  constructor(private readonly pool: DbPool) {}
  private manager(actor: Actor) {
    if (actor.role !== "MANAGER")
      throw new AppError(403, "MANAGER_REQUIRED", "No tiene permiso para administrar categorías.");
  }
  async list(actor: Actor) {
    this.manager(actor);
    return (
      await this.pool.query<CategoryRow>(
        "select id,name,active,version from document_categories order by normalized_name,id",
      )
    ).rows.map((r) => map(r));
  }
  async create(input: Create, actor: Actor, meta: RequestMeta) {
    this.manager(actor);
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: "document-category.create",
              request: input,
              statusCode: 201,
            },
            async () => {
              const id = randomUUID();
              try {
                const result = await client.query<CategoryRow>(
                  "insert into document_categories(id,name,normalized_name,created_by,updated_by) values($1,$2,$3,$4,$4) returning id,name,active,1 version",
                  [id, input.name, normalizeSearch(input.name), actor.userId],
                );
                await writeAudit(client, {
                  actorUserId: actor.userId,
                  action: "DOCUMENT_CATEGORY_CREATED",
                  entityType: "document_category",
                  entityId: id,
                  requestId: meta.requestId,
                  deviceId: actor.deviceId,
                  ipAddress: meta.ipAddress,
                  after: { name: input.name, active: true, version: 1 },
                });
                return map(result.rows[0]!);
              } catch (error) {
                if (error instanceof Error && "code" in error && error.code === "23505")
                  throw new AppError(
                    409,
                    "DOCUMENT_CATEGORY_DUPLICATE",
                    "Ya existe una categoría con ese nombre.",
                  );
                throw error;
              }
            },
          )
        ).value,
    );
  }
  async update(id: string, input: Update, actor: Actor, meta: RequestMeta) {
    this.manager(actor);
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `document-category.update:${id}`,
              request: input,
              statusCode: 200,
            },
            async () => {
              const previous = await client.query<CategoryRow>(
                "select id,name,active,version from document_categories where id=$1 for update",
                [id],
              );
              if (!previous.rows[0])
                throw new AppError(
                  404,
                  "DOCUMENT_CATEGORY_NOT_FOUND",
                  "La categoría no está disponible.",
                );
              const row = previous.rows[0];
              const result = await client.query<CategoryRow>(
                "update document_categories set name=coalesce($2,name),normalized_name=coalesce($3,normalized_name),active=coalesce($4,active),version=version+1,updated_at=now(),updated_by=$5 where id=$1 and version=$6 returning id,name,active,version",
                [
                  id,
                  input.name ?? null,
                  input.name === undefined ? null : normalizeSearch(input.name),
                  input.active ?? null,
                  actor.userId,
                  input.version,
                ],
              );
              if (!result.rows[0])
                throw new AppError(
                  409,
                  "DOCUMENT_CATEGORY_VERSION_CONFLICT",
                  "La categoría fue modificada por otra operación.",
                );
              const value = map(result.rows[0]);
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "DOCUMENT_CATEGORY_UPDATED",
                entityType: "document_category",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before: { name: row.name, active: row.active, version: row.version },
                after: { name: value.name, active: value.active, version: value.version },
              });
              return value;
            },
          )
        ).value,
    );
  }
}
