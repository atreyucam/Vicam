import { createConnection } from "node:net";
import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DatabaseClient } from "@vicam/db";
import type { PgBoss } from "pg-boss";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "pino";
import webpush from "web-push";
import { commitImport, importOperationsRoot, validateImport } from "./import-processing.js";
import { loadReportRecords, renderReport, type ReportExportJob } from "./reporting.js";

export function notificationResourceUrl(resourceType: string | null, resourceId: string | null) {
  if (resourceType === "visit" && resourceId) return `/app/visits/${resourceId}`;
  if (resourceType === "task" && resourceId) return `/app/tasks/${resourceId}`;
  if (resourceType === "report_export") return "/app/reports/exports";
  return "/app/notifications";
}

export async function clamScan(file: Buffer, config: WorkerConfig) {
  if (!config.CLAMD_HOST) throw new Error("CLAMD_NOT_CONFIGURED");
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: config.CLAMD_HOST, port: config.CLAMD_PORT });
    let result = "";
    socket.setTimeout(30_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < file.length; offset += 65536) {
        const chunk = file.subarray(offset, offset + 65536),
          size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (d) => (result += d.toString("utf8")));
    socket.on("end", () => resolve(/: OK\0?$/.test(result)));
    socket.on("timeout", () => socket.destroy(new Error("CLAMD_TIMEOUT")));
    socket.on("error", reject);
  });
}
type DbPool = DatabaseClient["pool"];
const operationsRoot = (config: WorkerConfig) =>
  join(resolve(config.DOCUMENT_STORAGE_ROOT), "operations");
async function writePrivate(config: WorkerConfig, folder: string, body: Buffer) {
  const key = crypto.randomUUID(),
    dir = join(operationsRoot(config), folder);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, key),
    temporary = join(dir, `.${key}.tmp`);
  await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
  return `${folder}/${key}`;
}
async function renderExport(pool: DbPool, exportId: string, config: WorkerConfig) {
  const exporting = await pool.query<ReportExportJob>(
    "update report_exports set status='PROCESSING',updated_at=now() where id=$1 and status='QUEUED' returning id,report_group,format,requester_user_id,requester_role,scope_user_id,timezone,filters,template",
    [exportId],
  );
  const item = exporting.rows[0];
  if (!item) return;
  try {
    const records = await loadReportRecords(pool, item);
    const body = await renderReport(item, records);
    const key = await writePrivate(config, "exports", body);
    await pool.query(
      "update report_exports set status='AVAILABLE',storage_key=$2,error_code=null,updated_at=now() where id=$1",
      [item.id, key],
    );
    await pool.query(
      "insert into notifications(id,user_id,type,title,body,resource_type,resource_id) values($1,$2,'REPORT_READY','Reporte disponible','La exportación solicitada está lista.','report_export',$3)",
      [crypto.randomUUID(), item.requester_user_id, item.id],
    );
  } catch {
    await pool.query(
      "update report_exports set status='FAILED',error_code='EXPORT_GENERATION_FAILED',updated_at=now() where id=$1",
      [exportId],
    );
  }
}
export async function deliverReminder(pool: DbPool, reminderId: string, config: WorkerConfig) {
  const client = await pool.connect();
  let row:
    | {
        id: string;
        user_id: string;
        title: string;
        body: string;
        resource_type: string;
        resource_id: string;
      }
    | undefined;
  try {
    await client.query("begin");
    const reminder = await client.query<NonNullable<typeof row>>(
      `select r.id,coalesce(v.responsible_user_id,t.responsible_user_id) user_id,
              case when r.visit_id is not null then 'Recordatorio de visita'
                   else 'Recordatorio de tarea' end title,
              case when r.visit_id is not null then 'Tiene una visita próxima.'
                   else 'Tiene una tarea próxima o vencida.' end body,
              case when r.visit_id is not null then 'visit' else 'task' end resource_type,
              coalesce(r.visit_id,r.task_id) resource_id
       from reminders r left join visits v on v.id=r.visit_id left join tasks t on t.id=r.task_id
       where r.id=$1 and r.scheduled_at<=now()
         and (r.status='PENDING' or (r.status='DELIVERED' and r.push_attempted_at is null))
       for update of r`,
      [reminderId],
    );
    row = reminder.rows[0];
    if (row) {
      await client.query(
        `insert into notifications(id,user_id,type,title,body,resource_type,resource_id,source_key)
         values($1,$2,'REMINDER',$3,$4,$5,$6,$7)
         on conflict(source_key) where source_key is not null do nothing`,
        [
          crypto.randomUUID(),
          row.user_id,
          row.title,
          row.body,
          row.resource_type,
          row.resource_id,
          `reminder:${row.id}`,
        ],
      );
      await client.query(
        "update reminders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),updated_at=now() where id=$1",
        [row.id],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  if (!row) return;
  if (!config.VAPID_SUBJECT || !config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    await pool.query("update reminders set push_attempted_at=now(),updated_at=now() where id=$1", [
      row.id,
    ]);
    return;
  }
  if (config.VAPID_SUBJECT && config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );
    const notification = await pool.query<{ id: string }>(
      "select id from notifications where source_key=$1",
      [`reminder:${row.id}`],
    );
    const notificationId = notification.rows[0]?.id;
    if (!notificationId) throw new Error("REMINDER_NOTIFICATION_UNAVAILABLE");
    await pool.query(
      `insert into notification_push_deliveries(notification_id,subscription_id)
       select $1,id from push_subscriptions
       where user_id=$2 and (expires_at is null or expires_at>now())
       on conflict do nothing`,
      [notificationId, row.user_id],
    );
    const subscriptions = await pool.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `select s.id,s.endpoint,s.p256dh,s.auth
       from notification_push_deliveries d join push_subscriptions s on s.id=d.subscription_id
       where d.notification_id=$1 and d.status='PENDING' order by s.id`,
      [notificationId],
    );
    let transientFailure = false;
    for (const sub of subscriptions.rows)
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: row.title,
            body: row.body,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            url: notificationResourceUrl(row.resource_type, row.resource_id),
          }),
        );
        await pool.query(
          `update notification_push_deliveries
           set status='SENT',attempt_count=attempt_count+1,last_attempt_at=now(),last_error_code=null
           where notification_id=$1 and subscription_id=$2`,
          [notificationId, sub.id],
        );
      } catch (error) {
        const status = error as { statusCode?: number };
        if (status.statusCode === 404 || status.statusCode === 410)
          await pool.query("delete from push_subscriptions where id=$1", [sub.id]);
        else {
          transientFailure = true;
          await pool.query(
            `update notification_push_deliveries
             set attempt_count=attempt_count+1,last_attempt_at=now(),last_error_code=$3
             where notification_id=$1 and subscription_id=$2`,
            [
              notificationId,
              sub.id,
              status.statusCode ? `HTTP_${status.statusCode}` : "PUSH_ERROR",
            ],
          );
        }
      }
    if (transientFailure) throw new Error("PUSH_DELIVERY_RETRY");
    await pool.query("update reminders set push_attempted_at=now(),updated_at=now() where id=$1", [
      row.id,
    ]);
  }
}

