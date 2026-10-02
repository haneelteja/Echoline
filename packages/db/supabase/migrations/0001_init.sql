-- Echoline Phase 1: foundation, auth, roles
-- Status names and shapes follow docs/DATA_MODEL.md exactly.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------- enums ----------
create type membership_role as enum ('owner','admin','operator','viewer','client_viewer');
create type channel_kind as enum ('em','wa');
create type message_channel as enum ('email','whatsapp');
create type connection_kind as enum ('email','whatsapp');
create type connection_status as enum ('connected','needs_reconnect','disconnected');

-- per-channel status machine: not_contacted -> initial_sent -> fu1_sent -> fu2_sent -> completed
-- terminal: replied, opted_out, invalid, bounced, failed
create type contact_channel_status as enum (
  'not_contacted','initial_sent','fu1_sent','fu2_sent','completed',
  'replied','opted_out','invalid','bounced','failed'
);

create type message_status as enum (
  'queued','sent','delivered','opened','clicked','read','bounced','failed'
);

-- ---------- organizations & membership ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- ---------- projects ----------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  brand text,
  sender_name text,
  website text,
  wa_number text,
  accent text default '#3d1a5c',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

-- scopes a client_viewer membership down to specific projects; irrelevant for other roles
create table project_client_access (
  membership_id uuid not null references memberships(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (membership_id, project_id)
);

create table sequence_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  daily_cap int not null default 50,
  window_start time not null default '10:00',
  window_end time not null default '18:00',
  stop_on_reply boolean not null default true,
  em jsonb not null default '{"enabled":true,"steps":[{"delayDays":0},{"delayDays":2},{"delayDays":5}]}',
  wa jsonb not null default '{"enabled":true,"steps":[{"delayDays":0},{"delayDays":2},{"delayDays":5}]}',
  updated_at timestamptz not null default now()
);

create table channel_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  email jsonb not null default '{}',
  wa jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table brand_kb (
  project_id uuid primary key references projects(id) on delete cascade,
  about text,
  offer text,
  pricing text,
  tone text,
  cta text,
  skus jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table kb_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text,
  asset_id text,
  tags text[] not null default '{}',
  text text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- ---------- templates ----------
create table templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  channel message_channel not null,
  step int not null default 0,
  name text,
  subject text,
  body text,
  category_lines jsonb not null default '{}',
  meta_name text,
  meta_status text default 'Draft',
  ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Meta WABA template registration/approval tracking (Phase 6), stubbed now
create table wa_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  template_id uuid references templates(id) on delete set null,
  meta_name text not null,
  language text not null default 'en',
  category text,
  status text not null default 'Pending',
  rejection_reason text,
  quality_rating text,
  messaging_tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contacts (leads) ----------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  contact_person text,
  category text,
  area text,
  phone text,
  email text,
  source text,
  demo boolean not null default false,
  em_stage int not null default 0,
  em_status contact_channel_status not null default 'not_contacted',
  em_last timestamptz,
  em_track text,
  wa_stage int not null default 0,
  wa_status contact_channel_status not null default 'not_contacted',
  wa_last timestamptz,
  wa_track text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_project_idx on contacts(project_id);
create index contacts_email_idx on contacts(project_id, lower(email));
create index contacts_phone_idx on contacts(project_id, phone);

-- ---------- lead sources ----------
create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  name text not null,
  detail text,
  config jsonb not null default '{}',
  mode text,
  last_sync timestamptz,
  rows_added int not null default 0,
  rows_skipped int not null default 0,
  rows_failed int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- provider connections (credential vault, no secrets readable without master key) ----------
create table provider_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind connection_kind not null,
  provider text not null,
  account_label text,
  scopes text[] not null default '{}',
  status connection_status not null default 'disconnected',
  -- AES-256-GCM envelope ciphertext; never selected into API responses
  encrypted_credentials bytea,
  encryption_iv bytea,
  encryption_tag bytea,
  needs_reconnect_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- messages & append-only events ----------
create table messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel channel_kind not null,
  step int not null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  provider_message_id text,
  status message_status not null default 'queued',
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, contact_id, channel, step)
);

create index messages_project_idx on messages(project_id);

-- append-only; contact/message status is derived from this stream, never overwritten blindly
create table message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  channel channel_kind,
  event_type text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index message_events_project_idx on message_events(project_id, occurred_at desc);
create index message_events_message_idx on message_events(message_id);

-- ---------- billing (Phase 8 stubs) ----------
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  limits jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  status text not null default 'active',
  billing_provider text,
  external_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table usage_counters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  period text not null,
  metric text not null,
  count bigint not null default 0,
  unique (org_id, project_id, period, metric)
);

-- ---------- updated_at helper ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated_at before update on contacts for each row execute function set_updated_at();
create trigger trg_templates_updated_at before update on templates for each row execute function set_updated_at();
create trigger trg_provider_connections_updated_at before update on provider_connections for each row execute function set_updated_at();
create trigger trg_messages_updated_at before update on messages for each row execute function set_updated_at();
create trigger trg_wa_templates_updated_at before update on wa_templates for each row execute function set_updated_at();
