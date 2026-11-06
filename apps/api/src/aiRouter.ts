import { pickModel, type CatalogRow, type TaskType } from "@echoline/providers";

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
 * Overrides a project's connected AI credentials' model (and, when picked
 * model supports it, requests real JSON mode) for OpenRouter connections
 * only — no live catalog exists for direct Anthropic/OpenAI/Gemini
 * connections, so those fall through unchanged, same as before this router
 * existed. Never throws: a missing/empty catalog or no qualifying model
 * just means "use the connection's own configured default," not a failure.
 */
export async function selectModel(
  supabase: any,
  conn: { provider: string; credentials: Record<string, string> },
  task: TaskType,
  estimatedTokens: { prompt: number; completion: number }
): Promise<Record<string, string>> {
  if (conn.provider !== "openrouter") return conn.credentials;
  const { data: catalog } = await supabase.from("ai_model_catalog").select("*");
  if (!catalog?.length) return conn.credentials;
  const picked = pickModel(task, catalog.map(toCatalogRow), estimatedTokens);
  if (!picked) return conn.credentials;
  const row = (catalog as any[]).find((r) => r.id === picked.modelId);
  return {
    ...conn.credentials,
    model: picked.modelId,
    ...(row?.supports_json_mode ? { responseFormat: "json_object" } : {}),
  };
}

/** Rough, non-billing-accurate heuristic — same "soft estimate, not billing
 * accuracy" stance apps/api/src/aiUsage.ts already takes for its own cap. */
export function estimateTokens(prompt: string, maxTokens: number): { prompt: number; completion: number } {
  return { prompt: Math.ceil(prompt.length / 4), completion: maxTokens };
}
