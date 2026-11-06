import { describe, expect, it } from "vitest";
import { qualityTierFor } from "./qualityTiers";

describe("qualityTierFor", () => {
  it("rates flagship models as tier 3", () => {
    expect(qualityTierFor("anthropic/claude-opus-5.5")).toBe(3);
    expect(qualityTierFor("anthropic/claude-sonnet-5.5")).toBe(3);
    expect(qualityTierFor("openai/gpt-4o")).toBe(3);
  });

  it("does not let a small/cheap variant inherit its flagship's tier via a bare version prefix", () => {
    // Both matched a tier-3 prefix ("openai/gpt-5", "google/gemini-3") before
    // this was fixed — confirmed live (2026-11-06): the nano variant got
    // picked for a plain-text task and returned empty output.
    expect(qualityTierFor("openai/gpt-5-nano")).not.toBe(3);
    expect(qualityTierFor("google/gemini-3.8-flash")).not.toBe(3);
  });

  it("still rates explicit tier-2 models as tier 2, despite containing a small-variant marker", () => {
    expect(qualityTierFor("openai/gpt-4o-mini")).toBe(2);
    expect(qualityTierFor("anthropic/claude-haiku-5.5")).toBe(2);
    expect(qualityTierFor("google/gemini-2.5-flash")).toBe(2);
  });

  it("defaults anything unrecognized to tier 1", () => {
    expect(qualityTierFor("mistralai/some-small-model")).toBe(1);
  });
});
