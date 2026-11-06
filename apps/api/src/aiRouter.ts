import { decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { pickModel, TASK_PROFILES, buildCandidates, parseCandidateId, type AiProviderId, type CatalogRow, type TaskType } from "@echoline/providers";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

export interface AiConnection {
  provider: string;
  credentials: Record<string, string>;
}

/**
 * Every connected AI provider for a project, decrypted — not just the most
 * recently connected one. Multiple can be connected simultaneously since
 * migration 0032 (previously blocked by a DB unique index despite the app
 * layer assuming otherwise); this is what lets selectProviderAndModel
 * actually orchestrate across providers, not just within one.
 */
export async function getAiConnections(supabase: any, projectId: string): Promise<AiConnection[]> {
  const { data: conns } = await supabase.from("provider_connections").select("*").eq("project_id", projectId).eq("kind", "ai").eq("status", "connected");
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

  const { data: catalog } = await supabase.from("ai_model_catalog").select("*");
  if (!catalog?.length) return fallback;

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
