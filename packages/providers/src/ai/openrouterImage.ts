import type { ImageGenerator } from "../types";

// OpenRouter's dedicated Image API (POST /api/v1/images, base64 in/out) —
// not the /chat/completions route with a "modalities" array, which OpenRouter's
// own docs confirm bills combined text+image tokens and ends up ~10x pricier
// for the same output. google/gemini-2.5-flash-image is OpenRouter's own
// documented example model for this endpoint (confirmed against their live
// docs, 2026-11-06) — a reasonable default; override via credentials.model
// same as every other adapter in this package.
const DEFAULT_MODEL = "google/gemini-2.5-flash-image";

export const generateImage: ImageGenerator = async (credentials, prompt) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://echoline-omega.vercel.app",
      "X-Title": "Echoline",
    },
    body: JSON.stringify({ model: credentials.model || DEFAULT_MODEL, prompt }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter image generation failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string; media_type?: string }[] };
  const image = data.data?.[0];
  if (!image?.b64_json) throw new Error("OpenRouter returned no image");
  return { base64: image.b64_json, mimeType: image.media_type || "image/png" };
};
