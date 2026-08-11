import type { DatabaseClient } from "@vicam/db";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

type DbPool = DatabaseClient["pool"];

export type ReportExportJob = {
  id: string;
  report_group: "VISITS" | "TASKS" | "ACCOUNTS" | "DOCUMENTS" | "MANAGEMENT";
  format: "PDF" | "XLSX";
  requester_user_id: string;
  requester_role: "MANAGER" | "SUPERVISOR";
  scope_user_id: string | null;
  timezone: string;
  filters: Record<string, unknown>;
  template: string;
};

export type ReportRecord = Record<string, string>;

const scalar = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return "";
};

function addFilter(
  where: string[],
  values: unknown[],
  expression: (placeholder: string) => string,
  value: unknown,
) {
  if (value === undefined) return;
  values.push(value);
  where.push(expression(`$${values.length}`));
}

function dateFilters(
  alias: string,
  filters: Record<string, unknown>,
  timezonePlaceholder: string,
  where: string[],
  values: unknown[],
) {
  addFilter(
    where,
    values,
    (p) => `${alias} >= (${p}::date::timestamp at time zone ${timezonePlaceholder})`,
    filters.from,
  );
  addFilter(
    where,
    values,
    (p) => `${alias} < (((${p}::date + 1)::timestamp) at time zone ${timezonePlaceholder})`,
    filters.to,
  );
}

