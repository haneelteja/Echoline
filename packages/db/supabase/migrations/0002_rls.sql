-- Echoline Phase 1: row level security
-- Roles: owner, admin, operator (write leads/templates/sequence), viewer (read-only),
-- client_viewer (read-only, limited to assigned projects via project_client_access).

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table projects enable row level security;
alter table project_client_access enable row level security;
alter table sequence_settings enable row level security;
alter table channel_settings enable row level security;
alter table brand_kb enable row level security;
alter table kb_items enable row level security;
alter table templates enable row level security;
alter table wa_templates enable row level security;
alter table contacts enable row level security;
alter table lead_sources enable row level security;
alter table provider_connections enable row level security;
alter table messages enable row level security;
alter table message_events enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table usage_counters enable row level security;

-- ---------- helper functions ----------
-- role of the current user within an org (null if not a member)
create or replace function membership_role_for(p_org_id uuid)
returns membership_role
language sql stable security definer set search_path = public as $$
  select role from memberships where org_id = p_org_id and user_id = auth.uid();
$$;

-- can the current user read this project at all
create or replace function can_read_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    where p.id = p_project_id
      and (
        m.role <> 'client_viewer'
        or exists (
          select 1 from project_client_access pca
          where pca.membership_id = m.id and pca.project_id = p.id
        )
      )
  );
$$;

-- can the current user write (operator and above) to this project
create or replace function can_write_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    where p.id = p_project_id
      and m.role in ('owner','admin','operator')
  );
$$;

-- can the current user administer org-level things (connections, billing, memberships)
create or replace function can_admin_org(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.role in ('owner','admin')
  );
$$;

-- ---------- organizations ----------
create policy org_select on organizations for select
  using (exists (select 1 from memberships m where m.org_id = organizations.id and m.user_id = auth.uid()));
create policy org_update on organizations for update
  using (can_admin_org(id)) with check (can_admin_org(id));

-- ---------- memberships ----------
create policy memberships_select on memberships for select
  using (user_id = auth.uid() or can_admin_org(org_id));
create policy memberships_write on memberships for all
  using (can_admin_org(org_id)) with check (can_admin_org(org_id));

-- ---------- projects ----------
create policy projects_select on projects for select
  using (can_read_project(id));
create policy projects_write on projects for insert
  with check (can_admin_org(org_id));
create policy projects_update on projects for update
  using (can_write_project(id)) with check (can_write_project(id));
create policy projects_delete on projects for delete
  using (can_admin_org(org_id));

-- ---------- project_client_access ----------
create policy pca_select on project_client_access for select
  using (exists (select 1 from memberships m where m.id = membership_id and m.user_id = auth.uid())
         or can_write_project(project_id));
create policy pca_write on project_client_access for all
  using (can_write_project(project_id)) with check (can_write_project(project_id));

-- ---------- generic per-project tables: read = can_read_project, write = can_write_project ----------
do $$
declare
  t text;
  rw_tables text[] := array['sequence_settings','channel_settings','brand_kb','kb_items','templates',
                             'wa_templates','contacts','lead_sources','messages'];
begin
  foreach t in array rw_tables loop
    execute format(
      'create policy %I_select on %I for select using (can_read_project(project_id));',
      t, t);
    execute format(
      'create policy %I_insert on %I for insert with check (can_write_project(project_id));',
      t, t);
    execute format(
      'create policy %I_update on %I for update using (can_write_project(project_id)) with check (can_write_project(project_id));',
      t, t);
    execute format(
      'create policy %I_delete on %I for delete using (can_write_project(project_id));',
      t, t);
  end loop;
end $$;

-- message_events: append-only. Readable by project members, insertable by writers,
-- never updatable or deletable (status is derived by replaying events, not editing them).
create policy message_events_select on message_events for select
  using (can_read_project(project_id));
create policy message_events_insert on message_events for insert
  with check (can_write_project(project_id));

-- provider_connections: org-admin only, full stop. Not just the encrypted
-- credential columns — even status/account_label/scopes are admin-only, both
-- here and in apps/api's connections routes (which read through this same
-- RLS as the calling user, not a service-role bypass). Operators manage
-- leads/templates/sequences but do not see provider connection state.
create policy provider_connections_select on provider_connections for select
  using (can_admin_org(org_id));
create policy provider_connections_write on provider_connections for all
  using (can_admin_org(org_id)) with check (can_admin_org(org_id));

-- ---------- billing: org-admin only ----------
create policy subscriptions_select on subscriptions for select using (can_admin_org(org_id));
create policy subscriptions_write on subscriptions for all using (can_admin_org(org_id)) with check (can_admin_org(org_id));
create policy usage_counters_select on usage_counters for select using (can_admin_org(org_id));
create policy plans_select on plans for select using (true);
