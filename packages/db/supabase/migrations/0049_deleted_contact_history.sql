-- Deleting a contact cascades away its messages, message_events, and
-- lead_status_log (see 0001_init.sql/0012's on-delete-cascade FKs) — the
-- deleted_contacts snapshot (migration 0048) preserves the lead itself, but
-- not what was ever sent to it. These three tables mirror that history
-- under the new deleted_contacts snapshot id (the original contact_id won't
-- exist anymore once the delete happens), populated by the API right
-- before the delete — same append-only convention as every *_log table.
create table deleted_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  deleted_contact_id uuid not null references deleted_contacts(id) on delete cascade,
  channel channel_kind not null,
  step int not null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  provider_message_id text,
  status message_status not null,
  queued_at timestamptz not null,
  sent_at timestamptz,
  updated_at timestamptz
);

create index deleted_messages_contact_idx on deleted_messages(deleted_contact_id);

create table deleted_message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  deleted_contact_id uuid not null references deleted_contacts(id) on delete cascade,
  deleted_message_id uuid references deleted_messages(id) on delete set null,
  channel channel_kind,
  event_type text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null
);

create index deleted_message_events_contact_idx on deleted_message_events(deleted_contact_id, occurred_at desc);

create table deleted_lead_status_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  deleted_contact_id uuid not null references deleted_contacts(id) on delete cascade,
  status text not null,
  follow_up_date date,
  original_created_at timestamptz not null
);

create index deleted_lead_status_log_contact_idx on deleted_lead_status_log(deleted_contact_id);

alter table deleted_messages enable row level security;
alter table deleted_message_events enable row level security;
alter table deleted_lead_status_log enable row level security;

create policy deleted_messages_select on deleted_messages for select
  using (can_read_project(project_id));
create policy deleted_messages_insert on deleted_messages for insert
  with check (can_write_project(project_id));

create policy deleted_message_events_select on deleted_message_events for select
  using (can_read_project(project_id));
create policy deleted_message_events_insert on deleted_message_events for insert
  with check (can_write_project(project_id));

create policy deleted_lead_status_log_select on deleted_lead_status_log for select
  using (can_read_project(project_id));
create policy deleted_lead_status_log_insert on deleted_lead_status_log for insert
  with check (can_write_project(project_id));