export async function loadReportRecords(pool: DbPool, item: ReportExportJob) {
  const user = await pool.query<{ role: "MANAGER" | "SUPERVISOR" }>(
    "select role from users where id=$1 and status='ACTIVE'",
    [item.requester_user_id],
  );
  const currentRole = user.rows[0]?.role;
  if (!currentRole) throw new Error("REQUESTER_UNAVAILABLE");
  const scoped =
    item.requester_role === "SUPERVISOR" ||
    currentRole === "SUPERVISOR" ||
    item.scope_user_id !== null;
  const scopeUserId = scoped ? (item.scope_user_id ?? item.requester_user_id) : null;
  if (item.report_group === "MANAGEMENT" && scoped)
    throw new Error("MANAGEMENT_REPORT_MANAGER_ONLY");

  const filters = item.filters ?? {};
  const values: unknown[] = [];
  const where: string[] = [];
  let sql: string;

  if (item.report_group === "VISITS") {
    values.push(item.timezone);
    if (scopeUserId) {
      values.push(scopeUserId);
      where.push(`v.responsible_user_id=$${values.length} and a.owner_user_id=$${values.length}`);
    }
    dateFilters("v.scheduled_at", filters, "$1", where, values);
    addFilter(where, values, (p) => `v.responsible_user_id=${p}`, filters.responsibleUserId);
    addFilter(where, values, (p) => `v.account_id=${p}`, filters.accountId);
    addFilter(where, values, (p) => `a.city=${p}`, filters.city);
    addFilter(where, values, (p) => `v.status=${p}`, filters.status);
    addFilter(where, values, (p) => `v.priority=${p}`, filters.priority);
    if (item.template === "completed") where.push("v.status='COMPLETED'");
    if (item.template === "cancelled-rescheduled")
      where.push(
        "(v.status='CANCELLED' or exists(select 1 from visit_reschedules vr where vr.visit_id=v.id))",
      );
    if (item.template === "productivity")
      where.push("v.status='COMPLETED' and v.actual_ended_at is not null");
    sql = `select to_char(v.scheduled_at at time zone $1,'YYYY-MM-DD HH24:MI') fecha_programada,
                  case when v.actual_ended_at is null then '' else to_char(v.actual_ended_at at time zone $1,'YYYY-MM-DD HH24:MI') end fecha_real,
                  a.display_name cuenta,a.city,u.full_name responsable,v.status estado,
                  v.priority prioridad,coalesce(v.result::text,'') resultado,
                  coalesce(v.observation,'') observacion,coalesce(v.notes,'') proxima_accion
           from visits v join commercial_accounts a on a.id=v.account_id
             join users u on u.id=v.responsible_user_id
           ${where.length ? `where ${where.join(" and ")}` : ""}
           order by v.scheduled_at,v.id limit 10000`;
  } else if (item.report_group === "TASKS") {
    values.push(item.timezone);
    if (scopeUserId) {
      values.push(scopeUserId);
      where.push(`t.responsible_user_id=$${values.length} and a.owner_user_id=$${values.length}`);
    }
    addFilter(where, values, (p) => `t.due_date>=${p}::date`, filters.from);
    addFilter(where, values, (p) => `t.due_date<=${p}::date`, filters.to);
    addFilter(where, values, (p) => `t.responsible_user_id=${p}`, filters.responsibleUserId);
    addFilter(where, values, (p) => `t.account_id=${p}`, filters.accountId);
    addFilter(where, values, (p) => `a.city=${p}`, filters.city);
    addFilter(where, values, (p) => `t.status=${p}`, filters.status);
    addFilter(where, values, (p) => `t.priority=${p}`, filters.priority);
    if (filters.origin !== undefined)
      where.push(filters.origin === "VISIT" ? "t.visit_id is not null" : "t.visit_id is null");
    if (filters.overdue !== undefined)
      where.push(
        filters.overdue
          ? "t.status in ('PENDING','IN_PROGRESS') and ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone)<now()"
          : "not (t.status in ('PENDING','IN_PROGRESS') and ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone)<now())",
      );
    if (item.template === "open" || item.template === "workload")
      where.push("t.status in ('PENDING','IN_PROGRESS')");
    if (item.template === "overdue")
      where.push(
        "t.status in ('PENDING','IN_PROGRESS') and ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone)<now()",
      );
    if (item.template === "completed") where.push("t.status='COMPLETED'");
    sql =
      item.template === "workload"
        ? `select u.full_name responsable,$1::text zona,count(*)::text tareas_abiertas,
                  count(*) filter(where ((t.due_date+coalesce(t.due_time,time '23:59:59'))
                    at time zone t.timezone)<now())::text tareas_vencidas,
                  min(t.due_date)::text proximo_vencimiento
           from tasks t join commercial_accounts a on a.id=t.account_id
             join users u on u.id=t.responsible_user_id
           ${where.length ? `where ${where.join(" and ")}` : ""}
           group by u.id,u.full_name order by u.full_name,u.id limit 10000`
        : `select t.title titulo,a.display_name cuenta,u.full_name responsable,$1::text zona,
                  t.due_date::text vencimiento,coalesce(to_char(t.due_time,'HH24:MI'),'') hora,
                  t.status estado,t.priority prioridad,
                  greatest(0,current_date-t.due_date)::text antiguedad_dias,
                  case when t.visit_id is null then 'MANUAL' else 'VISIT' end origen
           from tasks t join commercial_accounts a on a.id=t.account_id
             join users u on u.id=t.responsible_user_id
           ${where.length ? `where ${where.join(" and ")}` : ""}
           order by t.due_date,t.due_time nulls last,t.id limit 10000`;
  } else if (item.report_group === "ACCOUNTS") {
    const hasPeriodFilter = filters.from !== undefined || filters.to !== undefined;
    const periodWhere: string[] = [];
    if (hasPeriodFilter) values.push(item.timezone);
    if (scopeUserId) {
      values.push(scopeUserId);
      where.push(`a.owner_user_id=$${values.length}`);
    }
    if (hasPeriodFilter) dateFilters("vp.scheduled_at", filters, "$1", periodWhere, values);
    addFilter(where, values, (p) => `a.id=${p}`, filters.accountId);
    addFilter(where, values, (p) => `a.status=${p}`, filters.status);
    addFilter(where, values, (p) => `a.account_type=${p}`, filters.accountType);
    addFilter(where, values, (p) => `a.country_code=${p}`, filters.countryCode);
    addFilter(where, values, (p) => `a.city=${p}`, filters.city);
    addFilter(where, values, (p) => `a.owner_user_id=${p}`, filters.responsibleUserId);
    addFilter(
      where,
      values,
      (p) =>
        `exists(select 1 from commercial_account_fruits af where af.account_id=a.id and af.fruit_id=${p})`,
      filters.fruitId,
    );
    addFilter(
      where,
      values,
      (p) =>
        `not exists(select 1 from visits vx where vx.account_id=a.id and vx.scheduled_at>=${p}::date)`,
      filters.noVisitSince,
    );
    if (item.template === "stale" && filters.noVisitSince === undefined)
      where.push(
        "not exists(select 1 from visits vx where vx.account_id=a.id and vx.scheduled_at>=current_date-interval '90 days')",
      );
    if (item.template === "by-fruit-location-owner")
      where.push("exists(select 1 from commercial_account_fruits afx where afx.account_id=a.id)");
    sql = `select a.display_name cuenta,a.account_type tipo,a.status estado,a.country_code pais,
                  a.city,u.full_name responsable,
                  coalesce(pc.full_name,'') contacto_principal,
                  coalesce(pc.phone,pc.email,'') canal_principal,
                  coalesce(fs.frutas,'') frutas,
                  coalesce(ap.visitas_periodo,0)::text visitas_periodo,
                  coalesce(lv.ultima_visita::text,'') ultima_visita,
                  coalesce(nv.proxima_visita::text,'') proxima_visita
           from commercial_accounts a join users u on u.id=a.owner_user_id
           left join lateral (
             select full_name,phone,email from commercial_contacts
             where account_id=a.id and is_primary and deleted_at is null limit 1
           ) pc on true
           left join lateral (
             select string_agg(f.name,', ' order by f.normalized_name) frutas
             from commercial_account_fruits af join fruits f on f.id=af.fruit_id
             where af.account_id=a.id
           ) fs on true
           left join lateral (
             select count(*)::int visitas_periodo from visits vp
             where vp.account_id=a.id${periodWhere.length ? ` and ${periodWhere.join(" and ")}` : ""}
           ) ap on true
           left join lateral (
             select max(scheduled_at)::date ultima_visita from visits
             where account_id=a.id and status='COMPLETED'
           ) lv on true
           left join lateral (
             select min(scheduled_at)::date proxima_visita from visits
             where account_id=a.id and status='PENDING' and scheduled_at>=now()
           ) nv on true
           ${where.length ? `where ${where.join(" and ")}` : ""}
           order by a.normalized_display_name,a.id limit 10000`;
  } else if (item.report_group === "DOCUMENTS") {
    values.push(item.timezone);
    if (scopeUserId) {
      values.push(scopeUserId);
      where.push(`a.owner_user_id=$${values.length}`);
    }
    dateFilters("d.created_at", filters, "$1", where, values);
    addFilter(where, values, (p) => `d.account_id=${p}`, filters.accountId);
    addFilter(where, values, (p) => `a.owner_user_id=${p}`, filters.responsibleUserId);
    addFilter(where, values, (p) => `a.city=${p}`, filters.city);
    addFilter(where, values, (p) => `d.category_id=${p}`, filters.categoryId);
    addFilter(where, values, (p) => `d.created_by=${p}`, filters.authorUserId);
    addFilter(where, values, (p) => `d.format=${p}`, filters.format);
    addFilter(where, values, (p) => `d.status=${p}`, filters.status);
    if (filters.status === undefined) where.push("d.status<>'DELETED'");
    if (item.template === "review-due")
      where.push("d.status='AVAILABLE' and d.created_at<now()-interval '1 year'");
    sql =
      item.template === "by-category"
        ? `select c.name categoria,$1::text zona,count(*)::text documentos,
                  coalesce(sum(d.size_bytes),0)::text tamano_total_bytes
           from documents d join commercial_accounts a on a.id=d.account_id
             join document_categories c on c.id=d.category_id
           where ${where.join(" and ")}
           group by c.name,c.normalized_name order by c.normalized_name limit 10000`
        : `select d.original_filename nombre,d.format formato,d.size_bytes::text tamano_bytes,
                  a.display_name cuenta,c.name categoria,u.full_name autor,
                  to_char(d.created_at at time zone $1,'YYYY-MM-DD HH24:MI') fecha,
                  case when d.visit_id is not null then 'VISITA'
                       when d.task_id is not null then 'TAREA' else 'CUENTA' end contexto,
                  d.status estado
           from documents d join commercial_accounts a on a.id=d.account_id
             join document_categories c on c.id=d.category_id
             join users u on u.id=d.created_by
           where ${where.join(" and ")}
           order by d.created_at desc,d.id limit 10000`;
  } else {
    values.push(item.timezone);
    const visitWhere = ["v.responsible_user_id=u.id"];
    const taskWhere = ["t.responsible_user_id=u.id"];
    const accountWhere = ["a.owner_user_id=u.id", "a.status='ACTIVE'"];
    dateFilters("v.scheduled_at", filters, "$1", visitWhere, values);
    addFilter(taskWhere, values, (p) => `t.due_date>=${p}::date`, filters.from);
    addFilter(taskWhere, values, (p) => `t.due_date<=${p}::date`, filters.to);
    addFilter(visitWhere, values, (p) => `v.account_id=${p}`, filters.accountId);
    addFilter(taskWhere, values, (p) => `t.account_id=${p}`, filters.accountId);
    addFilter(accountWhere, values, (p) => `a.id=${p}`, filters.accountId);
    addFilter(visitWhere, values, (p) => `a.city=${p}`, filters.city);
    addFilter(taskWhere, values, (p) => `a.city=${p}`, filters.city);
    addFilter(accountWhere, values, (p) => `a.city=${p}`, filters.city);
    addFilter(where, values, (p) => `u.id=${p}`, filters.responsibleUserId);
    sql =
      item.template === "period-activity"
        ? `select to_char(ev.activity_at at time zone $1,'YYYY-MM-DD') fecha,
                  u.full_name supervisor,
                  count(*) filter(where ev.kind='VISIT')::text visitas,
                  count(*) filter(where ev.kind='VISIT' and ev.status='COMPLETED')::text visitas_completadas,
                  count(*) filter(where ev.kind='VISIT' and ev.status='CANCELLED')::text visitas_canceladas,
                  count(*) filter(where ev.kind='TASK')::text tareas,
                  count(*) filter(where ev.kind='TASK' and ev.status='COMPLETED')::text tareas_completadas
           from users u
           join lateral (
             select v.scheduled_at activity_at,'VISIT'::text kind,v.status::text status
              from visits v join commercial_accounts a on a.id=v.account_id
              where ${visitWhere.join(" and ")}
             union all
             select ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone),
                    'TASK'::text,t.status::text
              from tasks t join commercial_accounts a on a.id=t.account_id
              where ${taskWhere.join(" and ")}
           ) ev on true
           where u.role='SUPERVISOR' and u.status='ACTIVE'${where.length ? ` and ${where.join(" and ")}` : ""}
           group by to_char(ev.activity_at at time zone $1,'YYYY-MM-DD'),u.id,u.full_name
           order by fecha,u.full_name,u.id limit 10000`
        : `select u.full_name supervisor,$1::text zona,vs.visitas::text visitas,
                  vs.completadas::text visitas_completadas,
                  coalesce(round(100.0*vs.completadas/nullif(vs.visitas,0),2),0)::text cumplimiento_porcentaje,
                  ac.cuentas_activas::text cuentas_activas,
                  ts.tareas_abiertas::text tareas_abiertas,
                  ts.tareas_vencidas::text tareas_vencidas
           from users u
           cross join lateral (
             select count(*) visitas,count(*) filter(where v.status='COMPLETED') completadas
              from visits v join commercial_accounts a on a.id=v.account_id
              where ${visitWhere.join(" and ")}
           ) vs
           cross join lateral (
              select count(*) cuentas_activas from commercial_accounts a
              where ${accountWhere.join(" and ")}
           ) ac
           cross join lateral (
             select count(*) filter(where t.status in ('PENDING','IN_PROGRESS')) tareas_abiertas,
                    count(*) filter(where t.status in ('PENDING','IN_PROGRESS')
                      and ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone)<now()) tareas_vencidas
              from tasks t join commercial_accounts a on a.id=t.account_id
              where ${taskWhere.join(" and ")}
           ) ts
           where u.role='SUPERVISOR' and u.status='ACTIVE'${where.length ? ` and ${where.join(" and ")}` : ""}
           order by u.full_name,u.id limit 10000`;
  }

  const result = await pool.query<Record<string, unknown>>(sql, values);
  return result.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, scalar(value)])),
  );
}

