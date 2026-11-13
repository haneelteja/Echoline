-- Per-project, per-report-type configuration for the new Reports tab: a
-- daily "new leads" digest and a "leads by source" breakdown, each
-- independently configurable (recipient, format, send time, enabled).
-- One row per (project_id, report_type) — the unique index is what makes
-- "save this report's settings" an upsert, not insert-only.
create table report_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  report_type text not null, -- 'new_leads' | 'leads_by_source'
  enabled boolean not null default false,
  recipient_email text not null,
  format text not null default 'table', -- 'table' | 'excel'
  send_time time not null default '09:00',
  last_sent_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index report_configs_project_type_idx on report_configs(project_id, report_type);
create index report_configs_enabled_idx on report_configs(enabled) where enabled;

alter table report_configs enable row level security;

create policy report_configs_select on report_configs for select using (can_read_project(project_id));
create policy report_configs_write on report_configs for all using (can_write_project(project_id)) with check (can_write_project(project_id));
