CREATE INDEX commercial_accounts_page_idx
  ON commercial_accounts(normalized_display_name,id);--> statement-breakpoint

CREATE INDEX visits_page_idx
  ON visits(scheduled_at,id);--> statement-breakpoint

CREATE INDEX tasks_page_idx
  ON tasks(due_date,due_time,id);--> statement-breakpoint
