import type { AiCompleter, ConnectionTester } from "../types";

const DEFAULT_MODEL = "gemini-2.0-flash";

export const testGemini: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) return { ok: false, error: `Gemini responded ${res.status}` };
  return { ok: true, accountLabel: credentials.model || DEFAULT_MODEL };
};

export const completeGemini: AiCompleter = async (credentials, request) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const model = credentials.model || DEFAULT_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: request.user }] }],
      systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined,
      generationConfig: { maxOutputTokens: request.maxTokens ?? 2000 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini completion failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
};
