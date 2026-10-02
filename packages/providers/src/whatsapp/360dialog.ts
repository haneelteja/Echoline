import type { ConnectionTester, WhatsAppTemplateSender } from "../types";

// 360dialog's API surface (Partner API vs direct client key) varies by
// onboarding path. This checks the webhook config endpoint as a lightweight
// "is this key valid" probe — confirm against current 360dialog docs before
// relying on it for real account labels.
export const test360Dialog: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://waba.360dialog.io/v1/configs/webhook", {
    headers: { "D360-API-KEY": apiKey },
  });
  if (!res.ok) return { ok: false, error: `360dialog responded ${res.status}` };
  return { ok: true, accountLabel: "360dialog WABA" };
};

// 360dialog's send API mirrors the Meta Cloud API message shape (minus the
// messaging_product field, which is Meta-specific) — confirm against current
// docs before relying on exact field names in production.
export const send360DialogTemplate: WhatsAppTemplateSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://waba.360dialog.io/v1/messages", {
    method: "POST",
    headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.language, policy: "deterministic" },
        components: message.components ?? [],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`360dialog send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { providerMessageId: data.messages?.[0]?.id ?? `360dialog-${Date.now()}` };
};
