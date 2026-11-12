-- provider_connections had only partial unique indexes scoped to
-- status='connected' (0005/0024/0032, re-keyed to org_id by 0041) — no plain
-- index on org_id itself, so GET /orgs/:orgId/connections (every status, not
-- just connected) was a full sequential scan on every Organization page
-- load. lead_sources had no index at all beyond its primary key, despite
-- every Sources page load, the realtime postgres_changes subscription, and
-- apps/worker/src/sourceSync.ts all filtering by project_id.
create index provider_connections_org_idx on provider_connections (org_id);
create index lead_sources_project_idx on lead_sources (project_id);
