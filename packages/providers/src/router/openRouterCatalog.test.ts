import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterCatalog } from "./openRouterCatalog";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockModelsResponse(models: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: models }),
      text: async () => "",
    })
  );
}

describe("fetchOpenRouterCatalog", () => {
  it("excludes :batch model variants — they 404 against /chat/completions", async () => {
    mockModelsResponse([
      { id: "openai/gpt-5-nano", pricing: { prompt: "0.0001", completion: "0.0002" } },
      { id: "openai/gpt-5-nano:batch", pricing: { prompt: "0.00005", completion: "0.0001" } },
    ]);
    const catalog = await fetchOpenRouterCatalog("test-key");
    expect(catalog.map((m) => m.id)).toEqual(["openai/gpt-5-nano"]);
  });

  it("keeps other suffix variants (:free, :nitro, :online)", async () => {
    mockModelsResponse([
      { id: "openai/gpt-5-nano:free", pricing: { prompt: "0", completion: "0" } },
      { id: "openai/gpt-5-nano:nitro", pricing: { prompt: "0.0001", completion: "0.0002" } },
      { id: "openai/gpt-5-nano:online", pricing: { prompt: "0.0001", completion: "0.0002" } },
    ]);
    const catalog = await fetchOpenRouterCatalog("test-key");
    expect(catalog.map((m) => m.id)).toEqual(["openai/gpt-5-nano:free", "openai/gpt-5-nano:nitro", "openai/gpt-5-nano:online"]);
  });
});
