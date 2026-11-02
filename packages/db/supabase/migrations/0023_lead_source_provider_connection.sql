-- Pins a lead source to the specific provider_connections row it syncs
-- through, so a project can have more than one Google Sheets (or OneDrive)
-- connection without sources ambiguously picking "the one connected
-- provider of this kind" — the previous, single-account-only behavior.
-- Nullable: existing sources (created before this column existed) fall back
-- to the old kind-based lookup in apps/worker/src/sourceSync.ts.
alter table lead_sources add column provider_connection_id uuid references provider_connections(id) on delete set null;
