-- Connections (Gmail/Outlook/WhatsApp/AI/Google Sheets credentials) move
-- from per-project to per-organization: connect a provider once, every
-- project under that org uses it, instead of every new project needing its
-- own from-scratch setup. org_id has always been on this table (used only by
-- RLS until now) — project_id was the real scoping key everywhere; this
-- swaps which one matters going forward. project_id is left in place
-- (nullable, unused for new rows) rather than dropped, since existing rows'
-- historical value is harmless and this repo's migrations are additive-only.
alter table provider_connections alter column project_id drop not null;
alter table provider_connections add column connected_by_email text;

-- Re-key the three "one connected per kind" uniqueness guards (0005, 0024,
-- 0032) from project_id to org_id — same WHERE clauses, same intent (at
-- most one connected row per kind/account within the scope that now shares
-- connections), just a shared org instead of a single project.
drop index provider_connections_one_connected_per_kind;
drop index provider_connections_one_connected_per_google_account;
drop index provider_connections_one_connected_ai_per_provider;

create unique index provider_connections_one_connected_per_kind
  on provider_connections (org_id, kind)
  where status = 'connected' and kind not in ('google_sheets', 'ai');

create unique index provider_connections_one_connected_per_google_account
  on provider_connections (org_id, kind, account_label)
  where status = 'connected' and kind = 'google_sheets';

create unique index provider_connections_one_connected_ai_per_provider
  on provider_connections (org_id, kind, provider)
  where status = 'connected' and kind = 'ai';

-- No RLS change needed: provider_connections_select/_write (0002_rls.sql)
-- already gate on can_admin_org(org_id), which was always the right check
-- for an org-shared resource.
