-- Knowledge base file assets: nested folders + uploaded photos/documents,
-- selectable from the template editor (email gallery images, WhatsApp
-- template header image/document). Public bucket — these are marketing
-- assets meant to be embedded in outbound messages, not sensitive files, so
-- a plain public URL can be used directly in emailHTML() and Meta's header
-- media parameters without a signing round-trip.

insert into storage.buckets (id, name, public)
values ('kb-assets', 'kb-assets', true)
on conflict (id) do nothing;

-- Object path convention: `${project_id}/${uuid}-${filename}` — the first
-- path segment is the project id, checked against the same can_read_project/
-- can_write_project helpers every other per-project table uses (0002_rls.sql).
create policy kb_assets_storage_select on storage.objects for select
  using (bucket_id = 'kb-assets' and can_read_project((storage.foldername(name))[1]::uuid));
create policy kb_assets_storage_insert on storage.objects for insert
  with check (bucket_id = 'kb-assets' and can_write_project((storage.foldername(name))[1]::uuid));
create policy kb_assets_storage_delete on storage.objects for delete
  using (bucket_id = 'kb-assets' and can_write_project((storage.foldername(name))[1]::uuid));

create table kb_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references kb_folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index kb_folders_project_idx on kb_folders(project_id);
create index kb_folders_parent_idx on kb_folders(parent_id);

create table kb_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  folder_id uuid references kb_folders(id) on delete set null,
  kind text not null check (kind in ('image','document')),
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index kb_assets_project_idx on kb_assets(project_id);
create index kb_assets_folder_idx on kb_assets(folder_id);

alter table kb_folders enable row level security;
alter table kb_assets enable row level security;

create policy kb_folders_select on kb_folders for select using (can_read_project(project_id));
create policy kb_folders_insert on kb_folders for insert with check (can_write_project(project_id));
create policy kb_folders_update on kb_folders for update using (can_write_project(project_id)) with check (can_write_project(project_id));
create policy kb_folders_delete on kb_folders for delete using (can_write_project(project_id));

create policy kb_assets_select on kb_assets for select using (can_read_project(project_id));
create policy kb_assets_insert on kb_assets for insert with check (can_write_project(project_id));
create policy kb_assets_update on kb_assets for update using (can_write_project(project_id)) with check (can_write_project(project_id));
create policy kb_assets_delete on kb_assets for delete using (can_write_project(project_id));

-- Email: multiple gallery images per template (emailHTML already renders up
-- to 3, see packages/core/src/template.ts). WhatsApp: a single header
-- image/document, since that's all Meta's template header component allows.
alter table templates add column header_asset_id uuid references kb_assets(id) on delete set null;
alter table templates add column gallery_asset_ids uuid[] not null default '{}';

-- Meta requires a resumable-upload "handle" for the header media at template
-- submission time (packages/providers' uploadMetaMedia) — kept here mainly
-- for audit/debugging, not re-read at send time (send time re-sends the
-- plain asset URL, which Meta re-fetches itself per message).
alter table wa_templates add column header_format text;
alter table wa_templates add column header_handle text;
