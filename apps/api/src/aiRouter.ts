import Redis from "ioredis";
import { decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { pickModel, TASK_PROFILES, buildCandidates, parseCandidateId, type AiProviderId, type CatalogRow, type TaskType } from "@echoline/providers";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

// A separate connection from rateLimit.ts/schedulerQueue.ts's — same
// reasoning as those: each consumer in this app keeps its own small
// connection rather than sharing one module-wide.
let redis: Redis | null = null;
function getRedisConnection(): Redis {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  redis = new Redis(url, { maxRetriesPerRequest: null });
  return redis;
}

const CATALOG_CACHE_KEY = "ai_model_catalog:v1";
const CATALOG_CACHE_TTL_SECONDS = 600;

/**
 * ai_model_catalog is near-static reference data — apps/worker's
 * aiCatalogSync only refreshes it at most once a day — but was being
 * re-queried from Postgres on every single AI-router call. Cached in Redis
 * instead (shared with apps/worker/src/imapPoll.ts's identical query, same
 * REDIS_URL/key, same cache); aiCatalogSync deletes this key right after it
 * writes a fresh catalog so a refresh is visible immediately rather than
 * waiting out the TTL. Any Redis failure here just falls through to the
 * Postgres query — caching is purely additive, never a new failure mode.
 */
async function getModelCatalog(supabase: any): Promise<any[]> {
  const cached = await getRedisConnection()
    .get(CATALOG_CACHE_KEY)
    .catch(() => null);
  // A parse failure must fall through to the live query, not throw — same
  // reasoning as apps/worker/src/imapPoll.ts's identical cache reader.
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through to the live query below
    }
  }
  const { data: catalog } = await supabase.from("ai_model_catalog").select("*");
  const rows = catalog ?? [];
  await getRedisConnection()
    .set(CATALOG_CACHE_KEY, JSON.stringify(rows), "EX", CATALOG_CACHE_TTL_SECONDS)
    .catch(() => {});
  return rows;
}

export interface AiConnection {
  provider: string;
  credentials: Record<string, string>;
}

/**
 * Every connected AI provider for an organization, decrypted — not just the
 * most recently connected one. Multiple can be connected simultaneously since
 * migration 0032 (previously blocked by a DB unique index despite the app
 * layer assuming otherwise); this is what lets selectProviderAndModel
 * actually orchestrate across providers, not just within one. Connections
 * are shared across every project in the org (migration
 * 0041_connections_org_scoped.sql), so this is keyed by org, not project.
 */
export async function getAiConnections(supabase: any, orgId: string): Promise<AiConnection[]> {
  const { data: conns } = await supabase.from("provider_connections").select("*").eq("org_id", orgId).eq("kind", "ai").eq("status", "connected");
  return ((conns as any[]) ?? []).map((conn) => ({
    provider: conn.provider,
    credentials: JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey())),
  }));
}

function toCatalogRow(row: any): CatalogRow {
  return {
    id: row.id,
    pricingPrompt: Number(row.pricing_prompt),
    pricingCompletion: Number(row.pricing_completion),
    pricingImage: Number(row.pricing_image),
    contextLength: row.context_length,
    outputModalities: row.output_modalities ?? [],
    supportsJsonMode: row.supports_json_mode,
    qualityTier: row.quality_tier,
  };
}

/**
 * Picks the best (provider, model) pair across every AI provider a project
 * has connected — cost/quality-aware, not just "whichever was connected
 * most recently." Direct Anthropic/OpenAI/Gemini connections are ranked
 * using the *same* OpenRouter-derived ai_model_catalog's entries for that
 * vendor (see packages/providers/src/router/multiProviderCatalog.ts) — an
 * estimate, not exact billing, same stance taken everywhere else in this
 * router. Never throws: no catalog data at all, or no candidate clearing
 * the task's floor, just falls back to the first connected provider found —
 * exactly today's pre-orchestration behavior, not a failure.
 */
export async function selectProviderAndModel(
  supabase: any,
  connections: AiConnection[],
  task: TaskType,
  estimatedTokens: { prompt: number; completion: number }
): Promise<AiConnection> {
  const fallback = connections[0];
  if (!fallback) throw new Error("selectProviderAndModel called with no connections");

  const catalog = await getModelCatalog(supabase);
  if (!catalog.length) return fallback;

  const connectedProviders = connections.map((c) => c.provider as AiProviderId);
  const candidates = buildCandidates(connectedProviders, catalog.map(toCatalogRow));
  const picked = pickModel(task, candidates, estimatedTokens);
  if (!picked) return fallback;

  const { provider, modelId } = parseCandidateId(picked.modelId);
  const conn = connections.find((c) => c.provider === provider);
  if (!conn) return fallback; // shouldn't happen — candidates are only built from connected providers

  const row = (catalog as any[]).find((r) => r.id === (provider === "openrouter" ? modelId : `${provider}/${modelId}`));
  // Only request real JSON mode when the *task* actually wants JSON output
  // (template_generate/template_rewrite) — not just because the picked
  // model happens to support it. Confirmed live, 2026-11-06: forcing
  // response_format:json_object on insights/copilot (plain-text tasks)
  // broke them outright on some providers and returned empty text on others.
  const wantsJsonMode = TASK_PROFILES[task].requiresJsonMode && row?.supports_json_mode;
  return {
    provider,
    credentials: {
      ...conn.credentials,
      model: modelId,
      ...(wantsJsonMode ? { responseFormat: "json_object" } : {}),
    },
  };
}

/** Rough, non-billing-accurate heuristic — same "soft estimate, not billing
 * accuracy" stance apps/api/src/aiUsage.ts already takes for its own cap. */
export function estimateTokens(prompt: string, maxTokens: number): { prompt: number; completion: number } {
  return { prompt: Math.ceil(prompt.length / 4), completion: maxTokens };
}
