import type { ConnectionTester, WhatsAppTemplateSender } from "../types";

// Interakt's public REST surface for a plain "whoami" check is thin as of
// writing — this calls their organization endpoint as a credential probe.
// Confirm the exact path against current Interakt docs before production use.
export const testInterakt: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://api.interakt.ai/v1/organizations/me", {
    headers: { Authorization: `Basic ${apiKey}` },
  });
  if (!res.ok) return { ok: false, error: `Interakt responded ${res.status}` };
  const data = (await res.json()) as { name?: string };
  return { ok: true, accountLabel: data.name ?? "Interakt account" };
};

// Confirm the exact request shape against current Interakt docs before
// production use — their public API surface for templated sends is thin.
export const sendInteraktTemplate: WhatsAppTemplateSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const bodyValues = (message.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.text ?? ""));
  const res = await fetch("https://api.interakt.ai/v1/public/message/", {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      countryCode: "",
      phoneNumber: message.to,
      type: "Template",
      template: { name: message.templateName, languageCode: message.language, bodyValues },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Interakt send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { id?: string };
  return { providerMessageId: data.id ?? `interakt-${Date.now()}` };
};
