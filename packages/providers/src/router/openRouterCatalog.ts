import { qualityTierFor } from "./qualityTiers";
import type { CatalogRow } from "./pickModel";

export interface OpenRouterCatalogEntry extends CatalogRow {
  name: string;
}

interface RawOpenRouterModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string; image?: string };
  architecture?: { output_modalities?: string[] };
  supported_parameters?: string[];
}

function toCatalogEntry(m: RawOpenRouterModel): OpenRouterCatalogEntry {
  return {
    id: m.id,
    name: m.name ?? m.id,
    // OpenRouter's pricing fields are USD-per-token strings (e.g. "0.00003").
    pricingPrompt: Number(m.pricing?.prompt ?? 0),
    pricingCompletion: Number(m.pricing?.completion ?? 0),
    pricingImage: Number(m.pricing?.image ?? 0),
    contextLength: m.context_length ?? null,
    outputModalities: m.architecture?.output_modalities ?? ["text"],
    supportsJsonMode: (m.supported_parameters ?? []).includes("response_format"),
    qualityTier: qualityTierFor(m.id),
  };
}

/** Fetches OpenRouter's full model catalog and transforms it into rows
 * matching ai_model_catalog's columns. Any project's connected OpenRouter
 * key works here — the catalog itself isn't project-specific, just *a*
 * valid key is needed to call the endpoint. */
export async function fetchOpenRouterCatalog(apiKey: string): Promise<OpenRouterCatalogEntry[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter model list failed (${res.status}): ${body}`);
  }
  const body = (await res.json()) as { data?: RawOpenRouterModel[] };
  return (body.data ?? []).map(toCatalogEntry);
}