export async function renderReport(
  item: Pick<ReportExportJob, "report_group" | "format" | "timezone" | "filters" | "template">,
  records: ReportRecord[],
) {
  const headers = Object.keys(records[0] ?? { resultado: "Sin datos" });
  const filters = JSON.stringify(item.filters);
  if (item.format === "XLSX") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Reporte");
    sheet.addRow(["Grupo", item.report_group]);
    sheet.addRow(["Plantilla", item.template]);
    sheet.addRow(["Zona", item.timezone]);
    sheet.addRow(["Filtros", filters]);
    sheet.addRow([]);
    sheet.addRow(headers);
    for (const record of records) sheet.addRow(headers.map((header) => record[header] ?? ""));
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ margin: 40 });
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.fontSize(16).text("VICAM — Reporte");
    pdf.fontSize(9).text(`Grupo: ${item.report_group}`);
    pdf.text(`Plantilla: ${item.template}`);
    pdf.text(`Zona: ${item.timezone}`);
    pdf.text(`Filtros: ${filters}`);
    pdf.moveDown();
    for (const record of records)
      pdf.text(headers.map((h) => `${h}: ${record[h] ?? ""}`).join(" | "));
    if (!records.length) pdf.text("Sin datos para los filtros seleccionados.");
    pdf.end();
  });
}