export async function runRetentionCleanup(pool: DbPool, config: WorkerConfig) {
  await pool.query(
    `delete from notifications
     where id in (
       select id from notifications
       where created_at<=now()-interval '30 days'
       order by created_at
       limit 5000
     )`,
  );

  const documents = await pool.query<{ id: string; storage_key: string }>(
    `select id,storage_key from documents
     where status='DELETED' and deleted_at<=now()-interval '30 days'
     order by deleted_at limit 500`,
  );
  for (const document of documents.rows) {
    await rm(join(resolve(config.DOCUMENT_STORAGE_ROOT), "documents", document.storage_key), {
      force: true,
    });
    await pool.query(
      "delete from documents where id=$1 and status='DELETED' and deleted_at<=now()-interval '30 days'",
      [document.id],
    );
  }

  const exports = await pool.query<{ id: string; storage_key: string | null }>(
    `select id,storage_key from report_exports
     where expires_at<=now() and status<>'EXPIRED'
     order by expires_at limit 500`,
  );
  for (const item of exports.rows) {
    if (item.storage_key) await rm(join(operationsRoot(config), item.storage_key), { force: true });
    await pool.query(
      `update report_exports set status='EXPIRED',storage_key=null,updated_at=now()
       where id=$1 and expires_at<=now()`,
      [item.id],
    );
  }

  const imports = await pool.query<{
    id: string;
    storage_key: string;
    error_storage_key: string | null;
  }>(
    `select id,storage_key,error_storage_key from import_batches
     where status in ('COMPLETED','FAILED') and updated_at<=now()-interval '30 days'
     order by updated_at limit 100`,
  );
  for (const batch of imports.rows) {
    await rm(join(operationsRoot(config), batch.storage_key), { force: true });
    if (batch.error_storage_key)
      await rm(join(operationsRoot(config), batch.error_storage_key), { force: true });
    await pool.query(
      `delete from import_batches
       where id=$1 and status in ('COMPLETED','FAILED')
         and updated_at<=now()-interval '30 days'`,
      [batch.id],
    );
  }

  await pool.query("delete from mutation_idempotency where expires_at<=now()");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local vicam.retention_cleanup='on'");
    await client.query(
      `delete from audit_logs
       where (retention_class='FUNCTIONAL' and occurred_at<=now()-interval '5 years')
          or (retention_class='SECURITY' and occurred_at<=now()-interval '1 year')`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const phase3Queues = [
  "import-validate",
  "import-commit",
  "report-pdf",
  "report-xlsx",
  "reminder-delivery",
  "document-scan",
  "retention-cleanup",
] as const;

export async function registerPhase3Jobs(
  boss: PgBoss,
  pool: DbPool,
  config: WorkerConfig,
  logger: Logger,
) {
  for (const queue of phase3Queues) {
    await boss.createQueue(queue, {
      retentionSeconds: 90 * 24 * 60 * 60,
      deleteAfterSeconds: 90 * 24 * 60 * 60,
    });
    await boss.updateQueue(queue, {
      retentionSeconds: 90 * 24 * 60 * 60,
      deleteAfterSeconds: 90 * 24 * 60 * 60,
    });
  }
  void boss.work("import-validate", async (jobs) => {
    for (const job of jobs)
      await validateImport(
        pool,
        (job.data as { batchId: string }).batchId,
        importOperationsRoot(config),
      );
  });
  void boss.work("import-commit", async (jobs) => {
    for (const job of jobs) await commitImport(pool, (job.data as { batchId: string }).batchId);
  });
  void boss.work("report-pdf", async (jobs) => {
    for (const job of jobs)
      await renderExport(pool, (job.data as { exportId: string }).exportId, config);
  });
  void boss.work("report-xlsx", async (jobs) => {
    for (const job of jobs)
      await renderExport(pool, (job.data as { exportId: string }).exportId, config);
  });
  void boss.work("reminder-delivery", async (jobs) => {
    for (const job of jobs)
      await deliverReminder(pool, (job.data as { reminderId: string }).reminderId, config);
  });
  void boss.work("document-scan", async (jobs) => {
    for (const job of jobs) {
      const id = (job.data as { documentId: string }).documentId;
      const row = await pool.query<{ storage_key: string }>(
        "update documents set status='SCANNING',updated_at=now() where id=$1 and status='QUARANTINED' returning storage_key",
        [id],
      );
      if (!row.rows[0]) continue;
      try {
        const data = await readFile(
          join(resolve(config.DOCUMENT_STORAGE_ROOT), "documents", row.rows[0].storage_key),
        );
        const clean = await clamScan(data, config);
        await pool.query(
          "update documents set status=$2,scanned_at=now(),rejected_reason=$3,updated_at=now() where id=$1",
          [id, clean ? "AVAILABLE" : "REJECTED", clean ? null : "MALWARE_OR_SCAN_REJECTED"],
        );
        if (!clean)
          await rm(
            join(resolve(config.DOCUMENT_STORAGE_ROOT), "documents", row.rows[0].storage_key),
            { force: true },
          );
      } catch (error) {
        await pool.query(
          "update documents set status='QUARANTINED',scanned_at=null,rejected_reason='SCAN_UNAVAILABLE',updated_at=now() where id=$1",
          [id],
        );
        logger.warn(
          { documentId: id, errorName: error instanceof Error ? error.name : "unknown" },
          "document scan rejected",
        );
      }
    }
  });
  void boss.work("retention-cleanup", async () => runRetentionCleanup(pool, config));
  setInterval(() => {
    void pool
      .query<{ id: string }>(
        "select id from documents where status='QUARANTINED' order by created_at limit 50",
      )
      .then((r: { rows: { id: string }[] }) =>
        Promise.all(
          r.rows.map((row: { id: string }) =>
            boss.send("document-scan", { documentId: row.id }, { singletonKey: row.id }),
          ),
        ),
      )
      .catch((e: unknown) =>
        logger.warn({ errorName: e instanceof Error ? e.name : "unknown" }, "phase3 sweep failed"),
      );
    void boss
      .send(
        "retention-cleanup",
        {},
        { singletonKey: "daily-retention", startAfter: new Date(Date.now() + 60_000) },
      )
      .catch(() => undefined);
    void pool
      .query<{ id: string }>(
        "select id from reminders where status='PENDING' and scheduled_at<=now() order by scheduled_at limit 100",
      )
      .then((result) =>
        Promise.all(
          result.rows.map((row) =>
            boss.send(
              "reminder-delivery",
              { reminderId: row.id },
              { singletonKey: row.id, retryLimit: 5, retryDelay: 30, retryBackoff: true },
            ),
          ),
        ),
      )
      .catch(() => undefined);
    void pool
      .query<{ id: string }>(
        "select id from import_batches where status='UPLOADED' order by created_at limit 10",
      )
      .then((result) =>
        Promise.all(
          result.rows.map((row) =>
            boss.send(
              "import-validate",
              { batchId: row.id },
              { singletonKey: row.id, retryLimit: 3, retryDelay: 30 },
            ),
          ),
        ),
      )
      .catch(() => undefined);
    void pool
      .query<{ id: string }>(
        "select id from import_batches where status='CONFIRMING' order by updated_at limit 10",
      )
      .then((result) =>
        Promise.all(
          result.rows.map((row) =>
            boss.send(
              "import-commit",
              { batchId: row.id },
              { singletonKey: row.id, retryLimit: 3, retryDelay: 30 },
            ),
          ),
        ),
      )
      .catch(() => undefined);
    void pool
      .query<{ id: string; format: string }>(
        "select id,format from report_exports where status='QUEUED' and expires_at>now() order by created_at limit 10",
      )
      .then((result) =>
        Promise.all(
          result.rows.map((row) =>
            boss.send(
              row.format === "PDF" ? "report-pdf" : "report-xlsx",
              { exportId: row.id },
              { singletonKey: row.id, retryLimit: 3, retryDelay: 30, retryBackoff: true },
            ),
          ),
        ),
      )
      .catch(() => undefined);
  }, 30_000).unref();
}
