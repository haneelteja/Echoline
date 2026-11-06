-- Cached OpenRouter model catalog for the intelligent AI router
-- (apps/api/src/aiRouter.ts, packages/providers/src/router/*). Not
-- project-scoped — the catalog (pricing/context/capability per model) is
-- the same for every tenant, refreshed by apps/worker/src/aiCatalogSync.ts
-- riding the existing 5-minute scheduler tick (only actually refetched when
-- stale, same isDue()-style cadence as waQualityPoll.ts). Written by the
-- worker's admin client only; any authenticated user can read it, since it's
-- just OpenRouter's own public pricing/capability data, nothing tenant-specific.
create table ai_model_catalog (
  id text primary key,                              -- OpenRouter model id, e.g. "openai/gpt-4o-mini"
  name text not null,
  pricing_prompt numeric not null,                   -- USD per prompt token
  pricing_completion numeric not null,               -- USD per completion token
  pricing_image numeric not null default 0,          -- USD per generated image (image models only)
  context_length int,
  output_modalities text[] not null default '{}',    -- includes 'image' for image-capable models
  supports_json_mode boolean not null default false, -- 'response_format' in supported_parameters
  quality_tier int not null,                         -- 1 (basic) .. 3 (frontier) — see qualityTiers.ts
  fetched_at timestamptz not null default now()
);

alter table ai_model_catalog enable row level security;

create policy "ai_model_catalog_select_any_authenticated" on ai_model_catalog
  for select
  to authenticated
  using (true);
