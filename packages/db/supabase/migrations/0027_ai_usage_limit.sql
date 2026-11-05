-- Atomic increment for usage_counters, used to enforce a per-org monthly AI
-- call cap (apps/api/src/aiUsage.ts). project_id is always provided (never
-- null) so this matches usage_counters' existing unique constraint exactly —
-- Postgres doesn't treat two NULLs as equal for uniqueness, so an org-level
-- (project_id null) row would let concurrent requests create duplicates.
create or replace function increment_usage_counter(p_org_id uuid, p_project_id uuid, p_period text, p_metric text)
returns bigint as $$
  insert into usage_counters (org_id, project_id, period, metric, count)
  values (p_org_id, p_project_id, p_period, p_metric, 1)
  on conflict (org_id, project_id, period, metric)
  do update set count = usage_counters.count + 1
  returning count;
$$ language sql;
