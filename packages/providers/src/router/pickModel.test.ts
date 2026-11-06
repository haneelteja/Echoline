import { describe, expect, it } from "vitest";
import { pickModel, type CatalogRow } from "./pickModel";

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    id: "test/model",
    pricingPrompt: 0.000001,
    pricingCompletion: 0.000002,
    pricingImage: 0.01,
    contextLength: 100_000,
    outputModalities: ["text"],
    supportsJsonMode: false,
    qualityTier: 3,
    ...overrides,
  };
}

const TOKENS = { prompt: 1000, completion: 500 };

describe("pickModel", () => {
  it("picks the cheapest candidate clearing the quality floor", () => {
    const catalog = [
      row({ id: "cheap-tier3", qualityTier: 3, pricingPrompt: 0.000001, pricingCompletion: 0.000002 }),
      row({ id: "expensive-tier3", qualityTier: 3, pricingPrompt: 0.00001, pricingCompletion: 0.00002 }),
      row({ id: "cheapest-tier1", qualityTier: 1, pricingPrompt: 0.0000001, pricingCompletion: 0.0000002 }),
    ];
    const picked = pickModel("template_generate", catalog, TOKENS);
    // template_generate requires tier >= 3 and json mode, so the tier-1
    // model (cheaper, but below the floor) must be excluded regardless of price.
    expect(picked?.modelId).toBe("cheap-tier3");
  });

  it("excludes models below the task's quality floor even if cheaper", () => {
    const catalog = [row({ id: "too-weak", qualityTier: 1, supportsJsonMode: true })];
    const picked = pickModel("template_generate", catalog, TOKENS);
    expect(picked).toBeNull();
  });

  it("excludes models under the minimum context length", () => {
    const catalog = [row({ id: "too-small", qualityTier: 3, supportsJsonMode: true, contextLength: 1000 })];
    const picked = pickModel("template_generate", catalog, TOKENS);
    expect(picked).toBeNull();
  });

  it("falls back to non-JSON-mode candidates when no JSON-mode model clears the floor", () => {
    const catalog = [row({ id: "no-json-but-qualifies", qualityTier: 3, supportsJsonMode: false })];
    const picked = pickModel("template_generate", catalog, TOKENS);
    expect(picked?.modelId).toBe("no-json-but-qualifies");
  });

  it("requires the task's output modality", () => {
    const catalog = [row({ id: "text-only", qualityTier: 3, outputModalities: ["text"] })];
    const picked = pickModel("image_generate", catalog, TOKENS);
    expect(picked).toBeNull();
  });

  it("uses per-image pricing, not prompt/completion token pricing, for image tasks", () => {
    const catalog = [
      row({ id: "cheap-image", outputModalities: ["image"], pricingImage: 0.01, pricingPrompt: 0.01, pricingCompletion: 0.01 }),
      row({ id: "expensive-image", outputModalities: ["image"], pricingImage: 0.05, pricingPrompt: 0, pricingCompletion: 0 }),
    ];
    // If this used token pricing, "expensive-image" (0 prompt/completion
    // cost) would win incorrectly, since estimatedTokens is irrelevant here.
    const picked = pickModel("image_generate", catalog, TOKENS);
    expect(picked?.modelId).toBe("cheap-image");
  });

  it("returns null for an empty catalog", () => {
    expect(pickModel("insights", [], TOKENS)).toBeNull();
  });

  it("picks a cheaper tier-2 model for insights, which only needs tier 2", () => {
    const catalog = [
      row({ id: "tier2-cheap", qualityTier: 2, pricingPrompt: 0.0000005, pricingCompletion: 0.000001 }),
      row({ id: "tier3-expensive", qualityTier: 3, pricingPrompt: 0.00001, pricingCompletion: 0.00002 }),
    ];
    const picked = pickModel("insights", catalog, TOKENS);
    expect(picked?.modelId).toBe("tier2-cheap");
  });
});
