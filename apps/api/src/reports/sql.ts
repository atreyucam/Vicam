import type { ReportAnalyticsQuery } from "./query.js";

export class SqlParameters {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export type ReportActor = { userId: string; role: "MANAGER" | "SUPERVISOR" };

export function accountScope(
  alias: string,
  query: ReportAnalyticsQuery,
  actor: ReportActor,
  parameters: SqlParameters,
): string[] {
  const where: string[] = [];
  if (actor.role === "SUPERVISOR") {
    where.push(`${alias}.owner_user_id=${parameters.add(actor.userId)}`);
  }
  if (query.responsibleUserId) {
    where.push(`${alias}.owner_user_id=${parameters.add(query.responsibleUserId)}`);
  }
  if (query.accountId) where.push(`${alias}.id=${parameters.add(query.accountId)}`);
  if (query.city) where.push(`${alias}.city=${parameters.add(query.city)}`);
  if (query.accountStatus) where.push(`${alias}.status=${parameters.add(query.accountStatus)}`);
  return where;
}

export function visitScope(
  query: ReportAnalyticsQuery,
  actor: ReportActor,
  parameters: SqlParameters,
): string[] {
  const where: string[] = [];
  if (actor.role === "SUPERVISOR") {
    const user = parameters.add(actor.userId);
    where.push(`v.responsible_user_id=${user}`, `a.owner_user_id=${user}`);
  }
  if (query.responsibleUserId)
    where.push(`v.responsible_user_id=${parameters.add(query.responsibleUserId)}`);
  if (query.accountId) where.push(`v.account_id=${parameters.add(query.accountId)}`);
  if (query.city) where.push(`a.city=${parameters.add(query.city)}`);
  if (query.accountStatus) where.push(`a.status=${parameters.add(query.accountStatus)}`);
  if (query.visitStatus) where.push(`v.status=${parameters.add(query.visitStatus)}`);
  if (query.priority) where.push(`v.priority=${parameters.add(query.priority)}`);
  if (query.from || query.to) {
    const timezone = parameters.add(query.timezone);
    if (query.from) {
      where.push(
        `v.scheduled_at>=(${parameters.add(query.from)}::date::timestamp at time zone ${timezone})`,
      );
    }
    if (query.to) {
      where.push(
        `v.scheduled_at<(((${parameters.add(query.to)}::date+1)::timestamp) at time zone ${timezone})`,
      );
    }
  }
  return where;
}

export const taskOverdueSql =
  "t.status in ('PENDING','IN_PROGRESS') and ((t.due_date+coalesce(t.due_time,time '23:59:59')) at time zone t.timezone)<now()";

export function taskScope(
  query: ReportAnalyticsQuery,
  actor: ReportActor,
  parameters: SqlParameters,
): string[] {
  const where: string[] = [];
  if (actor.role === "SUPERVISOR") {
    const user = parameters.add(actor.userId);
    where.push(`t.responsible_user_id=${user}`, `a.owner_user_id=${user}`);
  }
  if (query.responsibleUserId)
    where.push(`t.responsible_user_id=${parameters.add(query.responsibleUserId)}`);
  if (query.accountId) where.push(`t.account_id=${parameters.add(query.accountId)}`);
  if (query.city) where.push(`a.city=${parameters.add(query.city)}`);
  if (query.accountStatus) where.push(`a.status=${parameters.add(query.accountStatus)}`);
  if (query.taskStatus) where.push(`t.status=${parameters.add(query.taskStatus)}`);
  if (query.priority) where.push(`t.priority=${parameters.add(query.priority)}`);
  if (query.from) where.push(`t.due_date>=${parameters.add(query.from)}::date`);
  if (query.to) where.push(`t.due_date<=${parameters.add(query.to)}::date`);
  if (query.overdue !== undefined)
    where.push(query.overdue ? taskOverdueSql : `not (${taskOverdueSql})`);
  return where;
}

export function documentScope(
  query: ReportAnalyticsQuery,
  actor: ReportActor,
  parameters: SqlParameters,
): string[] {
  const where: string[] = [];
  if (actor.role === "SUPERVISOR") where.push(`a.owner_user_id=${parameters.add(actor.userId)}`);
  if (query.responsibleUserId)
    where.push(`a.owner_user_id=${parameters.add(query.responsibleUserId)}`);
  if (query.accountId) where.push(`d.account_id=${parameters.add(query.accountId)}`);
  if (query.city) where.push(`a.city=${parameters.add(query.city)}`);
  if (query.accountStatus) where.push(`a.status=${parameters.add(query.accountStatus)}`);
  if (query.categoryId) where.push(`d.category_id=${parameters.add(query.categoryId)}`);
  if (query.documentStatus) where.push(`d.status=${parameters.add(query.documentStatus)}`);
  else where.push("d.status<>'DELETED'");
  if (query.from || query.to) {
    const timezone = parameters.add(query.timezone);
    if (query.from)
      where.push(
        `d.created_at>=(${parameters.add(query.from)}::date::timestamp at time zone ${timezone})`,
      );
    if (query.to)
      where.push(
        `d.created_at<(((${parameters.add(query.to)}::date+1)::timestamp) at time zone ${timezone})`,
      );
  }
  return where;
}

export function whereClause(where: string[]): string {
  return where.length ? `where ${where.join(" and ")}` : "";
}

export function trendUnit(
  query: Pick<ReportAnalyticsQuery, "from" | "to">,
): "day" | "week" | "month" {
  if (!query.from || !query.to) return "day";
  const days = Math.floor(
    (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000,
  );
  return days > 180 ? "month" : days > 45 ? "week" : "day";
}
