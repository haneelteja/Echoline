import type { CatalogRow } from "./pickModel";
import type { AiProviderId } from "../types";

/**
 * Builds the pickModel() candidate pool across every AI provider a project
 * has connected, not just one. OpenRouter already exposes a live
 * pricing/capability catalog; Anthropic/OpenAI/Gemini don't, so a direct
 * connection to one of those is ranked using that *same* OpenRouter-derived
 * catalog's entries for that vendor (e.g. a direct Anthropic connection is
 * compared using the "anthropic/*" rows OpenRouter already lists, with the
 * vendor prefix stripped before calling Anthropic's own adapter directly) —
 * an estimate, not exact billing, same stance already taken elsewhere in
 * this router. No separate hand-maintained price list for direct
 * connections.
 *
 * The composite id ("{provider}::{realModelId}") is opaque to pickModel —
 * it only ever compares ids by cost, never parses them — so this needed no
 * change to pickModel.ts itself. parseCandidateId() recovers the real
 * provider + model string afterward.
 */
export function buildCandidates(connectedProviders: AiProviderId[], openRouterCatalog: CatalogRow[]): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const provider of connectedProviders) {
    if (provider === "openrouter") {
      for (const row of openRouterCatalog) rows.push({ ...row, id: `openrouter::${row.id}` });
    } else {
      const prefix = `${provider}/`;
      for (const row of openRouterCatalog) {
        if (row.id.startsWith(prefix)) rows.push({ ...row, id: `${provider}::${row.id.slice(prefix.length)}` });
      }
    }
  }
  return rows;
}

export function parseCandidateId(compositeId: string): { provider: AiProviderId; modelId: string } {
  const sep = compositeId.indexOf("::");
  return { provider: compositeId.slice(0, sep) as AiProviderId, modelId: compositeId.slice(sep + 2) };
}
