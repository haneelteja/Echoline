-- Deleting a contact is a hard, cascading delete today (messages,
-- message_events, lead_status_log all go with it via on-delete-cascade) —
-- there was no record anywhere that a lead was ever received, let alone
-- reviewed and removed. This is a snapshot taken right before that delete,
-- so the fact it existed survives the delete itself. Deliberately not a
-- soft-delete flag on contacts (that would mean every query on contacts
-- needs a "not deleted" filter forever) — a separate append-only table,
-- same reasoning as message_events.
create table deleted_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  -- Not a foreign key — the row it points at is gone by the time this is
  -- read back; kept only so a UI could ever cross-reference old links.
  original_contact_id uuid not null,
  name text not null,
  email text,
  phone text,
  category text,
  area text,
  source text,
  external_id text,
  raw_email text,
  raw_phone text,
  em_status text,
  wa_status text,
  original_created_at timestamptz,
  deleted_at timestamptz not null default now(),
  deleted_by text
);

create index deleted_contacts_project_idx on deleted_contacts(project_id, deleted_at desc);
-- Dedup lookups for intake.ts/sourceSync.ts/contactsImport.ts: "has this
-- lead already been reviewed and discarded?" before treating it as new.
create index deleted_contacts_external_id_idx on deleted_contacts(project_id, external_id) where external_id is not null;
create index deleted_contacts_email_idx on deleted_contacts(project_id, email) where email is not null;
create index deleted_contacts_phone_idx on deleted_contacts(project_id, phone) where phone is not null;

alter table deleted_contacts enable row level security;
-- Append-only, same reasoning as message_events: readable by project
-- members, insertable by writers, never updatable or deletable — editing
-- an audit log would defeat its entire purpose.
create policy deleted_contacts_select on deleted_contacts for select
  using (can_read_project(project_id));
create policy deleted_contacts_insert on deleted_contacts for insert
  with check (can_write_project(project_id));
