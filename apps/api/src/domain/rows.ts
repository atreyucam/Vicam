import {
  commercialAccountSchema,
  commercialContactSchema,
  taskSchema,
  userSchema,
  visitSchema,
} from "@vicam/contracts";

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function mapUser(row: Record<string, unknown>) {
  return userSchema.parse({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at === null ? null : iso(row.last_login_at as Date),
    createdAt: iso(row.created_at as Date),
  });
}

export function mapAccount(row: Record<string, unknown>) {
  const fruits = Array.isArray(row.fruits) ? row.fruits : [];
  return commercialAccountSchema.parse({
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    accountType: row.account_type,
    ownerUserId: row.owner_user_id,
    countryCode: row.country_code,
    stateProvince: row.state_province,
    city: row.city,
    address: row.address,
    postalCode: row.postal_code,
    phone: row.phone,
    email: row.email,
    timezone: row.timezone,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    locationSource: row.location_source,
    locationCapturedAt:
      row.location_captured_at === null ? null : iso(row.location_captured_at as Date),
    fruitIds: fruits.map((fruit) => (fruit as { id: string }).id),
    fruits,
    status: row.status,
    version: row.version,
    ownerFullName: row.owner_full_name,
    primaryContactName: row.primary_contact_name,
    createdAt: iso(row.created_at as Date),
    updatedAt: iso(row.updated_at as Date),
  });
}

export function mapContact(row: Record<string, unknown>) {
  return commercialContactSchema.parse({
    id: row.id,
    accountId: row.account_id,
    fullName: row.full_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isPrimary: row.is_primary,
    version: row.version,
  });
}

export function mapVisit(row: Record<string, unknown>) {
  return visitSchema.parse({
    id: row.id,
    accountId: row.account_id,
    accountDisplayName: row.account_display_name,
    responsibleUserId: row.responsible_user_id,
    responsibleFullName: row.responsible_full_name,
    scheduledAt: iso(row.scheduled_at as Date),
    timezone: row.timezone,
    reason: row.reason,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    result: row.result,
    observation: row.observation,
    actualStartedAt: row.actual_started_at === null ? null : iso(row.actual_started_at as Date),
    actualEndedAt: row.actual_ended_at === null ? null : iso(row.actual_ended_at as Date),
    cancellationReason: row.cancellation_reason,
    version: row.version,
  });
}

export function mapTask(row: Record<string, unknown>) {
  const dueDate =
    row.due_date instanceof Date
      ? row.due_date.toISOString().slice(0, 10)
      : typeof row.due_date === "string"
        ? row.due_date.slice(0, 10)
        : "";
  const dueTime = typeof row.due_time === "string" ? row.due_time.slice(0, 8) : null;
  return taskSchema.parse({
    id: row.id,
    accountId: row.account_id,
    accountDisplayName: row.account_display_name,
    visitId: row.visit_id,
    responsibleUserId: row.responsible_user_id,
    responsibleFullName: row.responsible_full_name,
    title: row.title,
    description: row.description,
    dueDate,
    dueTime,
    timezone: row.timezone,
    priority: row.priority,
    status: row.status,
    overdue: row.overdue,
    completedAt: row.completed_at === null ? null : iso(row.completed_at as Date),
    visitScheduledAt: row.visit_scheduled_at == null ? null : iso(row.visit_scheduled_at as Date),
    visitReason: row.visit_reason,
    version: row.version,
  });
}
