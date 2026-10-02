import type { ConnectionTester, WhatsAppTemplateSender, WhatsAppTextSender } from "../types";

export const testTwilio: ConnectionTester = async (credentials) => {
  const { accountSid, authToken } = credentials;
  if (!accountSid || !authToken) return { ok: false, error: "accountSid and authToken are required" };
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return { ok: false, error: `Twilio responded ${res.status}` };
  const data = (await res.json()) as { friendly_name?: string };
  return { ok: true, accountLabel: data.friendly_name ?? "Twilio account" };
};

async function twilioSend(credentials: Record<string, string>, form: URLSearchParams) {
  const { accountSid, authToken, fromNumber } = credentials;
  if (!accountSid || !authToken || !fromNumber) throw new Error("accountSid, authToken and fromNumber are required");
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Twilio send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { sid?: string };
  return { providerMessageId: data.sid ?? `twilio-${Date.now()}` };
}

// Twilio's WhatsApp templates are sent via the Content API: templateName is
// expected to be the Content SID (e.g. "HX...") registered in the Twilio
// console, not a free-form name. Confirm against current Twilio docs.
export const sendTwilioTemplate: WhatsAppTemplateSender = (credentials, message) => {
  const variables: Record<string, string> = {};
  (message.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters)
    .forEach((p, i) => {
      if (p.text) variables[String(i + 1)] = p.text;
    });
  const form = new URLSearchParams({
    From: `whatsapp:${credentials.fromNumber}`,
    To: `whatsapp:${message.to}`,
    ContentSid: message.templateName,
    ContentVariables: JSON.stringify(variables),
  });
  return twilioSend(credentials, form);
};

/** Only valid inside the 24-hour customer-service window — enforced by the caller. */
export const sendTwilioText: WhatsAppTextSender = (credentials, message) => {
  const form = new URLSearchParams({
    From: `whatsapp:${credentials.fromNumber}`,
    To: `whatsapp:${message.to}`,
    Body: message.text,
  });
  return twilioSend(credentials, form);
};
