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

// A bare version prefix (e.g. "openai/gpt-5") matches every size variant
// under it, including small/cheap ones a provider ships alongside the
// flagship — "openai/gpt-5-nano" and "google/gemini-3.8-flash" both matched
// a tier-3 prefix this way, confirmed live (2026-11-06): the nano variant
// got picked for "insights" and returned empty output, almost certainly a
// reasoning-heavy small model spending its whole token budget on hidden
// reasoning before emitting anything visible — same failure class as the
// Nemotron maxTokens issue fixed earlier. These markers catch a small/cheap
// variant regardless of which tier-3 prefix it happens to also match;
// TIER_2_PREFIXES still explicitly lists several of these on purpose, so an
// exact tier-2 match is checked first and isn't excluded by this.
const SMALL_VARIANT_MARKERS = ["nano", "mini", "flash", "lite", "haiku", "small"];

export function qualityTierFor(modelId: string): number {
  const lower = modelId.toLowerCase();
  if (TIER_2_PREFIXES.some((p) => modelId.startsWith(p))) return 2;
  const isSmallVariant = SMALL_VARIANT_MARKERS.some((marker) => lower.includes(marker));
  if (!isSmallVariant && TIER_3_PREFIXES.some((p) => modelId.startsWith(p))) return 3;
  return 1;
}
