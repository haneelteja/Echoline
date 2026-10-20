-- Team invites — the piece the existing memberships/RLS model was always
-- ready for (see 0002_rls.sql's can_admin_org-gated memberships policies)
-- but had no API/UI path to actually use. Only a token hash is stored,
-- same convention as lead_sources' webhook/form tokens (apps/api/src/routes/
-- sources.ts) — the plaintext only ever exists in the invite email.
create type invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  -- Deliberately excludes 'owner' — the project/org creator stays owner
  -- unchanged; everyone else invited in is admin/operator/viewer/client_viewer.
  role membership_role not null,
  invited_by uuid not null references auth.users(id),
  token_hash text not null unique,
  status invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index invites_org_idx on invites (org_id);
create index invites_email_idx on invites (lower(email));

alter table invites enable row level security;

-- Management (create/list/revoke) is admin-only, same gate as memberships
-- itself. Accepting an invite is handled by apps/api via the service-role
-- admin client (apps/api/src/routes/invites.ts) — the invitee legitimately
-- has no org access yet to satisfy can_admin_org, so that path intentionally
-- bypasses RLS after verifying the token server-side, rather than needing a
-- policy that would otherwise let an unauthenticated-for-this-org request
-- read other members' invites.
create policy invites_select on invites for select
  using (can_admin_org(org_id));
create policy invites_insert on invites for insert
  with check (can_admin_org(org_id));
create policy invites_update on invites for update
  using (can_admin_org(org_id)) with check (can_admin_org(org_id));
