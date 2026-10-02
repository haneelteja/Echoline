import type { ConnectionTester, WhatsAppTemplateSender } from "../types";

// AiSensy has no dedicated "whoami" endpoint in their public docs as of
// writing — API keys are normally validated implicitly on first send. This
// probes their campaign endpoint with an intentionally-bogus campaign name:
// an auth failure (401/403) means the key is bad; any other response means
// the key itself was accepted. Confirm against current AiSensy docs before
// relying on this for production account-label display.
export const testAiSensy: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, campaignName: "__echoline_connection_test__" }),
  });
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid API key" };
  return { ok: true, accountLabel: "AiSensy account" };
};

// AiSensy sends templated messages as "campaigns": campaignName IS the
// approved template name. Confirm field names against current AiSensy docs
// before production use.
export const sendAiSensyTemplate: WhatsAppTemplateSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const templateParams = (message.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.text ?? ""));
  const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      campaignName: message.templateName,
      destination: message.to,
      userName: message.to,
      templateParams,
      media: message.mediaUrls?.[0] ? { url: message.mediaUrls[0] } : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AiSensy send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { submitted_message_id?: string };
  return { providerMessageId: data.submitted_message_id ?? `aisensy-${Date.now()}` };
};
