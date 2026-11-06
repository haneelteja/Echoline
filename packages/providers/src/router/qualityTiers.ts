/**
 * Quality tiers for OpenRouter models, used by pickModel.ts to enforce a
 * per-task floor. Deliberately a small curated prefix allow-list rather than
 * OpenRouter's own `benchmarks.artificial_analysis` score — that field is
 * sparse (most of the 400+ models don't have it), so relying on it would
 * silently exclude perfectly good models that just haven't been benchmarked.
 * Needs manual review as new flagship models ship; that's an accepted
 * maintenance cost for a list that's easy to read and reason about.
 */

// Tier 3 (frontier): best reasoning/instruction-following — for tasks where
// output quality directly represents the business to a lead (template copy).
const TIER_3_PREFIXES = [
  "openai/gpt-5",
  "openai/gpt-4o",
  "anthropic/claude-opus",
  "anthropic/claude-sonnet",
  "google/gemini-2.5-pro",
  "google/gemini-3",
];

// Tier 2 (capable): good enough for internal/analytical text, not
// customer-facing copy.
const TIER_2_PREFIXES = [
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "anthropic/claude-haiku",
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash",
];

export function qualityTierFor(modelId: string): number {
  if (TIER_3_PREFIXES.some((p) => modelId.startsWith(p))) return 3;
  if (TIER_2_PREFIXES.some((p) => modelId.startsWith(p))) return 2;
  return 1;
}
