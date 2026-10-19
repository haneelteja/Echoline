import type { AiCompleter, ConnectionTester } from "../types";

// OpenRouter proxies many providers behind one OpenAI-compatible API, so
// model slugs are provider-prefixed (e.g. "anthropic/claude-3.5-sonnet",
// "openai/gpt-4o-mini") rather than bare model names — unlike the other AI
// adapters' DEFAULT_MODEL, this one must stay a valid OpenRouter slug.
const DEFAULT_MODEL = "openai/gpt-4o-mini";

export const testOpenRouter: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  // /api/v1/key is OpenRouter's lightweight authenticated endpoint — returns
  // the key's rate limit/credit info, 401s on a bad key, no model call needed.
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, error: `OpenRouter responded ${res.status}` };
  return { ok: true, accountLabel: credentials.model || DEFAULT_MODEL };
};

export const completeOpenRouter: AiCompleter = async (credentials, request) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const messages = [request.system ? { role: "system", content: request.system } : null, { role: "user", content: request.user }].filter(Boolean);
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter's docs ask integrations to
      // send for their analytics/leaderboards — harmless to include.
      "HTTP-Referer": "https://echoline-omega.vercel.app",
      "X-Title": "Echoline",
    },
    body: JSON.stringify({ model: credentials.model || DEFAULT_MODEL, max_tokens: request.maxTokens ?? 2000, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter completion failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
};
