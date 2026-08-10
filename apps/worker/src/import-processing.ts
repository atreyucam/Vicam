import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseClient, DatabasePoolClient } from "@vicam/db";
import ExcelJS from "exceljs";
import { z } from "zod";

import type { WorkerConfig } from "./config.js";

type DbPool = DatabaseClient["pool"];
type RecordRow = Record<string, string>;

const emailSchema = z.string().email().max(320);
const uuidSchema = z.uuid();
const normalizedImportSchema = z.object({
  displayName: z.string().min(1).max(200),
  legalName: z.string().max(250).nullable(),
  accountType: z.string().min(1).max(50),
  ownerUserId: z.uuid(),
  countryCode: z.string().length(2),
  stateProvince: z.string().max(150).nullable(),
  city: z.string().min(1).max(150),
  address: z.string().nullable(),
  postalCode: z.string().max(30).nullable(),
  phone: z.string().max(50).nullable(),
  email: z.string().email().max(320).nullable(),
  timezone: z.string().max(100).nullable(),
  targetAccountId: z.uuid().nullable(),
  contact: z
    .object({
      fullName: z.string().min(1).max(200),
      title: z.string().max(150).nullable(),
      phone: z.string().max(50).nullable(),
      email: z.string().email().max(320).nullable(),
      notes: z.string().nullable(),
      isPrimary: z.boolean(),
    })
    .nullable(),
  fruitIds: z.array(z.uuid()),
  fruitsProvided: z.boolean(),
});

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return "";
}

export function parseCsv(text: string): RecordRow[] {
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim().replace(/\r$/, ""));
      if (row.some(Boolean)) table.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field.trim().replace(/\r$/, ""));
  if (row.some(Boolean)) table.push(row);
  if (quoted || table.length < 2) return [];
  const headers = table[0]!.map((header) => header.trim());
  return table
    .slice(1)
    .filter((values) => values.some(Boolean))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

