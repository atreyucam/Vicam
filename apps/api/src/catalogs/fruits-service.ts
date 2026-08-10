import { randomUUID } from "node:crypto";
import { createFruitRequestSchema, fruitSchema, updateFruitRequestSchema } from "@vicam/contracts";
import { z } from "zod";

import type { DbPool } from "../db.js";
import { idempotentMutation, inTransaction, writeAudit } from "../db.js";
import type { Actor, RequestMeta } from "../domain/shared.js";
import { normalizeSearch } from "../domain/shared.js";
import { AppError } from "../errors.js";

export { fruitSchema };
export const createFruitSchema = createFruitRequestSchema;
export const updateFruitSchema = updateFruitRequestSchema;

type FruitRow = z.infer<typeof fruitSchema>;

export class FruitsService {
  constructor(private readonly pool: DbPool) {}

  private manager(actor: Actor) {
    if (actor.role !== "MANAGER")
      throw new AppError(403, "MANAGER_REQUIRED", "No tiene permiso para administrar frutas.");
  }

  async list(actor: Actor, includeInactive = false) {
    if (includeInactive) this.manager(actor);
    const result = await this.pool.query<FruitRow>(
      `select id,name,active,version from fruits
       ${includeInactive ? "" : "where active"}
       order by normalized_name,id`,
    );
    return z.array(fruitSchema).parse(result.rows);
  }

  async create(input: z.infer<typeof createFruitSchema>, actor: Actor, meta: RequestMeta) {
    this.manager(actor);
    return inTransaction(this.pool, async (client) => {
      try {
        return (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: "fruit.create",
              request: input,
              statusCode: 201,
            },
            async () => {
              const id = randomUUID();
              const result = await client.query<FruitRow>(
                `insert into fruits(id,name,normalized_name,created_by,updated_by)
                 values($1,$2,$3,$4,$4) returning id,name,active,version`,
                [id, input.name, normalizeSearch(input.name), actor.userId],
              );
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "FRUIT_CREATED",
                entityType: "fruit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                after: { name: input.name, active: true, version: 1 },
              });
              return fruitSchema.parse(result.rows[0]);
            },
          )
        ).value;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "23505")
          throw new AppError(409, "FRUIT_DUPLICATE", "Ya existe una fruta con ese nombre.");
        throw error;
      }
    });
  }

  async update(
    id: string,
    input: z.infer<typeof updateFruitSchema>,
    actor: Actor,
    meta: RequestMeta,
  ) {
    this.manager(actor);
    return inTransaction(this.pool, async (client) => {
      try {
        return (
          await idempotentMutation(
            client,
            {
              actorUserId: actor.userId,
              key: meta.idempotencyKey,
              operation: `fruit.update:${id}`,
              request: input,
              statusCode: 200,
            },
            async () => {
              const previous = await client.query<FruitRow>(
                "select id,name,active,version from fruits where id=$1 for update",
                [id],
              );
              const before = previous.rows[0];
              if (!before)
                throw new AppError(404, "FRUIT_NOT_FOUND", "La fruta no está disponible.");
              const result = await client.query<FruitRow>(
                `update fruits
                 set name=coalesce($2,name),normalized_name=coalesce($3,normalized_name),
                     active=coalesce($4,active),version=version+1,updated_at=now(),updated_by=$5
                 where id=$1 and version=$6 returning id,name,active,version`,
                [
                  id,
                  input.name ?? null,
                  input.name === undefined ? null : normalizeSearch(input.name),
                  input.active ?? null,
                  actor.userId,
                  input.version,
                ],
              );
              const updated = result.rows[0];
              if (!updated)
                throw new AppError(
                  409,
                  "FRUIT_VERSION_CONFLICT",
                  "La fruta fue modificada por otra operación.",
                );
              await writeAudit(client, {
                actorUserId: actor.userId,
                action: "FRUIT_UPDATED",
                entityType: "fruit",
                entityId: id,
                requestId: meta.requestId,
                deviceId: actor.deviceId,
                ipAddress: meta.ipAddress,
                before,
                after: updated,
              });
              return fruitSchema.parse(updated);
            },
          )
        ).value;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "23505")
          throw new AppError(409, "FRUIT_DUPLICATE", "Ya existe una fruta con ese nombre.");
        throw error;
      }
    });
  }
}
