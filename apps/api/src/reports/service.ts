import type {
  ReportAnalyticsQuery,
  ReportAnalyticsResponse,
  ReportAnalyticsView,
} from "@vicam/contracts";

import type { DbPool } from "../db.js";
import type { Actor } from "../domain/shared.js";
import { pagination } from "../domain/shared.js";
import { AppError } from "../errors.js";
import {
  accountScope,
  documentScope,
  SqlParameters,
  taskOverdueSql,
  taskScope,
  trendUnit,
  visitScope,
  whereClause,
} from "./sql.js";

type QuerySpec = { text: string; values: unknown[] };

const number = (value: unknown) => Number(value ?? 0);
const percent = (completed: number, total: number) =>
  total === 0 ? null : Math.round((completed * 10_000) / total) / 100;
const metric = (
  key: string,
  label: string,
  value: number,
  format: "NUMBER" | "PERCENT" = "NUMBER",
) => ({
  key,
  label,
  value,
  format,
});
const point = (key: string, label: string, value: unknown, secondaryValue?: unknown) => ({
  key,
  label,
  value: number(value),
  ...(secondaryValue === undefined ? {} : { secondaryValue: number(secondaryValue) }),
});

function querySpec(build: (parameters: SqlParameters) => string): QuerySpec {
  const parameters = new SqlParameters();
  return { text: build(parameters), values: parameters.values };
}

function tablePagination(query: ReportAnalyticsQuery, total: number) {
  return pagination(query.page, query.pageSize, total);
}

export class ReportsAnalyticsService {
  constructor(private readonly pool: DbPool) {}

  async load(
    view: ReportAnalyticsView,
    query: ReportAnalyticsQuery,
    actor: Actor,
  ): Promise<ReportAnalyticsResponse> {
    await this.assertAccess(view, query, actor);
    await this.assertTimezone(query.timezone);
    if (view === "summary") return this.summary(query, actor);
    if (view === "visits") return this.visits(query, actor);
    if (view === "tasks") return this.tasks(query, actor);
    if (view === "accounts") return this.accounts(query, actor);
    return this.documents(query, actor);
  }

  private async assertAccess(view: ReportAnalyticsView, query: ReportAnalyticsQuery, actor: Actor) {
    if (view === "summary" && actor.role !== "MANAGER") {
      throw new AppError(
        403,
        "MANAGEMENT_REPORT_MANAGER_ONLY",
        "El resumen gerencial está disponible únicamente para Manager.",
      );
    }
    if (actor.role !== "SUPERVISOR") return;
    const setting = await this.pool.query<{ enabled: boolean }>(
      `select coalesce((value->>'supervisorReportsEnabled')::boolean,false) enabled
       from app_settings where settings_key='application'`,
    );
    if (setting.rows[0]?.enabled !== true) {
      throw new AppError(403, "REPORTS_NOT_ENABLED", "Los reportes propios no están habilitados.");
    }
    if (query.responsibleUserId && query.responsibleUserId !== actor.userId) {
      throw new AppError(403, "REPORT_SCOPE_INVALID", "El reporte debe usar su alcance propio.");
    }
  }

  private async assertTimezone(timezone: string) {
    const found = await this.pool.query<{ valid: boolean }>(
      "select exists(select 1 from pg_timezone_names where name=$1) valid",
      [timezone],
    );
    if (found.rows[0]?.valid !== true) {
      throw new AppError(422, "INVALID_TIMEZONE", "La zona horaria no es válida.");
    }
  }

