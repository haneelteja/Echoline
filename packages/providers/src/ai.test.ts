import { afterEach, describe, expect, it, vi } from "vitest";
import { testAnthropic, completeAnthropic } from "./ai/anthropic";
import { testOpenAi, completeOpenAi, embedOpenAi } from "./ai/openai";
import { testGemini, completeGemini } from "./ai/gemini";

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testAnthropic", () => {
  it("requires an apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testAnthropic({});
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds on a valid key", async () => {
    mockFetchOnce(200, { content: [{ type: "text", text: "hi" }] });
    const result = await testAnthropic({ apiKey: "sk-ant-xxx" });
    expect(result.ok).toBe(true);
  });

  it("fails on a bad key", async () => {
    mockFetchOnce(401, {});
    const result = await testAnthropic({ apiKey: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("completeAnthropic", () => {
  it("returns the text block from the response", async () => {
    const fetchSpy = mockFetchOnce(200, { content: [{ type: "text", text: '{"ok":true}' }] });
    const result = await completeAnthropic({ apiKey: "sk-ant-xxx" }, { system: "sys", user: "write json" });
    expect(result).toBe('{"ok":true}');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "write json" }]);
  });

  it("throws on a failed completion", async () => {
    mockFetchOnce(429, { error: { message: "rate limited" } });
    await expect(completeAnthropic({ apiKey: "sk-ant-xxx" }, { user: "x" })).rejects.toThrow(/429/);
  });
});

describe("testOpenAi", () => {
  it("requires an apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testOpenAi({});
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds on a valid key", async () => {
    mockFetchOnce(200, { data: [] });
    const result = await testOpenAi({ apiKey: "sk-xxx" });
    expect(result.ok).toBe(true);
  });

  it("fails on a bad key", async () => {
    mockFetchOnce(401, {});
    const result = await testOpenAi({ apiKey: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("completeOpenAi", () => {
  it("returns the message content and includes the system prompt", async () => {
    const fetchSpy = mockFetchOnce(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    const result = await completeOpenAi({ apiKey: "sk-xxx" }, { system: "sys", user: "write json" });
    expect(result).toBe('{"ok":true}');
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "write json" },
    ]);
  });

  it("omits the system message when none is given", async () => {
    const fetchSpy = mockFetchOnce(200, { choices: [{ message: { content: "ok" } }] });
    await completeOpenAi({ apiKey: "sk-xxx" }, { user: "hi" });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("throws on a failed completion", async () => {
    mockFetchOnce(500, { error: "server error" });
    await expect(completeOpenAi({ apiKey: "sk-xxx" }, { user: "x" })).rejects.toThrow(/500/);
  });
});

describe("embedOpenAi", () => {
  it("requires an apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(embedOpenAi({}, "text")).rejects.toThrow(/apiKey/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the embedding vector and requests the 1536-dim model", async () => {
    const vector = Array(1536).fill(0.1);
    const fetchSpy = mockFetchOnce(200, { data: [{ embedding: vector }] });
    const result = await embedOpenAi({ apiKey: "sk-xxx" }, "brand facts about Elma Industries");
    expect(result).toEqual(vector);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: "text-embedding-3-small", input: "brand facts about Elma Industries" });
  });

  it("throws on a failed embedding request", async () => {
    mockFetchOnce(401, { error: "invalid key" });
    await expect(embedOpenAi({ apiKey: "bad" }, "text")).rejects.toThrow(/401/);
  });

  it("throws if the response has no embedding", async () => {
    mockFetchOnce(200, { data: [] });
    await expect(embedOpenAi({ apiKey: "sk-xxx" }, "text")).rejects.toThrow(/no embedding/);
  });
});

describe("testGemini", () => {
  it("requires an apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testGemini({});
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds on a valid key", async () => {
    mockFetchOnce(200, { models: [] });
    const result = await testGemini({ apiKey: "AIza-xxx" });
    expect(result.ok).toBe(true);
  });

  it("fails on a bad key", async () => {
    mockFetchOnce(400, {});
    const result = await testGemini({ apiKey: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("completeGemini", () => {
  it("joins candidate text parts and includes the system instruction", async () => {
    const fetchSpy = mockFetchOnce(200, { candidates: [{ content: { parts: [{ text: '{"ok"' }, { text: ":true}" }] } }] });
    const result = await completeGemini({ apiKey: "AIza-xxx" }, { system: "sys", user: "write json" });
    expect(result).toBe('{"ok":true}');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("gemini-2.0-flash:generateContent");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
  });

  it("throws on a failed completion", async () => {
    mockFetchOnce(403, { error: { message: "forbidden" } });
    await expect(completeGemini({ apiKey: "AIza-xxx" }, { user: "x" })).rejects.toThrow(/403/);
  });
});
