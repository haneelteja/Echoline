import type { ConnectionTester, WhatsAppTextSender } from "../types";

const BASE_URL = "https://api.360messenger.com";

// 360Messenger is an unofficial WhatsApp-Web-automation API (sends from a
// personal number, not an official WhatsApp Business number) — no template
// approval system, just free-form text.
export const test360Messenger: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch(`${BASE_URL}/v2/client/getState/`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `360Messenger responded ${res.status}: ${body}` };
  }
  const data = (await res.json().catch(() => ({}))) as { state?: string; phone?: string; number?: string; me?: string };
  // Exact match against known-healthy values, not a substring test — e.g.
  // "DISCONNECTED" contains "CONNECTED" as a substring, so a naive
  // /connected/i.test() would wrongly treat it as healthy.
  const HEALTHY_STATES = new Set(["connected", "authenticated", "open"]);
  if (data.state && !HEALTHY_STATES.has(data.state.toLowerCase())) {
    return { ok: false, error: `WhatsApp Web session is not active (state: ${data.state}) — reconnect it in the 360Messenger dashboard` };
  }
  return { ok: true, accountLabel: data.phone ?? data.number ?? data.me ?? "360Messenger account" };
};

// Confirmed against the same n8n integration source as send360MessengerText
// above (github.com/360messenger/n8n-nodes-360messenger's trigger node):
// POST /v2/settings/webhook/set with { url }, Bearer-authed. There's no
// per-webhook signing secret to hand back — unlike Meta/Twilio, a request to
// our inbound endpoint can't be cryptographically verified as genuinely from
// 360Messenger. Called on connect and on every manual "Test" so the webhook
// stays pointed at us even if API_PUBLIC_URL ever changes.
export async function registerWebhook360Messenger(apiKey: string, webhookUrl: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v2/settings/webhook/set`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`360Messenger webhook registration failed (${res.status}): ${body}`);
  }
}

export const send360MessengerText: WhatsAppTextSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  // Confirmed against 360Messenger's own n8n integration source
  // (github.com/360messenger/n8n-nodes-360messenger): the request goes as
  // multipart/form-data (not JSON) with fields `phonenumber` and `text`, not
  // `phone`/`message` — mismatching either one gets a bare 400 "Bad Request
  // Exception" with no further detail from their API.
  const form = new FormData();
  form.append("phonenumber", message.to);
  if (message.text) form.append("text", message.text);
  if (message.mediaUrl) form.append("url", message.mediaUrl);
  const res = await fetch(`${BASE_URL}/v2/sendMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`360Messenger send failed (${res.status}): ${body}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string; data?: { id?: string } };
  return { providerMessageId: data.id ?? data.messageId ?? data.data?.id ?? `360messenger-${Date.now()}` };
};
