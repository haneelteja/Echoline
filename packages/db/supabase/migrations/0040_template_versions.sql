-- Append-only version history for templates. Every successful save (PATCH)
-- inserts a row here capturing the resulting content, so the live `templates`
-- row always mirrors the latest version. Reverting to an older version just
-- writes its content back through the same save path, which itself creates
-- a fresh version — history only ever grows, nothing is edited or deleted.
create table template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text,
  subject text,
  body text,
  category_lines jsonb not null default '{}',
  header_asset_id uuid references kb_assets(id) on delete set null,
  gallery_asset_ids uuid[] not null default '{}',
  cc_email text,
  reply_to_email text,
  body_is_html boolean not null default false,
  created_at timestamptz not null default now()
);
create index template_versions_template_id_idx on template_versions (template_id, created_at desc);

alter table template_versions enable row level security;
create policy template_versions_select on template_versions for select using (can_read_project(project_id));
create policy template_versions_insert on template_versions for insert with check (can_write_project(project_id));
-- No update/delete policy: this history is append-only and immutable.