  private async summary(
    query: ReportAnalyticsQuery,
    actor: Actor,
  ): Promise<ReportAnalyticsResponse> {
    const visitsAggregate = querySpec((parameters) => {
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select count(*)::int total,
                     count(*) filter(where v.status='COMPLETED')::int completed,
                     count(*) filter(where v.status='PENDING')::int pending,
                     count(*) filter(where v.status='CANCELLED')::int cancelled
              from visits v join commercial_accounts a on a.id=v.account_id ${clause}`;
    });
    const tasksAggregate = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      return `select count(*) filter(where ${taskOverdueSql})::int overdue
              from tasks t join commercial_accounts a on a.id=t.account_id ${clause}`;
    });
    const accountsAggregate = querySpec((parameters) => {
      const clause = whereClause(accountScope("a", query, actor, parameters));
      return `select count(*) filter(where a.status='ACTIVE')::int active,
                     count(*) filter(where a.status='ACTIVE' and not exists(
                       select 1 from visits vx where vx.account_id=a.id and vx.status='COMPLETED'
                         and vx.scheduled_at>=now()-interval '90 days'))::int stale
              from commercial_accounts a ${clause}`;
    });
    const documentsAggregate = querySpec((parameters) => {
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select count(*)::int total,
                     count(*) filter(where d.status in ('QUARANTINED','SCANNING','REJECTED'))::int attention
              from documents d join commercial_accounts a on a.id=d.account_id ${clause}`;
    });
    const trend = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const unit = trendUnit(query);
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select to_char(date_trunc('${unit}',v.scheduled_at at time zone ${timezone}),'YYYY-MM-DD') key,
                     count(*)::int value,
                     count(*) filter(where v.status='COMPLETED')::int completed
              from visits v join commercial_accounts a on a.id=v.account_id ${clause}
              group by 1 order by 1`;
    });
    const responsible = querySpec((parameters) => {
      const visitWhere = whereClause(visitScope(query, actor, parameters));
      return `select u.id user_id,u.full_name name,count(*)::int total,
                     count(*) filter(where v.status='COMPLETED')::int completed,
                     count(*) filter(where v.status='PENDING')::int open
              from visits v join commercial_accounts a on a.id=v.account_id
                join users u on u.id=v.responsible_user_id ${visitWhere}
              group by u.id,u.full_name order by count(*) desc,u.full_name limit 20`;
    });
    const attention = querySpec((parameters) => {
      const clause = whereClause(taskScope({ ...query, overdue: true }, actor, parameters));
      return `select t.id,t.title,a.display_name account_name,t.due_date::text date
              from tasks t join commercial_accounts a on a.id=t.account_id ${clause}
              order by t.due_date,t.due_time nulls last,t.id limit 8`;
    });

    const [
      visitResult,
      taskResult,
      accountResult,
      documentResult,
      trendResult,
      responsibleResult,
      attentionResult,
    ] = await Promise.all([
      this.pool.query<Record<string, unknown>>(visitsAggregate.text, visitsAggregate.values),
      this.pool.query<Record<string, unknown>>(tasksAggregate.text, tasksAggregate.values),
      this.pool.query<Record<string, unknown>>(accountsAggregate.text, accountsAggregate.values),
      this.pool.query<Record<string, unknown>>(documentsAggregate.text, documentsAggregate.values),
      this.pool.query<Record<string, unknown>>(trend.text, trend.values),
      this.pool.query<Record<string, unknown>>(responsible.text, responsible.values),
      this.pool.query<Record<string, unknown>>(attention.text, attention.values),
    ]);
    const visits = visitResult.rows[0] ?? {};
    const totalVisits = number(visits.total);
    const completedVisits = number(visits.completed);
    const tasks = taskResult.rows[0] ?? {};
    const accounts = accountResult.rows[0] ?? {};
    const documents = documentResult.rows[0] ?? {};
    return {
      view: "summary",
      kpis: [
        metric("visits", "Visitas del periodo", totalVisits),
        metric(
          "visit-compliance",
          "Cumplimiento de visitas",
          percent(completedVisits, totalVisits) ?? 0,
          "PERCENT",
        ),
        metric("overdue-tasks", "Tareas vencidas", number(tasks.overdue)),
        metric("accounts-without-follow-up", "Cuentas sin seguimiento", number(accounts.stale)),
      ],
      trend: trendResult.rows.map((row) =>
        point(String(row.key), String(row.key), row.value, row.completed),
      ),
      distribution: [
        point("COMPLETED", "Completadas", visits.completed),
        point("PENDING", "Pendientes", visits.pending),
        point("CANCELLED", "Canceladas", visits.cancelled),
      ],
      secondaryDistribution: [
        point("ACTIVE_ACCOUNTS", "Cuentas activas", accounts.active),
        point("DOCUMENTS", "Documentos", documents.total),
        point("DOCUMENT_ATTENTION", "Documentos con incidencias", documents.attention),
      ],
      responsibleActivity: responsibleResult.rows.map((row) => {
        const total = number(row.total),
          completed = number(row.completed);
        return {
          userId: String(row.user_id),
          name: String(row.name),
          total,
          completed,
          open: number(row.open),
          overdue: 0,
          compliancePercent: percent(completed, total),
        };
      }),
      attention: attentionResult.rows.map((row) => ({
        kind: "TASK" as const,
        id: String(row.id),
        title: String(row.title),
        detail: `Vencida · ${String(row.account_name)}`,
        date: String(row.date),
        href: `/app/tasks/${String(row.id)}`,
      })),
      rows: [],
      pagination: tablePagination(query, 0),
    };
  }

  private async visits(
    query: ReportAnalyticsQuery,
    actor: Actor,
  ): Promise<ReportAnalyticsResponse> {
    const aggregate = querySpec((parameters) => {
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select count(*)::int total,
                     count(*) filter(where v.status='COMPLETED')::int completed,
                     count(*) filter(where v.status='PENDING')::int pending,
                     count(*) filter(where v.status='CANCELLED')::int cancelled,
                     count(*) filter(where exists(select 1 from visit_reschedules vr where vr.visit_id=v.id))::int rescheduled
              from visits v join commercial_accounts a on a.id=v.account_id ${clause}`;
    });
    const trend = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone),
        unit = trendUnit(query);
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select to_char(date_trunc('${unit}',v.scheduled_at at time zone ${timezone}),'YYYY-MM-DD') key,
                     count(*)::int value,count(*) filter(where v.status='COMPLETED')::int completed
              from visits v join commercial_accounts a on a.id=v.account_id ${clause}
              group by 1 order by 1`;
    });
    const responsible = querySpec((parameters) => {
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select u.id user_id,u.full_name name,count(*)::int total,
                     count(*) filter(where v.status='COMPLETED')::int completed,
                     count(*) filter(where v.status='PENDING')::int open
              from visits v join commercial_accounts a on a.id=v.account_id
                join users u on u.id=v.responsible_user_id ${clause}
              group by u.id,u.full_name order by total desc,u.full_name limit 100`;
    });
    const count = querySpec((parameters) => {
      const clause = whereClause(visitScope(query, actor, parameters));
      return `select count(*)::int total from visits v join commercial_accounts a on a.id=v.account_id ${clause}`;
    });
    const rows = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const clause = whereClause(visitScope(query, actor, parameters));
      const limit = parameters.add(query.pageSize),
        offset = parameters.add((query.page - 1) * query.pageSize);
      return `select v.id,v.reason title,to_char(v.scheduled_at at time zone ${timezone},'YYYY-MM-DD HH24:MI') date,
                     a.display_name account_name,u.full_name responsible_name,v.status,v.priority,a.city
              from visits v join commercial_accounts a on a.id=v.account_id
                join users u on u.id=v.responsible_user_id ${clause}
              order by v.scheduled_at desc,v.id limit ${limit} offset ${offset}`;
    });
    const attention = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const where = visitScope(query, actor, parameters);
      where.push("v.status='PENDING'", "v.scheduled_at<now()");
      return `select v.id,v.reason title,a.display_name account_name,
                     to_char(v.scheduled_at at time zone ${timezone},'YYYY-MM-DD HH24:MI') date
              from visits v join commercial_accounts a on a.id=v.account_id ${whereClause(where)}
              order by v.scheduled_at,v.id limit 8`;
    });
    const [
      aggregateResult,
      trendResult,
      responsibleResult,
      countResult,
      rowResult,
      attentionResult,
    ] = await Promise.all([
      this.pool.query<Record<string, unknown>>(aggregate.text, aggregate.values),
      this.pool.query<Record<string, unknown>>(trend.text, trend.values),
      this.pool.query<Record<string, unknown>>(responsible.text, responsible.values),
      this.pool.query<{ total: number }>(count.text, count.values),
      this.pool.query<Record<string, unknown>>(rows.text, rows.values),
      this.pool.query<Record<string, unknown>>(attention.text, attention.values),
    ]);
    const aggregateRow = aggregateResult.rows[0] ?? {};
    const total = number(aggregateRow.total),
      completed = number(aggregateRow.completed);
    return {
      view: "visits",
      kpis: [
        metric("total", "Total de visitas", total),
        metric("completed", "Completadas", completed),
        metric("pending", "Pendientes", number(aggregateRow.pending)),
        metric("rescheduled", "Reprogramadas", number(aggregateRow.rescheduled)),
        metric("cancelled", "Canceladas", number(aggregateRow.cancelled)),
        metric("compliance", "Cumplimiento", percent(completed, total) ?? 0, "PERCENT"),
      ],
      trend: trendResult.rows.map((row) =>
        point(String(row.key), String(row.key), row.value, row.completed),
      ),
      distribution: [
        point("COMPLETED", "Completadas", aggregateRow.completed),
        point("PENDING", "Pendientes", aggregateRow.pending),
        point("CANCELLED", "Canceladas", aggregateRow.cancelled),
      ],
      secondaryDistribution: [point("RESCHEDULED", "Con reprogramación", aggregateRow.rescheduled)],
      responsibleActivity: responsibleResult.rows.map((row) => {
        const activityTotal = number(row.total),
          activityCompleted = number(row.completed);
        return {
          userId: String(row.user_id),
          name: String(row.name),
          total: activityTotal,
          completed: activityCompleted,
          open: number(row.open),
          overdue: 0,
          compliancePercent: percent(activityCompleted, activityTotal),
        };
      }),
      attention: attentionResult.rows.map((row) => ({
        kind: "VISIT" as const,
        id: String(row.id),
        title: String(row.title),
        detail: `Pendiente · ${String(row.account_name)}`,
        date: String(row.date),
        href: `/app/visits/${String(row.id)}`,
      })),
      rows: rowResult.rows.map((row) => ({
        id: String(row.id),
        kind: "VISIT" as const,
        title: String(row.title),
        date: String(row.date),
        accountName: String(row.account_name),
        responsibleName: String(row.responsible_name),
        status: String(row.status),
        priority: String(row.priority),
        city: String(row.city),
        category: null,
        format: null,
        total: null,
        secondary: null,
        href: `/app/visits/${String(row.id)}`,
      })),
      pagination: tablePagination(query, number(countResult.rows[0]?.total)),
    };
  }

  private async tasks(query: ReportAnalyticsQuery, actor: Actor): Promise<ReportAnalyticsResponse> {
    const aggregate = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      return `select count(*)::int total,
                     count(*) filter(where t.status in ('PENDING','IN_PROGRESS'))::int open,
                     count(*) filter(where t.status='COMPLETED')::int completed,
                     count(*) filter(where t.status='CANCELLED')::int cancelled,
                     count(*) filter(where ${taskOverdueSql})::int overdue
              from tasks t join commercial_accounts a on a.id=t.account_id ${clause}`;
    });
    const trend = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      return `select t.due_date::text key,count(*)::int value,
                     count(*) filter(where t.status='COMPLETED')::int completed
              from tasks t join commercial_accounts a on a.id=t.account_id ${clause}
              group by t.due_date order by t.due_date`;
    });
    const responsible = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      return `select u.id user_id,u.full_name name,count(*)::int total,
                     count(*) filter(where t.status='COMPLETED')::int completed,
                     count(*) filter(where t.status in ('PENDING','IN_PROGRESS'))::int open,
                     count(*) filter(where ${taskOverdueSql})::int overdue
              from tasks t join commercial_accounts a on a.id=t.account_id
                join users u on u.id=t.responsible_user_id ${clause}
              group by u.id,u.full_name order by total desc,u.full_name limit 100`;
    });
    const count = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      return `select count(*)::int total from tasks t join commercial_accounts a on a.id=t.account_id ${clause}`;
    });
    const rows = querySpec((parameters) => {
      const clause = whereClause(taskScope(query, actor, parameters));
      const limit = parameters.add(query.pageSize),
        offset = parameters.add((query.page - 1) * query.pageSize);
      return `select t.id,t.title,t.due_date::text date,a.display_name account_name,
                     u.full_name responsible_name,t.status,t.priority,a.city,
                     case when ${taskOverdueSql} then 'Vencida' else null end secondary
              from tasks t join commercial_accounts a on a.id=t.account_id
                join users u on u.id=t.responsible_user_id ${clause}
              order by t.due_date,t.due_time nulls last,t.id limit ${limit} offset ${offset}`;
    });
    const attention = querySpec((parameters) => {
      const where = taskScope({ ...query, overdue: true }, actor, parameters);
      return `select t.id,t.title,t.due_date::text date,a.display_name account_name
              from tasks t join commercial_accounts a on a.id=t.account_id ${whereClause(where)}
              order by t.due_date,t.due_time nulls last,t.id limit 8`;
    });
    const [
      aggregateResult,
      trendResult,
      responsibleResult,
      countResult,
      rowResult,
      attentionResult,
    ] = await Promise.all([
      this.pool.query<Record<string, unknown>>(aggregate.text, aggregate.values),
      this.pool.query<Record<string, unknown>>(trend.text, trend.values),
      this.pool.query<Record<string, unknown>>(responsible.text, responsible.values),
      this.pool.query<{ total: number }>(count.text, count.values),
      this.pool.query<Record<string, unknown>>(rows.text, rows.values),
      this.pool.query<Record<string, unknown>>(attention.text, attention.values),
    ]);
    const aggregateRow = aggregateResult.rows[0] ?? {};
    const total = number(aggregateRow.total),
      completed = number(aggregateRow.completed);
    return {
      view: "tasks",
      kpis: [
        metric("total", "Total de tareas", total),
        metric("open", "Abiertas", number(aggregateRow.open)),
        metric("completed", "Completadas", completed),
        metric("overdue", "Vencidas", number(aggregateRow.overdue)),
        metric("compliance", "Cumplimiento", percent(completed, total) ?? 0, "PERCENT"),
      ],
      trend: trendResult.rows.map((row) =>
        point(String(row.key), String(row.key), row.value, row.completed),
      ),
      distribution: [
        point("OPEN", "Abiertas", aggregateRow.open),
        point("COMPLETED", "Completadas", aggregateRow.completed),
        point("CANCELLED", "Canceladas", aggregateRow.cancelled),
      ],
      secondaryDistribution: [point("OVERDUE", "Vencidas", aggregateRow.overdue)],
      responsibleActivity: responsibleResult.rows.map((row) => {
        const activityTotal = number(row.total),
          activityCompleted = number(row.completed);
        return {
          userId: String(row.user_id),
          name: String(row.name),
          total: activityTotal,
          completed: activityCompleted,
          open: number(row.open),
          overdue: number(row.overdue),
          compliancePercent: percent(activityCompleted, activityTotal),
        };
      }),
      attention: attentionResult.rows.map((row) => ({
        kind: "TASK" as const,
        id: String(row.id),
        title: String(row.title),
        detail: `Vencida · ${String(row.account_name)}`,
        date: String(row.date),
        href: `/app/tasks/${String(row.id)}`,
      })),
      rows: rowResult.rows.map((row) => ({
        id: String(row.id),
        kind: "TASK" as const,
        title: String(row.title),
        date: String(row.date),
        accountName: String(row.account_name),
        responsibleName: String(row.responsible_name),
        status: String(row.status),
        priority: String(row.priority),
        city: String(row.city),
        category: null,
        format: null,
        total: null,
        secondary: row.secondary as string | null,
        href: `/app/tasks/${String(row.id)}`,
      })),
      pagination: tablePagination(query, number(countResult.rows[0]?.total)),
    };
  }

  private async accounts(
    query: ReportAnalyticsQuery,
    actor: Actor,
  ): Promise<ReportAnalyticsResponse> {
    const aggregate = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const where = accountScope("a", query, actor, parameters);
      const from = query.from ? parameters.add(query.from) : null;
      const to = query.to ? parameters.add(query.to) : null;
      const period =
        [
          ...(from ? [`v.scheduled_at>=(${from}::date::timestamp at time zone ${timezone})`] : []),
          ...(to ? [`v.scheduled_at<(((${to}::date+1)::timestamp) at time zone ${timezone})`] : []),
        ].join(" and ") || "true";
      const createdPeriod =
        [
          ...(from ? [`a.created_at>=(${from}::date::timestamp at time zone ${timezone})`] : []),
          ...(to ? [`a.created_at<(((${to}::date+1)::timestamp) at time zone ${timezone})`] : []),
        ].join(" and ") || "true";
      return `select count(*)::int total,count(*) filter(where ${createdPeriod})::int new_accounts,
                     count(*) filter(where exists(select 1 from visits v where v.account_id=a.id and ${period}))::int visited,
                     count(*) filter(where not exists(select 1 from visits vx where vx.account_id=a.id
                       and vx.status='COMPLETED' and vx.scheduled_at>=now()-interval '90 days'))::int stale
              from commercial_accounts a ${whereClause(where)}`;
    });
    const distribution = querySpec((parameters) => {
      const clause = whereClause(accountScope("a", query, actor, parameters));
      return `select a.city key,a.city label,count(*)::int value from commercial_accounts a ${clause}
              group by a.city order by value desc,a.city limit 20`;
    });
    const count = querySpec((parameters) => {
      const clause = whereClause(accountScope("a", query, actor, parameters));
      return `select count(*)::int total from commercial_accounts a ${clause}`;
    });
    const rows = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const where = accountScope("a", query, actor, parameters);
      const period: string[] = [];
      if (query.from)
        period.push(
          `v.scheduled_at>=(${parameters.add(query.from)}::date::timestamp at time zone ${timezone})`,
        );
      if (query.to)
        period.push(
          `v.scheduled_at<(((${parameters.add(query.to)}::date+1)::timestamp) at time zone ${timezone})`,
        );
      const limit = parameters.add(query.pageSize),
        offset = parameters.add((query.page - 1) * query.pageSize);
      return `select a.id,a.display_name title,to_char(a.created_at at time zone ${timezone},'YYYY-MM-DD') date,u.full_name responsible_name,
                     a.status,a.city,count(v.id)::int activity_total,
                     (max(v.scheduled_at) filter(where v.status='COMPLETED'))::text last_visit
              from commercial_accounts a join users u on u.id=a.owner_user_id
                left join visits v on v.account_id=a.id${period.length ? ` and ${period.join(" and ")}` : ""}
              ${whereClause(where)} group by a.id,u.full_name
              order by activity_total desc,a.normalized_display_name,a.id limit ${limit} offset ${offset}`;
    });
    const attention = querySpec((parameters) => {
      const where = accountScope("a", query, actor, parameters);
      where.push(`not exists(select 1 from visits vx where vx.account_id=a.id and vx.status='COMPLETED'
        and vx.scheduled_at>=now()-interval '90 days')`);
      return `select a.id,a.display_name title,a.city,
                     (select max(vx.scheduled_at)::date::text from visits vx where vx.account_id=a.id and vx.status='COMPLETED') date
              from commercial_accounts a ${whereClause(where)}
              order by date nulls first,a.normalized_display_name,a.id limit 8`;
    });
    const [aggregateResult, distributionResult, countResult, rowResult, attentionResult] =
      await Promise.all([
        this.pool.query<Record<string, unknown>>(aggregate.text, aggregate.values),
        this.pool.query<Record<string, unknown>>(distribution.text, distribution.values),
        this.pool.query<{ total: number }>(count.text, count.values),
        this.pool.query<Record<string, unknown>>(rows.text, rows.values),
        this.pool.query<Record<string, unknown>>(attention.text, attention.values),
      ]);
    const aggregateRow = aggregateResult.rows[0] ?? {};
    return {
      view: "accounts",
      kpis: [
        metric("total", "Cuentas totales", number(aggregateRow.total)),
        metric("visited", "Visitadas en el periodo", number(aggregateRow.visited)),
        metric("stale", "Sin seguimiento reciente", number(aggregateRow.stale)),
        metric("new", "Cuentas nuevas", number(aggregateRow.new_accounts)),
      ],
      trend: [],
      distribution: distributionResult.rows.map((row) =>
        point(String(row.key), String(row.label), row.value),
      ),
      secondaryDistribution: [],
      responsibleActivity: [],
      attention: attentionResult.rows.map((row) => ({
        kind: "ACCOUNT" as const,
        id: String(row.id),
        title: String(row.title),
        detail: `Sin visita completada reciente · ${String(row.city)}`,
        date: row.date as string | null,
        href: `/app/accounts/${String(row.id)}`,
      })),
      rows: rowResult.rows.map((row) => ({
        id: String(row.id),
        kind: "ACCOUNT" as const,
        title: String(row.title),
        date: String(row.date),
        accountName: String(row.title),
        responsibleName: String(row.responsible_name),
        status: String(row.status),
        priority: null,
        city: String(row.city),
        category: null,
        format: null,
        total: number(row.activity_total),
        secondary:
          row.last_visit === null
            ? "Sin visitas completadas"
            : `Última visita en el periodo: ${row.last_visit as string}`,
        href: `/app/accounts/${String(row.id)}`,
      })),
      pagination: tablePagination(query, number(countResult.rows[0]?.total)),
    };
  }

  private async documents(
    query: ReportAnalyticsQuery,
    actor: Actor,
  ): Promise<ReportAnalyticsResponse> {
    const aggregate = querySpec((parameters) => {
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select count(*)::int total,count(*) filter(where d.status='AVAILABLE')::int available,
                     count(*) filter(where d.status in ('QUARANTINED','SCANNING'))::int processing,
                     count(*) filter(where d.status='REJECTED')::int rejected
              from documents d join commercial_accounts a on a.id=d.account_id ${clause}`;
    });
    const trend = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone),
        unit = trendUnit(query);
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select to_char(date_trunc('${unit}',d.created_at at time zone ${timezone}),'YYYY-MM-DD') key,
                     count(*)::int value from documents d join commercial_accounts a on a.id=d.account_id ${clause}
              group by 1 order by 1`;
    });
    const distribution = querySpec((parameters) => {
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select c.id::text key,c.name label,count(*)::int value
              from documents d join commercial_accounts a on a.id=d.account_id
                join document_categories c on c.id=d.category_id ${clause}
              group by c.id,c.name,c.normalized_name order by value desc,c.normalized_name limit 30`;
    });
    const secondary = querySpec((parameters) => {
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select d.status::text key,d.status::text label,count(*)::int value
              from documents d join commercial_accounts a on a.id=d.account_id ${clause}
              group by d.status order by value desc,d.status`;
    });
    const count = querySpec((parameters) => {
      const clause = whereClause(documentScope(query, actor, parameters));
      return `select count(*)::int total from documents d join commercial_accounts a on a.id=d.account_id ${clause}`;
    });
    const rows = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const clause = whereClause(documentScope(query, actor, parameters));
      const limit = parameters.add(query.pageSize),
        offset = parameters.add((query.page - 1) * query.pageSize);
      return `select d.id,d.account_id,d.title,to_char(d.created_at at time zone ${timezone},'YYYY-MM-DD HH24:MI') date,
                     a.display_name account_name,u.full_name responsible_name,d.status,a.city,c.name category,d.format
              from documents d join commercial_accounts a on a.id=d.account_id
                join users u on u.id=a.owner_user_id join document_categories c on c.id=d.category_id ${clause}
              order by d.created_at desc,d.id limit ${limit} offset ${offset}`;
    });
    const attention = querySpec((parameters) => {
      const timezone = parameters.add(query.timezone);
      const where = documentScope(query, actor, parameters);
      where.push("d.status in ('QUARANTINED','SCANNING','REJECTED')");
      return `select d.id,d.title,a.id account_id,a.display_name account_name,d.status,
                     to_char(d.created_at at time zone ${timezone},'YYYY-MM-DD HH24:MI') date
              from documents d join commercial_accounts a on a.id=d.account_id ${whereClause(where)}
              order by d.created_at,d.id limit 8`;
    });
    const [
      aggregateResult,
      trendResult,
      distributionResult,
      secondaryResult,
      countResult,
      rowResult,
      attentionResult,
    ] = await Promise.all([
      this.pool.query<Record<string, unknown>>(aggregate.text, aggregate.values),
      this.pool.query<Record<string, unknown>>(trend.text, trend.values),
      this.pool.query<Record<string, unknown>>(distribution.text, distribution.values),
      this.pool.query<Record<string, unknown>>(secondary.text, secondary.values),
      this.pool.query<{ total: number }>(count.text, count.values),
      this.pool.query<Record<string, unknown>>(rows.text, rows.values),
      this.pool.query<Record<string, unknown>>(attention.text, attention.values),
    ]);
    const aggregateRow = aggregateResult.rows[0] ?? {};
    return {
      view: "documents",
      kpis: [
        metric("total", "Total de documentos", number(aggregateRow.total)),
        metric("available", "Disponibles", number(aggregateRow.available)),
        metric("processing", "En análisis", number(aggregateRow.processing)),
        metric("rejected", "Rechazados", number(aggregateRow.rejected)),
      ],
      trend: trendResult.rows.map((row) => point(String(row.key), String(row.key), row.value)),
      distribution: distributionResult.rows.map((row) =>
        point(String(row.key), String(row.label), row.value),
      ),
      secondaryDistribution: secondaryResult.rows.map((row) =>
        point(String(row.key), String(row.label), row.value),
      ),
      responsibleActivity: [],
      attention: attentionResult.rows.map((row) => ({
        kind: "DOCUMENT" as const,
        id: String(row.id),
        title: String(row.title),
        detail: `${String(row.status)} · ${String(row.account_name)}`,
        date: String(row.date),
        href: `/app/accounts/${String(row.account_id)}`,
      })),
      rows: rowResult.rows.map((row) => ({
        id: String(row.id),
        kind: "DOCUMENT" as const,
        title: String(row.title),
        date: String(row.date),
        accountName: String(row.account_name),
        responsibleName: String(row.responsible_name),
        status: String(row.status),
        priority: null,
        city: String(row.city),
        category: String(row.category),
        format: String(row.format),
        total: null,
        secondary: null,
        href: `/app/accounts/${String(row.account_id)}`,
      })),
      pagination: tablePagination(query, number(countResult.rows[0]?.total)),
    };
  }
}
