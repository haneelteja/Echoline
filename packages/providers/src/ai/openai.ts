import type { AiCompleter, ConnectionTester } from "../types";

const DEFAULT_MODEL = "gpt-4o";

export const testOpenAi: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { ok: false, error: `OpenAI responded ${res.status}` };
  return { ok: true, accountLabel: credentials.model || DEFAULT_MODEL };
};

export const completeOpenAi: AiCompleter = async (credentials, request) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const messages = [request.system ? { role: "system", content: request.system } : null, { role: "user", content: request.user }].filter(Boolean);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: credentials.model || DEFAULT_MODEL, max_tokens: request.maxTokens ?? 2000, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI completion failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
};
