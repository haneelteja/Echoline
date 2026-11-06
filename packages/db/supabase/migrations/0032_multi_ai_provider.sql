-- Lets a project connect more than one AI provider at once (Anthropic +
-- OpenAI + OpenRouter simultaneously, etc.) so the intelligent router
-- (apps/api/src/aiRouter.ts) can genuinely orchestrate across providers,
-- not just across models within whichever single one happened to be
-- connected. The app layer already intended this — connections.ts's
-- demoteSiblingConnections() has always skipped kind='ai' — but the DB-level
-- unique index never actually granted the exemption (confirmed 2026-11-06
-- while building the single-provider version of this router), so in
-- practice only one AI connection could ever be status='connected' at a
-- time. Mirrors the google_sheets exemption already carved out in
-- 0024_google_sheets_multi_account.sql.
drop index provider_connections_one_connected_per_kind;

create unique index provider_connections_one_connected_per_kind
  on provider_connections (project_id, kind)
  where status = 'connected' and kind not in ('google_sheets', 'ai');

-- Still at most one *connected* row per provider within a project — no
-- reason to allow two separate OpenAI keys connected to the same project
-- simultaneously, only different providers.
create unique index provider_connections_one_connected_ai_per_provider
  on provider_connections (project_id, kind, provider)
  where status = 'connected' and kind = 'ai';