export async function readImportRecords(path: string, format: string): Promise<RecordRow[]> {
  const data = await readFile(path);
  if (format === "CSV") return parseCsv(data.toString("utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((entry) => scalar(entry).trim());
  const records: RecordRow[] = [];
  sheet.eachRow((sheetRow, number) => {
    if (number <= 1) return;
    const values = (sheetRow.values as unknown[]).slice(1);
    if (values.some((entry) => scalar(entry).trim()))
      records.push(
        Object.fromEntries(headers.map((header, index) => [header, scalar(values[index]).trim()])),
      );
  });
  return records;
}

const get = (record: RecordRow, name: string) =>
  record[name] ?? record[name[0]!.toLowerCase() + name.slice(1)] ?? "";
const nullable = (value: string) => (value.trim() ? value.trim() : null);
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
const truthy = (value: string) => ["1", "true", "si", "sí", "yes"].includes(normalize(value));
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function writeErrorFile(
  operationsRoot: string,
  rows: { rowNumber: number; errors: string[] }[],
) {
  if (!rows.length) return null;
  const key = crypto.randomUUID();
  const folder = join(operationsRoot, "import-errors");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = join(folder, key);
  const temporary = join(folder, `.${key}.tmp`);
  const body = [
    "rowNumber,errors",
    ...rows.map((row) => `${row.rowNumber},${csvCell(row.errors.join(" | "))}`),
  ].join("\r\n");
  await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
  return `import-errors/${key}`;
}

type ExistingAccount = {
  id: string;
  display_name: string;
  legal_name: string | null;
  account_type: string;
  owner_user_id: string;
  country_code: string;
  state_province: string | null;
  city: string;
  address: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
};

export async function validateImport(pool: DbPool, batchId: string, operationsRoot: string) {
  const claimed = await pool.query<{
    storage_key: string;
    format: string;
    requester_user_id: string;
  }>(
    `update import_batches set status='VALIDATING',updated_at=now()
     where id=$1 and status='UPLOADED'
     returning storage_key,format,requester_user_id`,
    [batchId],
  );
  const batch = claimed.rows[0];
  if (!batch) return;
  try {
    const records = await readImportRecords(join(operationsRoot, batch.storage_key), batch.format);
    const seenNames = new Set<string>();
    const preview: {
      id: string;
      rowNumber: number;
      action: "CREATE" | "UPDATE" | "SKIP" | "ERROR";
      errors: string[];
      duplicate: string | null;
      values: z.infer<typeof normalizedImportSchema> | RecordRow;
    }[] = [];

    for (let index = 0; index < records.length; index += 1) {
      const source = records[index]!;
      const errors: string[] = [];
      const displayName = get(source, "displayName").trim();
      const accountType = get(source, "accountType").trim();
      const ownerUserId = get(source, "ownerUserId").trim() || batch.requester_user_id;
      const countryCode = get(source, "countryCode").trim().toUpperCase();
      const city = get(source, "city").trim();
      const phone = nullable(get(source, "phone"));
      const email = nullable(get(source, "email").toLocaleLowerCase());
      const nameKey = normalize(displayName);
      if (!displayName) errors.push("displayName es obligatorio.");
      if (displayName.length > 200) errors.push("displayName supera 200 caracteres.");
      if (!accountType || accountType.length > 50) errors.push("accountType es inválido.");
      if (!uuidSchema.safeParse(ownerUserId).success) errors.push("ownerUserId debe ser UUID.");
      if (countryCode.length !== 2) errors.push("countryCode debe tener dos caracteres.");
      if (!city || city.length > 150) errors.push("city es inválida.");
      if (!phone && !email) errors.push("Se requiere phone o email.");
      if (email && !emailSchema.safeParse(email).success) errors.push("email es inválido.");
      if (nameKey && seenNames.has(nameKey))
        errors.push("displayName está duplicado dentro del archivo.");
      if (nameKey) seenNames.add(nameKey);

      const owner = uuidSchema.safeParse(ownerUserId).success
        ? await pool.query<{ id: string }>(
            "select id from users where id=$1 and status='ACTIVE' limit 1",
            [ownerUserId],
          )
        : { rows: [] };
      if (uuidSchema.safeParse(ownerUserId).success && !owner.rows[0])
        errors.push("ownerUserId no corresponde a un usuario activo.");

      const contactName = get(source, "contactName").trim();
      const contactPhone = nullable(get(source, "contactPhone"));
      const contactEmail = nullable(get(source, "contactEmail").toLocaleLowerCase());
      const hasContact = Boolean(
        contactName || contactPhone || contactEmail || get(source, "contactTitle"),
      );
      if (hasContact && !contactName) errors.push("contactName es obligatorio para el contacto.");
      if (hasContact && !contactPhone && !contactEmail)
        errors.push("El contacto requiere contactPhone o contactEmail.");
      if (contactEmail && !emailSchema.safeParse(contactEmail).success)
        errors.push("contactEmail es inválido.");

      const fruitsProvided = Object.hasOwn(source, "fruits");
      const fruitNames = get(source, "fruits")
        .split(/[;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const fruitIds: string[] = [];
      for (const fruitName of [...new Set(fruitNames.map(normalize))]) {
        const fruit = await pool.query<{ id: string }>(
          "select id from fruits where normalized_name=lower(unaccent($1)) and active limit 1",
          [fruitName],
        );
        if (fruit.rows[0]) fruitIds.push(fruit.rows[0].id);
        else errors.push(`La fruta "${fruitName}" no existe o está inactiva.`);
      }

      const existing = displayName
        ? await pool.query<ExistingAccount>(
            `select id,display_name,legal_name,account_type,owner_user_id,country_code,
                    state_province,city,address,postal_code,phone,email,timezone
             from commercial_accounts
             where normalized_display_name=lower(unaccent($1)) and status='ACTIVE' limit 1`,
            [displayName],
          )
        : { rows: [] };
      const account = existing.rows[0];
      const normalized = {
        displayName,
        legalName: nullable(get(source, "legalName")),
        accountType,
        ownerUserId,
        countryCode,
        stateProvince: nullable(get(source, "stateProvince")),
        city,
        address: nullable(get(source, "address")),
        postalCode: nullable(get(source, "postalCode")),
        phone,
        email,
        timezone: nullable(get(source, "timezone")),
        targetAccountId: account?.id ?? null,
        contact: hasContact
          ? {
              fullName: contactName,
              title: nullable(get(source, "contactTitle")),
              phone: contactPhone,
              email: contactEmail,
              notes: nullable(get(source, "contactNotes")),
              isPrimary: truthy(get(source, "contactIsPrimary")),
            }
          : null,
        fruitIds,
        fruitsProvided,
      };
      const parsed = normalizedImportSchema.safeParse(normalized);
      if (!parsed.success)
        errors.push(
          ...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        );

      let action: "CREATE" | "UPDATE" | "SKIP" | "ERROR" = account ? "UPDATE" : "CREATE";
      if (errors.length) action = "ERROR";
      else if (account) {
        const accountChanged =
          account.display_name !== normalized.displayName ||
          account.legal_name !== normalized.legalName ||
          account.account_type !== normalized.accountType ||
          account.owner_user_id !== normalized.ownerUserId ||
          account.country_code !== normalized.countryCode ||
          account.state_province !== normalized.stateProvince ||
          account.city !== normalized.city ||
          account.address !== normalized.address ||
          account.postal_code !== normalized.postalCode ||
          account.phone !== normalized.phone ||
          account.email !== normalized.email ||
          account.timezone !== normalized.timezone;
        const contactChanged = normalized.contact
          ? (
              await pool.query(
                `select 1 from commercial_contacts
                 where account_id=$1 and normalized_full_name=lower(unaccent($2))
                   and phone is not distinct from $3 and email is not distinct from $4
                   and deleted_at is null limit 1`,
                [
                  account.id,
                  normalized.contact.fullName,
                  normalized.contact.phone,
                  normalized.contact.email,
                ],
              )
            ).rowCount === 0
          : false;
        const fruitChanged = fruitsProvided
          ? (
              await pool.query<{ same: boolean }>(
                `select coalesce(array_agg(fruit_id order by fruit_id),'{}'::uuid[]) = $2::uuid[] same
                 from commercial_account_fruits where account_id=$1`,
                [account.id, [...fruitIds].sort()],
              )
            ).rows[0]?.same !== true
          : false;
        if (!accountChanged && !contactChanged && !fruitChanged) action = "SKIP";
      }
      preview.push({
        id: crypto.randomUUID(),
        rowNumber: index + 2,
        action,
        errors,
        duplicate: account?.id ?? null,
        values: parsed.success ? parsed.data : source,
      });
    }

    const errorStorageKey = await writeErrorFile(
      operationsRoot,
      preview.filter((row) => row.errors.length),
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from import_rows where batch_id=$1", [batchId]);
      for (const row of preview)
        await client.query(
          `insert into import_rows
             (id,batch_id,row_number,action,errors,duplicate_of_account_id,values_json)
           values($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id,
            batchId,
            row.rowNumber,
            row.action,
            JSON.stringify(row.errors),
            row.duplicate,
            JSON.stringify(row.values),
          ],
        );
      const counts = { CREATE: 0, UPDATE: 0, SKIP: 0, ERROR: 0 };
      for (const row of preview) counts[row.action] += 1;
      await client.query(
        `update import_batches
         set status='READY',confirmation_id=$2,total_rows=$3,create_rows=$4,update_rows=$5,
             skip_rows=$6,error_rows=$7,error_storage_key=$8,updated_at=now()
         where id=$1`,
        [
          batchId,
          crypto.randomUUID(),
          preview.length,
          counts.CREATE,
          counts.UPDATE,
          counts.SKIP,
          counts.ERROR,
          errorStorageKey,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if (errorStorageKey)
        await rm(join(operationsRoot, errorStorageKey), { force: true }).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.query(
      "update import_batches set status='FAILED',updated_at=now() where id=$1 and status='VALIDATING'",
      [batchId],
    );
    throw error;
  }
}

async function applyContact(
  client: DatabasePoolClient,
  accountId: string,
  contact: z.infer<typeof normalizedImportSchema>["contact"],
  actorId: string,
) {
  if (!contact) return;
  const existing = await client.query<{ id: string; is_primary: boolean }>(
    `select id,is_primary from commercial_contacts
     where account_id=$1 and normalized_full_name=lower(unaccent($2)) and deleted_at is null
     for update`,
    [accountId, contact.fullName],
  );
  const hasContacts = await client.query<{ count: number }>(
    "select count(*)::integer count from commercial_contacts where account_id=$1 and deleted_at is null",
    [accountId],
  );
  const makePrimary = contact.isPrimary || (hasContacts.rows[0]?.count ?? 0) === 0;
  const effectivePrimary = makePrimary || existing.rows[0]?.is_primary === true;
  if (makePrimary)
    await client.query(
      "update commercial_contacts set is_primary=false,version=version+1,updated_at=now(),updated_by=$2 where account_id=$1 and is_primary and deleted_at is null",
      [accountId, actorId],
    );
  if (existing.rows[0])
    await client.query(
      `update commercial_contacts
       set full_name=$2,normalized_full_name=lower(unaccent($2)),title=$3,phone=$4,email=$5,
           notes=$6,is_primary=$7,version=version+1,updated_at=now(),updated_by=$8
       where id=$1`,
      [
        existing.rows[0].id,
        contact.fullName,
        contact.title,
        contact.phone,
        contact.email,
        contact.notes,
        effectivePrimary,
        actorId,
      ],
    );
  else
    await client.query(
      `insert into commercial_contacts
         (id,account_id,full_name,normalized_full_name,title,phone,email,notes,is_primary,created_by,updated_by)
       values($1,$2,$3,lower(unaccent($3)),$4,$5,$6,$7,$8,$9,$9)`,
      [
        crypto.randomUUID(),
        accountId,
        contact.fullName,
        contact.title,
        contact.phone,
        contact.email,
        contact.notes,
        effectivePrimary,
        actorId,
      ],
    );
}

export async function commitImport(pool: DbPool, batchId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const batch = await client.query<{
      requester_user_id: string;
      status: string;
      confirmation_id: string;
    }>(
      "select requester_user_id,status,confirmation_id from import_batches where id=$1 for update",
      [batchId],
    );
    const current = batch.rows[0];
    if (current?.status !== "CONFIRMING") {
      await client.query("rollback");
      return;
    }
    const rows = await client.query<{
      id: string;
      action: "CREATE" | "UPDATE";
      values_json: unknown;
    }>(
      `select id,action,values_json from import_rows
       where batch_id=$1 and action in ('CREATE','UPDATE') and applied_at is null
       order by row_number for update`,
      [batchId],
    );
    for (const row of rows.rows) {
      const value = normalizedImportSchema.parse(row.values_json);
      const owner = await client.query(
        "select id from users where id=$1 and status='ACTIVE' for share",
        [value.ownerUserId],
      );
      if (!owner.rows[0]) throw new Error("IMPORT_OWNER_UNAVAILABLE");
      const accountId = row.action === "CREATE" ? crypto.randomUUID() : value.targetAccountId!;
      if (row.action === "CREATE")
        await client.query(
          `insert into commercial_accounts
             (id,display_name,normalized_display_name,legal_name,account_type,owner_user_id,
              country_code,state_province,city,address,postal_code,phone,email,timezone,
              created_by,updated_by)
           values($1,$2::text,lower(unaccent($2::text)),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
          [
            accountId,
            value.displayName,
            value.legalName,
            value.accountType,
            value.ownerUserId,
            value.countryCode,
            value.stateProvince,
            value.city,
            value.address,
            value.postalCode,
            value.phone,
            value.email,
            value.timezone,
            current.requester_user_id,
          ],
        );
      else {
        const locked = await client.query(
          "select id from commercial_accounts where id=$1 and status='ACTIVE' for update",
          [accountId],
        );
        if (!locked.rows[0]) throw new Error("IMPORT_ACCOUNT_UNAVAILABLE");
        await client.query(
          `update commercial_accounts
           set display_name=$2::text,normalized_display_name=lower(unaccent($2::text)),legal_name=$3,
               account_type=$4,owner_user_id=$5,country_code=$6,state_province=$7,city=$8,
               address=$9,postal_code=$10,phone=$11,email=$12,timezone=$13,
               version=version+1,updated_at=now(),updated_by=$14
           where id=$1`,
          [
            accountId,
            value.displayName,
            value.legalName,
            value.accountType,
            value.ownerUserId,
            value.countryCode,
            value.stateProvince,
            value.city,
            value.address,
            value.postalCode,
            value.phone,
            value.email,
            value.timezone,
            current.requester_user_id,
          ],
        );
      }
      await applyContact(client, accountId, value.contact, current.requester_user_id);
      if (value.fruitsProvided) {
        await client.query("delete from commercial_account_fruits where account_id=$1", [
          accountId,
        ]);
        for (const fruitId of value.fruitIds)
          await client.query(
            `insert into commercial_account_fruits(account_id,fruit_id,created_by)
             select $1,f.id,$3 from fruits f where f.id=$2 and f.active`,
            [accountId, fruitId, current.requester_user_id],
          );
      }
      await client.query("update import_rows set applied_at=now() where id=$1", [row.id]);
    }
    await client.query(
      `update import_batches
       set status='COMPLETED',completed_at=now(),updated_at=now()
       where id=$1 and status='CONFIRMING'`,
      [batchId],
    );
    await client.query(
      `insert into audit_logs
         (id,actor_user_id,action,entity_type,entity_id,before_changes,after_changes,request_id)
       values($1,$2,'IMPORT_COMPLETED','import_batch',$3,null,$4,$5)`,
      [
        crypto.randomUUID(),
        current.requester_user_id,
        batchId,
        JSON.stringify({
          confirmationId: current.confirmation_id,
          appliedRows: rows.rowCount ?? 0,
        }),
        `worker-import-${batchId}`,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    await pool.query(
      "update import_batches set status='FAILED',updated_at=now() where id=$1 and status='CONFIRMING'",
      [batchId],
    );
    throw error;
  } finally {
    client.release();
  }
}

export function importOperationsRoot(config: WorkerConfig) {
  return join(config.DOCUMENT_STORAGE_ROOT, "operations");
}
