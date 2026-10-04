import type { ConnectionTester, WhatsAppTextSender } from "../types";

const BASE_URL = "https://api.360messenger.com";

// 360Messenger is an unofficial WhatsApp-Web-automation API (sends from a
// personal number, not an official WhatsApp Business number) — no template
// approval system, just free-form text. Field names below are a best-effort
// guess from the product's own API reference (phone/message for sendMessage,
// state for getState) since no live account was available to verify the
// exact request/response shape against; confirm and fix via a real test
// connection + send before relying on this for a live campaign.
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

export const send360MessengerText: WhatsAppTextSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch(`${BASE_URL}/v2/sendMessage/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: message.to, message: message.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`360Messenger send failed (${res.status}): ${body}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string; data?: { id?: string } };
  return { providerMessageId: data.id ?? data.messageId ?? data.data?.id ?? `360messenger-${Date.now()}` };
};
