-- Removes the 'operator' role entirely and renames 'client_viewer' to
-- 'project_viewer' (same semantics — read-only, scoped to explicitly
-- assigned projects via project_client_access — just a clearer name).
--
-- Postgres has no `ALTER TYPE ... DROP VALUE`, so actually removing
-- 'operator' (not just leaving it unused forever) means swapping the enum
-- type itself: rename the old one out of the way, create the replacement
-- without 'operator' and with 'project_viewer' already correctly named,
-- remap every column that uses it, then drop the old type.
--
-- The role model collapses from 5 tiers to 4: owner, admin, viewer,
-- project_viewer. 'operator' used to mean "can write project data but can't
-- see connections/billing" — a tier between admin and viewer. Removing it
-- means can_write_project and can_admin_org are no longer distinct checks
-- in practice (both now mean owner/admin), though kept as two separate
-- functions below since every call site already names the one it means,
-- and a future role could reintroduce the distinction without touching
-- every call site again.

-- Any existing operator memberships fold up to admin, not down to viewer —
-- losing write access entirely would be the bigger surprise for anyone
-- actually relying on operator access to do their job.
update memberships set role = 'admin' where role = 'operator';

-- membership_role_for() is defined in 0002_rls.sql but never actually
-- called anywhere (confirmed: zero references in any RLS policy or
-- application code) — dropped here rather than redefined, since keeping
-- dead code around just to preserve a type dependency isn't worth it.
drop function if exists membership_role_for(uuid);

alter type membership_role rename to membership_role_old;
create type membership_role as enum ('owner', 'admin', 'viewer', 'project_viewer');

alter table memberships alter column role drop default;
alter table memberships alter column role type membership_role using (
  case role::text when 'client_viewer' then 'project_viewer' else role::text end
)::membership_role;
alter table memberships alter column role set default 'viewer';

alter table invites alter column role type membership_role using (
  case role::text when 'client_viewer' then 'project_viewer' else role::text end
)::membership_role;

drop type membership_role_old;

-- can_read_project's client_viewer-scoping check and can_write_project's
-- operator inclusion both need the new labels/tiers.
create or replace function can_read_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    where p.id = p_project_id
      and (
        m.role <> 'project_viewer'
        or exists (
          select 1 from project_client_access pca
          where pca.membership_id = m.id and pca.project_id = p.id
        )
      )
  );
$$;

create or replace function can_write_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    join memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    where p.id = p_project_id
      and m.role in ('owner','admin')
  );
$$;
