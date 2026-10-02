-- At most one *connected* provider per (project, kind). Without this, nothing
-- stops a user from connecting a second email/whatsapp provider (or
-- reconnecting Gmail via OAuth twice) while the first is still "connected" —
-- the send workers assume exactly one, and `.maybeSingle()` errors out on
-- multiple rows, breaking every send for that project with a confusing
-- "No connected provider" message (the real "multiple rows" error from
-- PostgREST gets discarded since only `data`, not `error`, was being checked).
-- apps/api now also disconnects any prior same-kind connection before
-- inserting a new one, so this index should never actually reject a normal
-- request — it's the safety net for races and the OAuth callback path.
create unique index provider_connections_one_connected_per_kind
  on provider_connections (project_id, kind)
  where status = 'connected';
