import type { AiCompleter, ConnectionTester } from "../types";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export const testAnthropic: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  // No dedicated whoami endpoint; a 1-token completion validates the key
  // without meaningful cost.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: credentials.model || DEFAULT_MODEL, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
  });
  if (!res.ok) return { ok: false, error: `Anthropic responded ${res.status}` };
  return { ok: true, accountLabel: credentials.model || DEFAULT_MODEL };
};

export const completeAnthropic: AiCompleter = async (credentials, request) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: credentials.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? 2000,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic completion failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return data.content?.find((c) => c.type === "text")?.text ?? "";
};
