import { TASK_PROFILES, type TaskType } from "./taskProfiles";

export interface CatalogRow {
  id: string;
  pricingPrompt: number;
  pricingCompletion: number;
  /** USD per generated image — OpenRouter's `pricing.image` field. Token
   * pricing doesn't apply to image models, so image_generate needs its own
   * cost basis rather than reusing prompt/completion pricing (which would
   * otherwise be 0 for every image model and make "cheapest" meaningless). */
  pricingImage: number;
  contextLength: number | null;
  outputModalities: string[];
  supportsJsonMode: boolean;
  qualityTier: number;
}

export interface PickedModel {
  modelId: string;
  estimatedCostUsd: number;
}

function candidatesFor(task: TaskType, catalog: CatalogRow[], requireJsonMode: boolean): CatalogRow[] {
  const profile = TASK_PROFILES[task];
  return catalog.filter(
    (m) =>
      m.qualityTier >= profile.minQualityTier &&
      (profile.minContextLength === 0 || (m.contextLength ?? 0) >= profile.minContextLength) &&
      m.outputModalities.includes(profile.outputModality) &&
      (!requireJsonMode || m.supportsJsonMode)
  );
}

/**
 * Picks the cheapest catalog model clearing the task's quality floor —
 * "cheapest that's good enough," not "best possible regardless of cost."
 * Returns null when nothing qualifies at all (caller falls back to the
 * connection's own configured default model, same as before this existed).
 */
export function pickModel(task: TaskType, catalog: CatalogRow[], estimatedTokens: { prompt: number; completion: number }): PickedModel | null {
  const profile = TASK_PROFILES[task];
  let candidates = candidatesFor(task, catalog, profile.requiresJsonMode);
  // A JSON-mode requirement with zero candidates: prefer a slightly-less-
  // reliable JSON model (via prompt-wording fallback) over no routing at all.
  if (candidates.length === 0 && profile.requiresJsonMode) {
    candidates = candidatesFor(task, catalog, false);
  }
  if (candidates.length === 0) return null;

  const costOf =
    profile.outputModality === "image"
      ? (row: CatalogRow) => row.pricingImage
      : (row: CatalogRow) => row.pricingPrompt * estimatedTokens.prompt + row.pricingCompletion * estimatedTokens.completion;

  let best: { row: CatalogRow; cost: number } | null = null;
  for (const row of candidates) {
    const cost = costOf(row);
    if (!best || cost < best.cost) best = { row, cost };
  }
  return { modelId: best!.row.id, estimatedCostUsd: best!.cost };
}
