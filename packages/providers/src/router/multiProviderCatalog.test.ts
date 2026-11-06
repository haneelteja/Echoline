import { describe, expect, it } from "vitest";
import { buildCandidates, parseCandidateId } from "./multiProviderCatalog";
import type { CatalogRow } from "./pickModel";

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    id: "test/model",
    pricingPrompt: 0.000001,
    pricingCompletion: 0.000002,
    pricingImage: 0,
    contextLength: 100_000,
    outputModalities: ["text"],
    supportsJsonMode: false,
    qualityTier: 3,
    ...overrides,
  };
}

const CATALOG: CatalogRow[] = [
  row({ id: "anthropic/claude-sonnet-5.5" }),
  row({ id: "anthropic/claude-haiku-5.5" }),
  row({ id: "openai/gpt-5" }),
  row({ id: "google/gemini-3-pro" }),
];

describe("buildCandidates", () => {
  it("a project with only a direct Anthropic connection only sees anthropic/* rows, prefix stripped", () => {
    const candidates = buildCandidates(["anthropic"], CATALOG);
    expect(candidates.map((c) => c.id).sort()).toEqual(["anthropic::claude-haiku-5.5", "anthropic::claude-sonnet-5.5"]);
  });

  it("a project with OpenRouter connected sees the entire catalog, ids unchanged except the composite prefix", () => {
    const candidates = buildCandidates(["openrouter"], CATALOG);
    expect(candidates).toHaveLength(CATALOG.length);
    expect(candidates.map((c) => c.id)).toContain("openrouter::anthropic/claude-sonnet-5.5");
  });

  it("multiple connected providers produce the union of their eligible candidates", () => {
    const candidates = buildCandidates(["anthropic", "openai"], CATALOG);
    expect(candidates.map((c) => c.id).sort()).toEqual(["anthropic::claude-haiku-5.5", "anthropic::claude-sonnet-5.5", "openai::gpt-5"]);
  });

  it("a direct connection to a provider with no matching catalog rows yields no candidates (not an error)", () => {
    expect(buildCandidates(["gemini"], [row({ id: "anthropic/claude-sonnet-5.5" })])).toEqual([]);
  });
});

describe("parseCandidateId", () => {
  it("round-trips provider and model id through the composite id", () => {
    expect(parseCandidateId("anthropic::claude-sonnet-5.5")).toEqual({ provider: "anthropic", modelId: "claude-sonnet-5.5" });
    expect(parseCandidateId("openrouter::anthropic/claude-sonnet-5.5")).toEqual({ provider: "openrouter", modelId: "anthropic/claude-sonnet-5.5" });
  });
});
