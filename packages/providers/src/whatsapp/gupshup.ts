import type { ConnectionTester, WhatsAppTemplateSender } from "../types";

export const testGupshup: ConnectionTester = async (credentials) => {
  const { apiKey, appId } = credentials;
  if (!apiKey || !appId) return { ok: false, error: "apiKey and appId are required" };
  const res = await fetch(`https://api.gupshup.io/sm/api/v1/app/${appId}`, {
    headers: { apikey: apiKey },
  });
  if (!res.ok) return { ok: false, error: `Gupshup responded ${res.status}` };
  const data = (await res.json()) as { name?: string };
  return { ok: true, accountLabel: data.name ?? "Gupshup app" };
};

// Gupshup's template-message API is form-encoded, not JSON, and expects the
// registered sending number as `source` plus the template as a JSON string —
// confirm the exact shape against current Gupshup docs before production use.
export const sendGupshupTemplate: WhatsAppTemplateSender = async (credentials, message) => {
  const { apiKey, appId, source } = credentials;
  if (!apiKey || !appId || !source) throw new Error("apiKey, appId and source (sending number) are required");
  const bodyParams = (message.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.text ?? ""));
  const form = new URLSearchParams({
    channel: "whatsapp",
    source,
    destination: message.to,
    template: JSON.stringify({ id: message.templateName, params: bodyParams }),
  });
  const res = await fetch("https://api.gupshup.io/sm/api/v1/template/msg", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gupshup send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { messageId?: string };
  return { providerMessageId: data.messageId ?? `gupshup-${Date.now()}` };
};
