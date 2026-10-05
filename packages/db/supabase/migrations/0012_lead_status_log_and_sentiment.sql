-- "Response or Sentiment" — a manually-set pipeline stage, distinct from
-- em_status/wa_status (which track automated sequence progression). Default
-- lands every existing/new contact at the first stage without touching every
-- insert call site (intake, Excel import, OneDrive/Sheets sync, manual add).
alter table contacts add column sentiment text not null default 'Not Contacted';

-- "Status Log" — a growing, dated history of manual status/follow-up updates
-- per lead (distinct from message_events, which is send/delivery history).
-- Append-only: readable by project members, insertable by writers, never
-- updated or deleted — same convention as message_events.
create table lead_status_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null,
  follow_up_date date,
  created_at timestamptz not null default now()
);

create index lead_status_log_contact_idx on lead_status_log (contact_id, created_at desc);

alter table lead_status_log enable row level security;

create policy lead_status_log_select on lead_status_log for select
  using (can_read_project(project_id));
create policy lead_status_log_insert on lead_status_log for insert
  with check (can_write_project(project_id));
